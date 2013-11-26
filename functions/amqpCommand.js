var amqp = require('amqp');
var uuid = require('uuid');
//var util = require('util');
//var EventEmitter = require("events").EventEmitter;

function amqpCommand(ins, outs, executor, config, cb) {
	
	var executable = config.executor.executable;
	var args = config.executor.args;
	var deliberatelyExit = false;

	var AMQP_URL = process.env.AMQP_URL ? process.env.AMQP_URL : "amqp://localhost:5672";
	var connection = amqp.createConnection({ url: AMQP_URL });
	
	connection.on('error', function(err) {
		if (deliberatelyExit) {
			//ignore close errors, as connection is terminated, and all channels will be closed forcefully
		} else {
			console.log("ERROR: ", err);
		}
	});
	
	connection.on('ready', function() {
		var consumerTag;
		var q = connection.queue ('', { exclusive: true, closeChannelOnUnsubscribe: true }, function(queue) {
			var corrId = uuid.v4();

			queue.subscribe({ exclusive: true, ack: true }, function(message, headers, deliveryInfo) {
				console.log("amqp message recieved");
				if(deliveryInfo.correlationId == corrId) {
					console.log("result: output:", message.stdout, "stderr:", message.stderr, "ret code:", message.return_code);
					
					//unsubscribe and close connection
					queue.unsubscribe(consumerTag);
					
					//do some magic, so auto-reconnect won't hurt us
					connection.implOptions.reconnect = false;
					deliberatelyExit = true;
					
					connection.end();
					if(message.return_code != "0") {
						cb(null, outs);
					} else {
						cb("Error during job execution!", outs);
					}
				} else {
					console.log("ERROR: unexpected message, got: ", deliveryInfo.correlationId, "expected:", corrId);
					throw new Error("Unexpected message received!");
				}
			}).addCallback(function (ok) {
				consumerTag = ok.consumerTag;
			});
		
			//publish job
			var exchange = connection.exchange('', {}, function(exchange) {
				console.log("amqp job published");
				exchange.publish('hyperflow.jobs', { "executable" : executable, "args": args, "inputs": [], "outputs": [] },
						{replyTo: queue.name, contentType: 'application/json', correlationId: corrId});
			});				
		});
	});
}

exports.amqpCommand = amqpCommand;
