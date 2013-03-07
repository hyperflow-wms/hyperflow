/* Hypermedia workflow. 
 ** Creates a new wf instance based on a real pegasus dax file
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
    /*rcl.on("error", function (err) {
	console.log("Redis error: " + err);
    });*/

    var workflow_cache = {}; // cache for parsed json workfow representations (database substitute)
    var instances = []; // table of existing workflow instances 

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    // returns wf template data (in JSON)
    function public_getTemplate(wfname, cb) {
        // first access: workflow file not yet parsed and cached in memory
        if (!(wfname in workflow_cache)) {
            var parser = new xml2js.Parser();
            fs.readFile(wfname + '.xml', function(err, data) {
                if (err) { 
                    cb(new Error("File read error. Doesn't exist?"));
                    return;
                } else {
                    parser.parseString(data, function(err, result) {
                        if (err) {
                            cb(new Error("File parse error."));
                            return;
                        }
                        workflow_cache[wfname] = result; // ### FIXME: garbage
			rcl.hmset("wftempl:"+wfname, "name", wfname, "maxInstances", "3", function(err, ret) { 
			    cb(null, workflow_cache[wfname]);
			});
                    });
                }
            });
        } else {
	    cb(null, workflow_cache[wfname]);
	}
    }

    // creates a new workflow instance
    function public_createInstance(wfname, baseUrl, cb) { 
        var instanceId;
	var start, finish; 
	start = (new Date()).getTime();
        rcl.incrby("wfglobal:nextId", 1, function(err, ret) {
            if (err) {
	       console.log("Error: "+err);
	    }
            instanceId = ret.toString();
            console.log("instanceId="+instanceId);
	    var getTemplateStart = (new Date()).getTime();
	    public_getTemplate(wfname, function(err, wfTempl) {
		if (err) {
		    cb(err);
		} else {
		    var getTemplateFinish = (new Date()).getTime();
		    console.log("getTemplate exec time: "+(getTemplateFinish-getTemplateStart)+"ms");
		    createWfInstance(wfTempl, wfname, baseUrl, instanceId, function(err) {
			finish = (new Date()).getTime();
			console.log("createInstance exec time: "+(finish-start)+"ms");
			cb(null, instanceId);
		    });
		}
	    });
	});
    }

    function public_getInstance(wfname, id) {
        if (wfname in instances) {
            if (id in instances[wfname].data) {
                return instances[wfname].data[id];                
            }
        } else {
            return new Error("Error: instance doesn't exist.")
        }
    }

    function public_getInstanceList(wfname) {
	return [];
    }

    return {
        createInstance: public_createInstance,
        getTemplate: public_getTemplate,
        getInstance: public_getInstance,
        getInstanceList: public_getInstanceList,
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function createWfInstance(wf, wfname, baseUrl, instanceId, cb) {
        var baseUri = baseUrl + '/workflow/' + wfname + '/instances/' + instanceId;
        var wfKey = "wf:"+instanceId;
        rcl.hmset(wfKey, "uri", baseUri, 
                         "status", "waiting", 
                         function(err, ret) { });

        var taskKey, taskId;
        async.eachSeries(wf.job, function(job, nextTask) {
            rcl.hincrby(wfKey, "nextTaskId", 1, function(err, ret) {
                taskId = ret;
                taskKey = wfKey+":task:"+taskId;
                processJob(job, wfname, baseUri, wfKey, taskKey, taskId, nextTask);
            });
        }, function done(err) { 
	    if (err) {
		cb(err); 
	    } else {
		rcl.zcard(wfKey+":data", function(err, nData) {
		    computeWfInsOuts(instanceId, nData, function(err) {
			cb(err);
		    });
		});
	    }
	});
    }

    // FIXME: have to compute it more efficiently; trials with bitstrings failed...
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

    function processJob(job, wfname, baseUri, wfKey, taskKey, taskId, nextTask) {
        rcl.hmset(taskKey, "uri", baseUri+"/task-"+taskId, 
                "name", job['@'].name, 
                "status", "waiting", 
                "execName", job['@'].name, 
                "execArgs", job.argument, 
                // mapping data for simple ssh-based execution. In the future will probably be
                // a separate mapping data structure
                "execSSHAddr", "balis@192.168.252.130", 
                function(err, ret) { });

        // add task id to sorted set of all wf tasks. Score 0/1/2==waiting/running/finished
        // only task Id (not key) is added which allows redis to optimize memory consumption 
        rcl.zadd(wfKey+":tasks", 0 /* score */, taskId, function(err, ret) { });

        var dataId, dataKey, inId = 0, outId = 0;
        async.eachSeries(job.uses, function(job_data, next) {
            // we add key wf:{id}:data:names:{name} because in Pegasus names are unique
            // it may not be true for other workflow systems. 
            // TODO: perhaps instance factories should implement a standard API hiding
            // specific redis models which may be different for different wf systems?
	    if (job_data['@'].link == 'input') {
                ++inId; // id of the input port of the task
	    } else {
	        ++outId; // id of the output port of the task
	    }

            rcl.hexists(wfKey+":data:names", job_data['@'].name, function(err, keyExists) {
                if (!keyExists) {
                    rcl.hincrby(wfKey, "nextDataId", 1, function(err, ret) {
                        dataId = ret;
                        dataKey = wfKey+":data:"+dataId;
                        rcl.hset(wfKey+":data:names", job_data['@'].name, dataId, function(err, ret) { });
                        processData(job_data, baseUri, taskKey, dataKey, dataId, wfKey, inId, outId, function done(err, reps) {
                            next();
                        });
                    });
                } else {
                    rcl.hget(wfKey+":data:names", job_data['@'].name, function(err, ret) {
                        dataId = ret;
                        dataKey = wfKey+":data:"+dataId;
                        processData(job_data, baseUri, taskKey, dataKey, dataId, wfKey, inId, outId, function done(err, reps) {
                            next();
                        });
                    });
                }
            });
        }, function done(err) { nextTask(); });
    }

    function processData(job_data, baseUri, taskKey, dataKey, dataId, wfKey, inId, outId, cb) {
        var multi = rcl.multi();
	var taskId = taskKey.split(":")[3];
        multi.hmset(dataKey, "uri", baseUri + '/data-' + dataId, 
                "name", job_data['@'].name, 
                "status", "not_ready", 
                function(err, ret) { });

        // add this data id to the sorted set of all workflow data
        // score: 0 (data not ready) or 1 (data ready)
        multi.zadd(wfKey+":data", 0 /* score */, dataId, function(err, ret) { });

        if (job_data['@'].link == 'input') {
            // add this data id to the sorted set of inputs of this task.
	    // score: task's port id the input is mapped to
            multi.zadd(taskKey+":ins", inId /* score: port id */, dataId, function(err, ret) { });

	    // bit string denoting the fulfillment of task inputs (0 = not ready, 1 = ready)
	    // TODO: should it be "inId-1" so that 0th bit is also set?
	    multi.setbit(taskKey+":ins:status", inId, 0);

            // add this task key to the set of sinks of this data element
            multi.zadd(dataKey+":sinks", inId /* score: port id */ , taskId, function(err, ret) { });

	    // bitmap: if bit n is set data with id=n has a sink task 
	    //multi.setbit(wfKey+":data:hassink", dataId, 1);
        }
        if (job_data['@'].link == 'output') {
	    // add this data id to the sorted set of outputs of this task.
	    // score: task's port id this output is mapped to
            multi.zadd(taskKey+":outs", outId /* score: port id */, dataId, function(err, ret) { });

            // add this job key as a source of this data element
	    multi.zadd(dataKey+":sources", outId /* score: port Id */, taskId, function(err, ret) { });

	    // bitmap: if bit n is set data with id=n has a source task 
	    //multi.setbit(wfKey+":data:hassource", dataId, 1);
        }
        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
                cb(null, replies);
            }
        });
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
