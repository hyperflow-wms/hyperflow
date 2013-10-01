var amqp = require('amqp');
var uuid = require('uuid');
var util = require('util');

function amqpCommand(ins, outs, executor, config, cb) {
	
	var executable = config.executor.executable;
	var args = config.executor.args;
	
	var connection = amqp.createConnection( { host: 'localhost', port: 5672 } );

	connection.on('ready', function() {
		console.trace();
		console.log("connection ready");
		var ctag;
		var q = connection.queue ('', { exclusive: true }, function(queue) {
			console.log("queue ready");
			var corrId = uuid.v4();

			queue.subscribe({ exclusive: true, ack: true }, function(message, headers, deliveryInfo) {
				console.log("message recieved");
				if(deliveryInfo.correlationId == corrId) {
					//TODO: Add proper interpretation of job outcome, throw some output on screen
					console.log("output:" + message.stdout + ", stderr:" + message.stderr + ", ret code:" + message.return_code);
//					q.unsubscribe(ctag);
					try {
						console.log(util.inspect(connection));
						connection.end();
					} catch (e) {
						console.log(e);
					}
					cb(null, outs);
				} else {
					console.log("unexpected message");
				}
			}).addCallback(function (ok) {
				ctag = ok.consumerTag;
			});
		
			//publish job
			var exchange = connection.exchange('', {}, function(exchange) {
				console.log("job published");
				exchange.publish('hyperflow.jobs', { "executable" : executable, "args": args, "inputs": [], "outputs": [] },
						{replyTo: queue.name, contentType: 'application/json', correlationId: corrId});
			});				
		});
	});
}

exports.amqpCommand = amqpCommand;
