var uuid  = require('uuid');
var when  = require('when');
var defer = when.defer;
var amqplib = require('amqplib');
var executor_config = require('./amqpCommand.config.js');

var identity = function(e) {return e};


var connection = null;

function connect() {
    connection = amqplib.connect(executor_config.amqp_url);
    console.log("[AMQP] Starting connection to " + executor_config.amqp_url);

    connection.then(function(conn) {
        console.log("[AMQP] Connected!");

        return when(conn.createChannel().then(function(ch) {
          var ok = ch.assertQueue('hyperflow.jobs', {durable: true}).then(function(qok) { return qok.queue; });
        }));
    }, function(err) {
        console.error('[AMQP] Connect failed: %s', err);
    })
}
var taskCount = 0;

function amqpCommand(ins, outs, config, cb) {
  if(!connection) connect();

  connection.then(function(connection) {
    return when(connection.createChannel().then(function(ch) {
      var options = executor_config.options;
      if(config.executor.hasOwnProperty('options')) {
          var executorOptions = config.executor.options;
          for (var opt in executorOptions) {
              if(executorOptions.hasOwnProperty(opt)) {
                  options[opt] = executorOptions[opt];
              }
          }
      }

      //extend options
      var extendedOptions = Object.assign({
        hfId: config.hfId,
        wfid: config.appId,
        procId: config.procId},
        options);

      //console.log("[AMQP] options! %j",options);

      var jobMessage = {
        "executable": config.executor.executable,
        "args":       config.executor.args,
        "env":        (config.executor.env || {}),
        "inputs":     ins.map(identity),
        "outputs":    outs.map(identity),
        "options":    extendedOptions
      };

      var answer = defer();
      var corrId = uuid.v4();
      function maybeAnswer(msg) {
        if (msg.properties.correlationId === corrId) {
          answer.resolve(msg.content.toString());
        }
      }

      var ok = ch.assertQueue('', {exclusive: true, autoDelete: true})
        .then(function(qok) { return qok.queue; });

      ok = ok.then(function(queue) {
        return ch.consume(queue, maybeAnswer, {noAck: true})
          .then(function() { return queue; });
      });

      ok = ok.then(function(queue) {
        taskCount += 1;
        // console.log("[AMQP][" + corrId + "][" + taskCount + "] Publishing job " + JSON.stringify(jobMessage));
        ch.sendToQueue('hyperflow.jobs', new Buffer(JSON.stringify(jobMessage)), {replyTo: queue, contentType: 'application/json', correlationId: corrId});
        return answer.promise;
      });

      return ok.then(function(message) {
        var parsed = JSON.parse(message);
        ch.close();
        if (parsed.exit_status == "0") {
          // console.log("[AMQP][" + corrId + "] Job finished! job[" + JSON.stringify(jobMessage) + "] msg[" + message + "]", outs);
          cb(null, outs);
        } else {
          // console.log("[AMQP][" + corrId + "] Error during job execution! msg[" + JSON.stringify(jobMessage) + "] job[" + message + "] exception[" + parsed.exceptions + "]");
          // process.exit(5);
          cb(parsed.exceptions, outs);
        }
      });
    }))
  }).then(null, function(err) { console.trace(err.stack); });
}


exports.amqpCommand = amqpCommand;
