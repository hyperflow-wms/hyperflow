/* Hypermedia workflow. 
 ** Creates a new wf instance based on a real pegasus dax file
 ** Author: Bartosz Balis (2013)
 */
var fs = require('fs'),
    xml2js = require('xml2js')
    redis = require('redis'),
    async = require('async'),
    rcl = redis.createClient();

rcl.on("error", function (err) {
    console.log("Redis error: " + err);
});


exports.init = function() {
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

                        rcl.exists("wftempl:"+wfname, function(err, keyExists) {
                            if (!keyExists) {
                                rcl.hset("wftempl:"+wfname, "name", wfname, function(err, ret) { });
                                rcl.hset("wftempl:"+wfname, "maxInstances", "3", function(err, ret) { });
                            }
                        }); 
                    });
                }
            });
        } 

        // first access: initialization of workflow instance data ### FIXME: garbage
        if (!(wfname in instances)) {
            instances[wfname] = {"current": 0, "max": 3, "data": []};
        }

        cb(null, workflow_cache[wfname]);
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
            console.log("instanceId=", instanceId);
            // ### garbage
            if (wfname in instances) {
                inst = instances[wfname];
                inst.current = (inst.current + 1) % inst.max; 
            } else {
                instances[wfname] = {"current": 0, "max": 3, "data": []};
                inst = instances[wfname];
            }
            inst.data[inst.current] = clone(workflow_cache[wfname]);

            console.log("instanceId=", instanceId);
            createWfInstance(inst.data[inst.current], wfname, baseUrl, instanceId);
            createWfInstanceOLD(inst.data[inst.current], wfname, baseUrl, instanceId);
            cb(null, instanceId);
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
        if (wfname in instances) {
            return instances[wfname];
        } else {
            return new Error("Error: no instances of workflow " + wfname + " found.")
        }
    }

    return {
        createInstance: public_createInstance,
        getTemplate: public_getTemplate,
        getInstance: public_getInstance,
        getInstanceList: public_getInstanceList,
	getTasks: public_getTasks
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function createWfInstance(wf, wfname, baseUrl, instanceId) {
        var inst_id = instanceId; // ### garbage
        var baseUri = baseUrl + '/workflow/' + wfname + '/instances/' + instanceId;
        var wfKey = "wf:"+instanceId;
        rcl.hmset(wfKey, "uri", baseUri, 
                         "nextJobId", "0", 
                         "nextDataId", "0", 
                         "status", "waiting", 
                         function(err, ret) { });

        var job_id = 0; // ### garbage
        wf.uri = baseUri; // ### garbage
        wf.status = 'ready'; // initial status of workflow instance -- ready but not yet running ## garbage
        wf.nTasksLeft = wf.job.length; // # garbage

        var taskKey, taskId;
        async.eachSeries(wf.job, function(job, nextJob) {
            rcl.hincrby(wfKey, "nextJobId", 1, function(err, ret) {
                taskId = ret;
                taskKey = wfKey+":task:"+taskId;
                processJob(job, wfname, baseUri, wfKey, taskKey, taskId, nextJob);
            });
        }, function done(err) { 
            // test
            /*public_getTasks(1, 1, -1, function(err, tasks, ins, outs) {
                console.log(tasks[0].uri);
            });*/
            console.log('Done processing jobs.'); 
        });
    }

    function processJob(job, wfname, baseUri, wfKey, taskKey, taskId, nextJob) {
        rcl.hmset(taskKey, "uri", baseUri+"/task-"+taskId, 
                "name", job['@'].name, 
                "status", "waiting", 
                "execName", job['@'].name, 
                "execArgs", job['@'].argument, 
                // mapping data for simple ssh-based execution. In the future will probably be
                // a separate mapping data structure
                "execSSHAddr", "balis@192.168.252.130", 
                function(err, ret) { });

        // add task id to sorted set of all wf tasks. Score 0/1/2==waiting/running/finished
        // only task Id (not key) is added which allows redis to optimize memory consumption (so I read)
        rcl.zadd(wfKey+":tasks", 0 /* score */, taskId, function(err, ret) { });

        var dataId, dataKey;
        async.eachSeries(job.uses, function(job_data, next) {
            // we add key wf:{id}:data:names:{name} because in Pegasus names are unique
            // it may not be true for other workflow systems. 
            // TODO: perhaps instance factories should implement a standard API hiding
            // specific redis models which may be different for different wf systems?
            rcl.hexists(wfKey+":data:names", job_data['@'].name, function(err, keyExists) {
                if (!keyExists) {
                    rcl.hincrby(wfKey, "nextDataId", 1, function(err, ret) {
                        dataId = ret;
                        dataKey = wfKey+":data:"+dataId;
                        rcl.hset(wfKey+":data:names", job_data['@'].name, dataId, function(err, ret) { });
                        processData(job_data, baseUri, taskKey, dataKey, dataId, wfKey, function done(err, replies) {
                            next();
                        });
                    });
                } else {
                    rcl.hget(wfKey+":data:names", job_data['@'].name, function(err, ret) {
                        dataId = ret;
                        dataKey = wfKey+":data:"+dataId;
                        processData(job_data, baseUri, taskKey, dataKey, dataId, wfKey, function done(err, replies) {
                            next();
                        });
                    });
                }
            });
        }, function done(err) { nextJob(); });
    }

    function processData(job_data, baseUri, taskKey, dataKey, dataId, wfKey, cb) {
        var multi = rcl.multi();
        multi.hmset(dataKey, "uri", baseUri + '/data-' + dataId, 
                "name", job_data['@'].name, 
                "status", "not_ready", 
                function(err, ret) { });

        // add this data id to the sorted set of all workflw data
        // score: 0 (data not ready) or 1 (data ready)
        multi.zadd(wfKey+":data", 0 /* score */, dataId, function(err, ret) { });

        if (job_data['@'].link == 'input') {
            // add this data id to the sorted set of dependencies of this task.
            // score: i*1000+j, where i == 0 (dep. not fulfilled) or 1 (dep. fulfilled)
            // j == 0..999 ==> type of dependency (for future use). 0 = data element 
            multi.zadd(taskKey+":ins", 0 /* score i=0,j=0 */, dataId, function(err, ret) { });

            // add this task key to the set of sinks of this data element
            multi.sadd(dataKey+":sinks", taskKey);
        }
        if (job_data['@'].link == 'output') {
            // a similar set for all "products" (entities other tasks may be
            // dependent on). Score: 0..9999 ==> type of product. 0 = data element
            multi.zadd(taskKey+":outs", 0 /* score */, dataId, function(err, ret) { });

            // add this job key as a source of this data element
            multi.set(dataKey+":source", taskKey);
        }
        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
                cb(null, replies);
            }
        });
    }

    // returns a list of tasks with ids within [from..to], and their ins and outs
    function public_getTasks(wfId, from, to, cb) {
	rcl.zcard("wf:"+wfId+":data", function(err, ret) {
		dataNum = ret;
		if (to < 0) {
			rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
				if (err) {
					console.log("Error zcard: "+err);
				}
				var to1 = ret+to+1;
				//console.log("From: "+from+", to: "+to1);
				getTasks1(wfId, from, to1, dataNum, cb);
			});
		}  else {
			getTasks1(wfId, from, to, dataNum, cb);
		}
	});
    }

    function getTasks1(wfId, from, to, dataNum, cb) {
        var tasks = [], ins = [], outs = [], data  = [];
        var asyncTasks = [];
	var start, finish;
	start = (new Date()).getTime();
        for (var i=from; i<=to; ++i) {
            // The following "push" calls need to be wrapped in an anynomous function to create 
            // a separate scope for each value of "i". See http://stackoverflow.com/questions/2568966
            (function(i) {
                var taskKey = "wf:"+wfId+":task:"+i;
                // Retrieve task info
                asyncTasks.push(function(callback) {
                    rcl.hmget(taskKey, "uri", "name", "status", function(err, reply) {
                        if (err) {
                            tasks[i-from] = err;
                            callback(err);
                        } else {
                            tasks[i-from] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
                            callback(null, reply);
                        }
                    });
                });

                // Retrieve all ids of inputs of the task
                asyncTasks.push(function(callback) {
                    rcl.sort(taskKey+":ins", function(err, reply) {
                        if (err) {
                            ins[i-from] = err;
                            callback(err);
                        } else {
		            ins[i-from] = reply;
			    callback(null, reply);
			}
		    });
		});

                // Retrieve all ids of outputs of the task
                asyncTasks.push(function(callback) {
                    rcl.sort(taskKey+":outs", function(err, reply) {
                        if (err) {
                            outs[i-from] = err;
                            callback(err);
                        } else {
		            outs[i-from] = reply;
			    callback(null, reply);
			}
		    });
		});

            })(i);
        }

	// Retrieve info about ALL data elements (of this workflow). 
	// TODO: should be optimized so that it is done only once and cached in node process's memory.
        for (var i=1; i<=dataNum; ++i) {
            (function(i) {
                var dataKey = "wf:"+wfId+":data:"+i;
                asyncTasks.push(function(callback) {
                    rcl.hmget(dataKey, "uri", "name", "status", function(err, reply) {
                        if (err) {
                            data[i] = err;
                            callback(err);
                        } else {
                            data[i] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
                            callback(null, reply);
                        }
                    });
                });
	    })(i);
	}

	console.log("async tasks: "+asyncTasks.length);

	async.parallel(asyncTasks, function done(err, result) {
            if (err) {
                console.log(err);
                cb(err);
            } else {
	        finish = (new Date()).getTime();
	        console.log("getTasks exec time: "+(finish-start)+"ms");

		for (var i=0; i<tasks.length; ++i) {
			for (var j=0; j<ins[i].length; ++j) {
				ins[i][j] = data[ins[i][j]];
			}
			for (var k=0; k<outs[i].length; ++k) {
				outs[i][k] = data[outs[i][k]];
			}
		}

                cb(null, tasks, ins, outs);
            }
        });
    }

    // returns the number of tasks of a workflow
    function getNumTasks(wfId, cb) {
        rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
            if (err) {
                cb(err, null);
            } else {
                cb(null, ret);
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

    function getWfJson(wfname, cb) {
        if (wfname in workflow_cache) {
            cb(workflow_cache[wfname]);
        }
        else {
            var parser = new xml2js.Parser();
            fs.readFile(file, function(err, data) {
                if (err) cb(new Error("File read error. Doesn't exist?"));
                parser.parseString(data, function(err, result) {
                    if (err) cb(new Error("File parse error."));

                });
            });
            adag.parse(wfname + '.xml', wfname, baseUrl, function(w) {
                workflow_cache[wfname] = w;
                cb(workflow_cache[wfname]);
            });
        }
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


    function parse(file, wfname, baseUrl, cb) {
        var parser = new xml2js.Parser();

        parser.on('end', function(result) {
            // WARNING! Presently the callback is called right away, which means all the
            // remaining code in this function is OBSOLETE. Now it has been moved to 
            // createWfInstance method in app.js
            cb(null, result);
            return;

            ///////////////////////////////////
            // CODE BELOW NO LONGER ECECUTED //
            ///////////////////////////////////

            //var i, j, k, children, parents;
            var wf = result;
            var job_id = 0;

            // add baseUrl to the workflow template representation
            wf.baseUrl = baseUrl;

            // move info about parents to 'job' elements
            foreach(wf.job, function(job) {
                job['@'].status = 'waiting'; // initial status of all jobs - waiting for input data
                job['@'].job_id = ++job_id;
                job['@'].uri = baseUrl + '/workflow/' + wfname + '/task-' + job_id;
                foreach(wf.child, function(child) {
                    if (job['@'].id == child['@'].ref) {
                        job['@'].parents = child.parent; // assumes that child element always has some parent(s)

                        /*console.log(child['@'].ref);
                          foreach(child.parent, function(parent) {
                          console.log('    ' + parent['@'].ref);
                          });*/
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
                            'size': job_data['@'].size,
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
                                'size': job_data['@'].size,
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
                data.uri = baseUrl + '/workflow/' + wfname + '/data-' + id;
            });

            // add data element id and uri to each 'uses' element of each job
            // TODO: remove it from here and leave it only on creating WF instance
            // representation from WF template
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

            cb(null, wf);
        });

        fs.readFile(file, function(err, data) {
            if (err) cb(new Error("File read error. Doesn't exist?"));
            parser.parseString(data, function(err, result) {
                if (err) cb(new Error("File parse error."));

            });
        });

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
