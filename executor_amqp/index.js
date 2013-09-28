/* Hypermedia workflow. 
 ** Amqp task executor which submits commands as amqp messages.
 ** This executor is based on executor_simple made by Bartosz Balis
 ** Author: Maciej Palwik
 */
var fs = require('fs'),
    xml2js = require('xml2js'),
    spawn = require('child_process').spawn,
    amqp = require('amqp'),
    uuid = require('uuid');

exports.init = function() {

    //////////////////////////////////////////////////////////////////////////
    /////////////////////////////// data /////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////



    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function public_execute(task, server, cb) {
	
//    		console.log(task)
    
    	var connection = amqp.createConnection( { host: 'localhost', port: 19164 } );
	
		connection.on('ready', function() {
//			console.log('connection ready');
			var q = connection.queue ('', { exclusive: true }, function(queue) {
				console.log('exclusive queue declared ' + queue.name);
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
    	
		setTimeout(function() {
	//		check if this can be removed
		}, 1000);
	
    }

    return {
        execute: public_execute,
    };

};
