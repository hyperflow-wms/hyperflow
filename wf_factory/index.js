/* Hypermedia workflow. 
 ** Creates a new wf instance in redis based on its JSON representation 
 ** (see Montage143.json for an example)
 ** Author: Bartosz Balis (2013)
 */
var fs = require('fs'),
    xml2js = require('xml2js'),
    redis = require('redis'),
    async = require('async'),
    wflib = require('../wflib').init(),
    rcl;

exports.init = function(redisClient) {
    if (redisClient) {
	rcl = redisClient;
    }

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function public_createInstanceFromFile(filename, baseUrl, cb) {
        fs.readFile(filename, 'utf8', function(err, data) {
            if (err) { 
                throw(err);
            } else {
                var wfname = filename.split('.')[0];
                rcl.hmset("wftempl:"+wfname, "name", wfname, "maxInstances", "3", function(err, ret) { 
                    var start = (new Date()).getTime(), finish;
                    public_createInstance(JSON.parse(data), baseUrl, function(err, ret) {
                        finish = (new Date()).getTime();
                        console.log("createInstance time: "+(finish-start)+"ms");
                        err ? cb(err): cb(null, ret);
                    });
                });
            }
        });
    }

    // creates a new workflow instance based
    function public_createInstance(wfJson, baseUrl, cb) { 
        var instanceId;
	var start, finish; 
        rcl.incrby("wfglobal:nextId", 1, function(err, ret) {
            if (err) {
	       console.log("Error: "+err);
	    }
            instanceId = ret.toString();
            console.log("instanceId="+instanceId);
            createWfInstance(wfJson, baseUrl, instanceId, function(err) {
                cb(null, instanceId);
            });
        });
    }

    return {
        createInstance: public_createInstance,
        createInstanceFromFile: public_createInstanceFromFile
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function createWfInstance(wfJson, baseUrl, instanceId, cb) {
        var wfname = wfJson.name;
        var baseUri = baseUrl + '/workflow/' + wfname + '/instances/' + instanceId;
        var wfKey = "wf:"+instanceId;
        rcl.hmset(wfKey, "uri", baseUri, 
                         "status", "waiting", 
                         function(err, ret) { });

        // add workflow tasks
        var taskKey;
        for (var i=0; i<wfJson.tasks.length; ++i) {
            var taskId = i+1;
            taskKey = wfKey+":task:"+taskId;
            processTask(wfJson.tasks[i], wfname, baseUri, wfKey, taskKey, taskId, function() { });
        }

        // add workflow data
        var multi = rcl.multi();
        var dataKey;
        for (var i=0; i<wfJson.data.length; ++i) {
            (function(i) {
                var dataId = i+1;
                dataKey = wfKey+":data:"+dataId;
                multi.hmset(dataKey, 
                        "uri", baseUri + '/data-' + dataId, 
                        "name", wfJson.data[i].name, 
                        "status", "not_ready", 
                        function(err, ret) { });

                // add this data id to the sorted set of all workflow data
                // score: 0 (data not ready) or 1 (data ready)
                multi.zadd(wfKey+":data", 0 /* score */, dataId, function(err, ret) { });
            })(i);
        }

        // add workflow inputs and outputs
        for (var i=0; i<wfJson.ins.length; ++i) {
            (function(inId, dataId) {
                multi.zadd(wfKey+":ins", inId, dataId, function(err, rep) { });
            })(i+1, wfJson.ins[i]+1);
        }
        for (var i=0; i<wfJson.outs.length; ++i) {
            (function(outId, dataId) {
                multi.zadd(wfKey+":outs", outId, dataId, function(err, rep) { });
            })(i+1, wfJson.outs[i]+1);
        }
        multi.exec(function(err, replies) {
            console.log('Done processing jobs.'); 
            cb(err);
        });
    }

    function processTask(task, wfname, baseUri, wfKey, taskKey, taskId, cb) {
        var multi=rcl.multi();
        multi.hmset(taskKey, 
                "uri", baseUri+"/task-"+taskId, 
                "name", task.name, 
                "status", "waiting", 
                "execName", task.name, 
                "execArgs", task.execArgs, 
                // mapping data for simple ssh-based execution. In the future will probably be
                // a separate mapping data structure
                "execSSHAddr", "balis@192.168.252.130", 
                function(err, ret) { });

        // add task id to sorted set of all wf tasks. Score 0/1/2==waiting/running/finished
        // only task Id (not key) is added which allows redis to optimize memory consumption 
        multi.zadd(wfKey+":tasks", 0 /* score */, taskId, function(err, ret) { });

        // add task inputs and outputs + data sources and sinks
        for (var i=0; i<task.ins.length; ++i) {
            (function(inId, dataId) {
                var dataKey = wfKey+":data:"+dataId;
                multi.zadd(taskKey+":ins", inId, dataId, function(err, rep) { });
                multi.zadd(dataKey+":sinks", inId /* score: port id */ , taskId, function(err, ret) { });
            })(i+1, task.ins[i]+1);
        }
        for (var i=0; i<task.outs.length; ++i) {
            (function(outId, dataId) {
                var dataKey = wfKey+":data:"+dataId;
                multi.zadd(taskKey+":outs", outId, dataId, function(err, rep) { });
                multi.zadd(dataKey+":sources", outId /* score: port Id */, taskId, function(err, ret) { });
            })(i+1, task.outs[i]+1);
        }
        multi.exec(function(err, replies) {
            cb();
        });
    }

    // OLD implementation computed based on redis (not used currently)
    function computeWfInsOuts(wfId, nData, cb) {
	var multi=rcl.multi();
	var inPortId=1, outPortId=1;
	var dataId=1;
	async.whilst(
		function condition() { return dataId<=nData; },
		function iterate(next) {
		    wflib.getDataInfo(wfId, dataId, function(err, rep) {
			(function(dataId, inId, outId) {
			    if (rep.nSources == 0) {
				++inPortId;
				multi.zadd("wf:"+wfId+":ins", inId, dataId, function(err, rep) { });
			    }
			    if (rep.nSinks == 0) {
				++outPortId;
				multi.zadd("wf:"+wfId+":outs", outId, dataId, function(err, rep) { });
			    }
			})(dataId, inPortId, outPortId);
			++dataId;
			next();
		    });
		},
		function done(err) {
		    multi.exec(function(err, replies) {
			console.log('Done processing jobs.'); 
			cb(err);
		    });
		}
	);
    }

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

