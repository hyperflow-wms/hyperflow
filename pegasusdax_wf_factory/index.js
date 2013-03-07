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
	var inst; // ### garbage
        var instanceId;
        rcl.incrby("wfglobal:nextId", 1, function(err, ret) {
            if (err) {
	       console.log("Error: "+err);
	    }
            instanceId = ret.toString();
            console.log("instanceId="+instanceId);
	    public_getTemplate(wfname, function(err, wfTempl) {
		if (err) {
		    cb(err);
		} else {
		    //createWfInstanceOLD(inst.data[inst.current], wfname, baseUrl, instanceId);
		    createWfInstance(wfTempl, wfname, baseUrl, instanceId, function(err) {
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
				console.log(dataId);
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
	    multi.setbit(wfKey+":data:hassink", dataId, 1);
        }
        if (job_data['@'].link == 'output') {
	    // add this data id to the sorted set of outputs of this task.
	    // score: task's port id this output is mapped to
            multi.zadd(taskKey+":outs", outId /* score: port id */, dataId, function(err, ret) { });

            // add this job key as a source of this data element
	    multi.zadd(dataKey+":sources", outId /* score: port Id */, taskId, function(err, ret) { });

	    // bitmap: if bit n is set data with id=n has a source task 
	    multi.setbit(wfKey+":data:hassource", dataId, 1);
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


    function createWfInstanceOLD(wf, wfname, baseUrl, inst_id) {
        var baseUri = baseUrl + '/workflow/' + wfname + '/instances/' + inst_id;
        var job_id = 0;
        wf.uri = baseUri;
        wf.status = 'ready'; // initial status of workflow instance -- ready but not yet running
        wf.nTasksLeft = wf.job.length;
        // move info about parents to 'job' elements
        foreach(wf.job, function(job) {
            job['@'].status = 'waiting'; // initial status of all jobs - waiting for input data
            job['@'].runtime = '2.0'; // FIXME: temporary (for compatibility with synthetic workflows)
            job['@'].job_id = ++job_id;
            job['@'].uri = baseUri + '/task-' + job_id;
            foreach(wf.child, function(child) {
                if (job['@'].id == child['@'].ref) {
                    job['@'].parents = child.parent; // assumes that child element always has some parent(s)
                }
            });
        });

        // create an array of workflow data elements
        var found, idx;
        wf.data = [];
        foreach(wf.job, function(job) {
            foreach(job.uses, function(job_data) {
                job_data['@'].status = 'not_ready';
                if (job_data['@'].link == 'output') {
                    idx = wf.data.push({
                        'id': -1,
                        'name': job_data['@'].name,
                        'size': 0, // FIXME: temporary (for compatibility with syntetic workflows)
                            'from': [],
                        'to': []
                    });
                    wf.data[idx - 1].from.push({
                        'job_name': job['@'].name,
                        'job_id': job['@'].job_id,
                        'job_uri': job['@'].uri
                    }); // task from which this data is received
                }
            });
        });

        foreach(wf.job, function(job) {
            foreach(job.uses, function(job_data) {
                if (job_data['@'].link == 'input') {
                    found = undefined;
                    foreach(wf.data, function(data) {
                        if (data.name == job_data['@'].name /* && data.size == job_data['@'].size */ ) { // assumption that if file name and size are the same, the file (data) is the same (no way of knowing this for sure based on the trace file)
                            found = data; // data element already in the array
                        }
                    });
                    if (!found) {
                        idx = wf.data.push({
                            'id': -1,
                            'name': job_data['@'].name,
                            'size': 0, // FIXME: temporary (for compatibility with syntetic workflows)
                                'from': [],
                            'to': []
                        });
                        found = wf.data[idx - 1];
                    }
                    found.to.push({
                        'job_name': job['@'].name,
                        'job_id': job['@'].job_id,
                        'job_uri': job['@'].uri
                    }); // task to which this data is passed 
                }
            });
        });

        // assign identifiers and URIs to data elements
        var id = 0;
        foreach(wf.data, function(data) {
            data.id = ++id;
            data.uri = baseUri + '/data-' + id;
        });

        // add data element id and uri to each 'uses' element of each job
        foreach(wf.data, function(data) {
            foreach(data.to, function(job_input) {
                foreach(wf.job[job_input.job_id - 1].uses, function(job_data) {
                    if (job_data['@'].link == 'input' && job_data['@'].name == data.name) {
                        job_data['@'].id = data.id;
                        job_data['@'].uri = data.uri;
                    }
                });
            });
            foreach(data.from, function(job_input) {
                foreach(wf.job[job_input.job_id - 1].uses, function(job_data) {
                    if (job_data['@'].link == 'output' && job_data['@'].name == data.name) {
                        job_data['@'].id = data.id;
                        job_data['@'].uri = data.uri;
                    }
                });
            });
        });
    }
};
