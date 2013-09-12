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
        var args = [server, 'cd', 'montage-working/0.5/input', ';', task['@'].name, task.argument];

	var proc = spawn('ssh', args);
	proc.stdout.on('data', function(data) {
		console.log(task['@'].name + '-'+ task['@'].id + ' stdout:' + data);
	});
	proc.stderr.on('data', function(data) {
		console.log(task['@'].name + '-'+ task['@'].id + ' stdout:' + data);
	});
	proc.on('exit', function(code) {
		console.log(task['@'].name + '-'+ task['@'].id + ' stdout:' + code);
		cb(null, code);
	});
	
	//this seems unnecessary
	setTimeout(function() {

	}, 1000);
    }
    

    return {
        execute: public_execute,
    };

};
