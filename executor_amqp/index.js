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
	
//    	console.log(task)
    	
	setTimeout(function() {
		cb(null, 'some output');
	}, 1000);
	
    }

    return {
        execute: public_execute,
    };

};
