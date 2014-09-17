var uuid  = require('uuid');
var when  = require('when');
var defer = when.defer;
var amqplib = require('amqplib');
var executor_config = require('./amqpCommand.config.js');

//TODO: initialize @ first use, or module.init()
console.log("[AMQP] Starting connection!");
var connection      = amqplib.connect(executor_config.amqp_url);

connection.then(function(conn) {
  connection.once('SIGINT', function() { connection.close(); });
})

var taskCount = 0;


function amqpCommand(ins, outs, config, cb) {
  var queue_name = typeof config.executor.queue_name !== 'undefined' ? config.executor.queue_name : "hyperflow.jobs";

  connection.then(function(connection) {
    return when(connection.createChannel().then(function(ch) {
      var jobMessage = {
        "executable": config.executor.executable,
        "args": config.executor.args,
        "inputs": ins,
        "outputs": outs,
        "options": executor_config.options
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
        ch.assertQueue(queue_name);
        taskCount += 1;
        console.log("[AMQP][" + corrId + "][" + taskCount + "] Publishing job " + JSON.stringify(jobMessage));
        ch.sendToQueue(queue_name, new Buffer(JSON.stringify(jobMessage)), {replyTo: queue, contentType: 'application/json', correlationId: corrId});
        return answer.promise;
      }); 

      return ok.then(function(message) {
        var parsed = JSON.parse(message);
        ch.close();
        if (parsed.exit_status == "0") {
          console.log("[AMQP][" + corrId + "] Job finished! job[" + JSON.stringify(jobMessage) + "] msg[" + message + "]", outs);
          cb(null, outs);
        } else {
          console.log("[AMQP][" + corrId + "] Error during job execution! msg[" + JSON.stringify(jobMessage) + "] job[" + message + "] exception[" + parsed.exceptions + "]");
          // process.exit(5);
          cb(parsed.exceptions, outs);
        }
      });
    }))
  }).then(null, function(err) { console.trace(err.stack); });
} 


exports.amqpCommand = amqpCommand;
