/* Hypermedia workflow. 
 ** Simple task executor which executes commands via ssh
 ** Author: Bartosz Balis (2013)
 */
var fs = require('fs'),
    xml2js = require('xml2js'),
    spawn = require('child_process').spawn;

exports.init = function() {

    //////////////////////////////////////////////////////////////////////////
    /////////////////////////////// data /////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////



    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function public_execute(task, server, cb) {
        var args = [server, 'cd', 'montage-working/0.5/input', ';', task['@'].name, task.argument];
        /*task.argument.filename.forEach(function(filename) {
            args.push(filename['@'].file);
        });*/

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
	setTimeout(function() {

	}, 1000);
    }
    

    return {
        execute: public_execute,
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////


    function clone(obj) {
        // Handle the 3 simple types, and null or undefined
        if (null == obj || "object" != typeof obj) return obj;

        // Handle Date
        if (obj instanceof Date) {
            var copy = new Date();
            copy.setTime(obj.getTime());
            return copy;
        }

        // Handle Array
        if (obj instanceof Array) {
            var copy = [];
            for (var i = 0, len = obj.length; i < len; ++i) {
                copy[i] = clone(obj[i]);
            }
            return copy;
        }

        // Handle Object
        if (obj instanceof Object) {
            var copy = {};
            for (var attr in obj) {
                if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
            }
            return copy;
        }

        throw new Error("Unable to copy obj! Its type isn't supported.");
    }


    function foreach(what, cb) {
        function isArray(what) {
            return Object.prototype.toString.call(what) === '[object Array]';
        }

        if (isArray(what)) {
            for (var i = 0, arr = what; i < what.length; i++) {
                cb(arr[i]);
            }
        }
        else {
            cb(what);
        }
    }


};
