var amqp = require('amqp');
var uuid = require('uuid');

var AMQP_URL = process.env.AMQP_URL ? process.env.AMQP_URL : "amqp://localhost:5672";
var S3_BUCKET = process.env.S3_BUCKET;
var S3_PATH = process.env.S3_PATH;
var connection = null;

function amqpCommand(ins, outs, executor, config, cb) {
  var executable = config.executor.executable;
  var args = config.executor.args;
  var deliberatelyExit = false;

  var consumerTag;
  var q = connection.queue('', {
    exclusive: true,
    closeChannelOnUnsubscribe: true
  }, function(queue) {
    var corrId = uuid.v4();

    queue.subscribe({
      exclusive: true,
      ack: true
    }, function(message, headers, deliveryInfo) {
      console.log("[AMQP Command][" + corrId + "] message recieved");
      if (deliveryInfo.correlationId == corrId) {
        console.log("[AMQP Command][" + corrId + "] result: output:", message.stdout, "stderr:", message.stderr, "ret code:", message.exit_code);
        console.log(message);
        queue.unsubscribe(consumerTag);

        if (message.exit_code != "0") {
          cb(null, outs);
        } else {
          cb("[AMQP Command][" + corrId + "] Error during job execution!", outs);
        }
      } else {
        console.log("[AMQP Command][" + corrId + "] unexpected message, got: ", deliveryInfo.correlationId, "expected:", corrId);
        cb("[AMQP Command][" + corrId + "] Unexpected message")
      }
    }).addCallback(function(ok) {
      consumerTag = ok.consumerTag;
    });

    //publish job
    var exchange = connection.exchange('', {}, function(exchange) {
      console.log("[AMQP Command] job published");
      var message = {
        "executable": executable,
        "args": args,
        "inputs": ins,
        "outputs": outs,
        "options": {
          "bucket": S3_BUCKET,
          "prefix": S3_PATH,
        }
      };        
      console.log(message);
      exchange.publish('hyperflow.jobs', message, {
        replyTo: queue.name,
        contentType: 'application/json',
        correlationId: corrId
      });
    });
  });
}

function connect(cb) {
  connection = amqp.createConnection({
    url: AMQP_URL,
    heartbeat: 30
  });

  connection.on('ready', function() {
    console.log('[AMQP Command] Connection ready')
    cb();
  });
  connection.on('error', function(err) {
    console.log("[AMQP Command] Error: ", err);
  });

};

exports.connect = connect;
exports.amqpCommand = amqpCommand;
