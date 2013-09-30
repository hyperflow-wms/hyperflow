function amqpCommand(ins, outs, executor, config, cb) {

	var connection = amqp.createConnection( { host: 'localhost', port: 19164 } );

	connection.on('ready', function() {
		var q = connection.queue ('', { exclusive: true }, function(queue) {
			var corrId = uuid.v4();
		
			queue.subscribe({ exclusive: true }, function(message, headers, deliveryInfo) {
				//console.log(JSON.parse(message.data.toString()));
				if(deliveryInfo.correlationId == corrId) {
					console.log('corr id match!, message:');
					console.log(message);
					//TODO: Add proper interpretation of job outcome, throw some output on screen
					cb(null, 0);
				} else {
					console.log("unexpected message");
				}
			});
		
			//publish job
			var exchange = connection.exchange('', {}, function(exchange) {
				exchange.publish('hyperflow.jobs', '{ "executable" : "/bin/ls", "args": "", "inputs": [], "outputs": [] }',
						{replyTo: queue.name, contentType: 'application/json', correlationId: corrId});
			});				
		});
	});
}

exports.amqpCommand = amqpCommand;
