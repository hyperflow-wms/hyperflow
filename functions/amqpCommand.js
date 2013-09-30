var amqp = require('amqp');
var uuid = require('uuid');

function amqpCommand(ins, outs, executor, config, cb) {
	
	var executable = config.executor.executable;
	var args = config.executor.args;
	
	var connection = amqp.createConnection( { host: 'localhost', port: 5672 } );

	connection.on('ready', function() {
		console.log("connection ready");
		var q = connection.queue ('', { exclusive: true }, function(queue) {
			console.log("queue ready");
			var corrId = uuid.v4();

			queue.subscribe({ exclusive: true }, function(message, headers, deliveryInfo) {
				console.log("message recieved");
				if(deliveryInfo.correlationId == corrId) {
					console.log('corr id match!');
					//TODO: Add proper interpretation of job outcome, throw some output on screen
					cb(null, outs);
				} else {
					console.log("unexpected message");
				}
			});
		
			//publish job
			var exchange = connection.exchange('', {}, function(exchange) {
				console.log("job published");
				exchange.publish('hyperflow.jobs', '{ "executable" : "/bin/ls", "args": "", "inputs": [], "outputs": [] }',
						{replyTo: queue.name, contentType: 'application/json', correlationId: corrId});
			});				
		});
	});
}

exports.amqpCommand = amqpCommand;
