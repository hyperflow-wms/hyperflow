var amqp = require('amqp');
var uuid = require('uuid');

var AMQP_URL = process.env.AMQP_URL ? process.env.AMQP_URL : "amqp://localhost:5672";
var S3_BUCKET = process.env.S3_BUCKET;
var S3_PATH = process.env.S3_PATH;
var connection = null;
var connectionReady = false;

function amqpCommand(ins, outs, config, cb) {
  getConnection(function(connection) {
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
        if (deliveryInfo.correlationId == corrId) {
          console.log("[AMQP][" + corrId + "] Job finished: " + JSON.stringify(message, null, "  "));
          queue.unsubscribe(consumerTag);

          if (message.exit_status != "0") {
            cb(null, outs);
          } else {
            cb("[AMQP][" + corrId + "] Error during job execution!", outs);
          }
        } else {
          console.log("[AMQP][" + corrId + "] Invalid message id");
          cb("[AMQP][" + corrId + "] Invalid message id")
        }
      }).addCallback(function(ok) {
        consumerTag = ok.consumerTag;
      });

      //publish job
      var exchange = connection.exchange('', {}, function(exchange) {
        console.log("[AMQP][" + corrId + "] Job published");
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
        exchange.publish('hyperflow.jobs', message, {
          replyTo: queue.name,
          contentType: 'application/json',
          correlationId: corrId
        });
      });
    });
  });
}

function getConnection(cb) {
  if (connection) {
    if (connectionReady) {
      cb(connection);
    } else {
      connection.once('ready', function(){ cb(connection); });
    }
  } else {
    connection = amqp.createConnection({
      url: AMQP_URL,
      heartbeat: 30
    });

    connection.once('ready', function() {
      connectionReady = true;
      console.log('[AMQP] Connection ready')
      cb(connection);
    });
    
    connection.once('error', function(err) {
      connection = null;
      connectionReady = false;
      console.log("[AMQP] Error: ", err);
      throw err;
    }).setMaxListeners(0);
  }
};

exports.amqpCommand = amqpCommand;
