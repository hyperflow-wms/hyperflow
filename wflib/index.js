/* Hypermedia workflow. 
 ** API over redis-backed workflow instance
 ** Author: Bartosz Balis (2013)
 */
var fs = require('fs'),
    redis = require('redis'),
    async = require('async'),
    rcl;

exports.init = function(redisClient) {
    // FIXME: only this module should have a connection to redis. Currently app.js creates
    // the client which has to be passed around other modules. (For testing purposes
    // optional passing of client could be possible);
    if (redisClient) {
	rcl = redisClient;
    }
    /*rcl.on("error", function (err) {
	console.log("redis error: " + err);
    });*/

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////
    
    function public_createInstanceFromFile(filename, baseUrl, cb) {
        fs.readFile(filename, 'utf8', function(err, data) {
            if (err) { 
                cb(err);
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

    // creates a new workflow instance from its JSON representation
    function public_createInstance(wfJson, baseUrl, cb) { 
        var instanceId;
	var start, finish; 
        rcl.incrby("wfglobal:nextId", 1, function(err, ret) {
            if (err) { throw(err); }
            instanceId = ret.toString();
            console.log("instanceId="+instanceId);
            createWfInstance(wfJson, baseUrl, instanceId, function(err) {
                cb(null, instanceId);
            });
        });
    }

    // TODO: currently workflow template is not stored in redis. 
    function public_getWfTemplate(wfname, cb) {

    }

    // returns a list of tasks with ids within [from..to], and their ins and outs
    function public_getWfTasks(wfId, from, to, cb) {
        rcl.zcard("wf:"+wfId+":data", function(err, ret) {
            var dataNum = ret;
            if (to < 0) {
                rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
                    if (err) { cb(err); return; }
                    var to1 = ret+to+1;
                    //console.log("From: "+from+", to: "+to1);
                    getTasks1(wfId, from, to1, dataNum, cb);
                });
            }  else {
                getTasks1(wfId, from, to, dataNum, cb);
            }
        });
    }

    // returns list of URIs of instances, ...
    // TODO
    function public_getWfInfo(wfName, cb) {
	    cb(null, []);
    }

    // returns a JSON object with fields uri, status, nTasks, nData
    // FIXME: currently also returns nextTaskId, nextDataId
    function public_getWfInstanceInfo(wfId, cb) {
	var multi = rcl.multi();
        multi.zcard("wf:"+wfId+":tasks", function(err, ret) { });
        multi.zcard("wf:"+wfId+":data", function(err, ret) { });
	multi.hgetall("wf:"+wfId, function(err, ret) { });
        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		replies[2].nTasks = replies[0];
		replies[2].nData = replies[1];
                cb(null, replies[2]);
            }
        });
    }

    function public_setWfInstanceState(wfId, obj, cb) {
	rcl.hmset("wf:"+wfId, obj, function(err, rep) {
	    cb(err, rep);
	});
    }

    function public_getWfIns(wfId, withports, cb) {
	if (withports) {
	    rcl.zrangebyscore("wf:"+wfId+":ins", 0, "+inf", "withscores", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore("wf:"+wfId+":ins", 0, "+inf", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	}
    }

    function public_getWfOuts(wfId, withports, cb) {
	if (withports) {
	    rcl.zrangebyscore("wf:"+wfId+":outs", 0, "+inf", "withscores", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore("wf:"+wfId+":outs", 0, "+inf", function(err, ret) { 
		err ? cb(err): cb(null, ret);
	    });
	}
    }

    function public_getWfInsAndOutsInfoFull(wfId, cb) {
        var multi = rcl.multi();
        var ins = [], outs = [];

        multi.zrangebyscore("wf:"+wfId+":ins", 0, "+inf", function(err, ret) { 
            ins = err ? err: ret;
        });
        rcl.zrangebyscore("wf:"+wfId+":outs", 0, "+inf", function(err, ret) { 
            outs = err ? err: ret;
        });

        multi.exec(function(err, replies) {
            if (err) {
                cb(err) 
            } else {
		for (var i=0; i<ins.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+ins[i];
			multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
			    if (err) {
				ins[i] = err;
			    } else {
				ins[i] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
			    }
			});
		    })(i);
		}
		for (var i=0; i<outs.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+outs[i];
			multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
			    if (err) {
				outs[i] = err;
			    } else {
				outs[i] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
			    }
			});
		    })(i);
		}

		multi.exec(function(err, replies) {
                    err ? cb(err): cb(null, ins, outs);
                });
            }
        });
    }

    function public_getTaskInfo(wfId, taskId, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	var task, ins, outs, data = {};

	var multi = rcl.multi();

	multi.hgetall(taskKey, function(err, reply) {
            err ? cb(err): cb(null, reply);
	});
    }

    function public_getTaskIns(wfId, taskId, withports, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	if (withports) {
	    rcl.zrangebyscore(taskKey+":ins", 0, "+inf", "withscores", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	}
    }

    function public_getTaskOuts(wfId, taskId, withports, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	if (withports) {
	    rcl.zrangebyscore(taskKey+":outs", 0, "+inf", "withscores", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	} else {
	    rcl.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
                err ? cb(err): cb(null, ret);
	    });
	}
    }

    // returns full task info
    function public_getTaskInfoFull(wfId, taskId, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	var task, ins, outs, data_ins = {}, data_outs = {};

	var multi = rcl.multi();

	// Retrieve task info
	multi.hgetall(taskKey, function(err, reply) {
            task = err ? err: reply;
	});

	// Retrieve all ids of inputs of the task
	multi.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
            ins = err ? err: ret;
	});

	// Retrieve all ids of outputs of the task
	multi.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
            outs = err ? err: ret;
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		for (var i=0; i<ins.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+ins[i];
			multi.hgetall(dataKey, function(err, reply) {
			    if (err) {
				data_ins[ins[i]] = err;
			    } else {
				data_ins[ins[i]] = reply;
                                data_ins[ins[i]].id = ins[i]; // TODO: redundant (key is the id)
                                                              // but WARNING: invoke currently may rely on it
			    }
			});
		    })(i);
		}
		for (var i=0; i<outs.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+outs[i];
			multi.hgetall(dataKey, function(err, reply) {
			    if (err) {
				data_outs[outs[i]] = err;
			    } else {
				data_outs[outs[i]] = reply;
                                data_outs[outs[i]].id = outs[i]; // TODO: redundant
			    }
			});
		    })(i);
		}

		multi.exec(function(err, replies) {
		    if (err) {
			cb(err);
		    } else {
			// replace ids of data elements with their attributes
			/*for (var i=0; i<ins.length; ++i) {
			    ins[i] = data[ins[i]];
			}
			for (var i=0; i<outs.length; ++i) {
			    outs[i] = data[outs[i]];
			}*/
			cb(null, task, data_ins, data_outs);
		    }
		});
            }
        });
    }

    function public_setTaskState(wfId, taskId, obj, cb) {
	rcl.hmset("wf:"+wfId+":task:"+taskId, obj, function(err, rep) {
	    cb(err, rep);
	});
    }

    function public_getDataInfo(wfId, dataId, cb) {
	var data, nSources, nSinks, dataKey; 
	var multi = rcl.multi();

	dataKey = "wf:"+wfId+":data:"+dataId;
	taskKeyPfx = "wf:"+wfId+":task:";

	// Retrieve data element info
	multi.hgetall(dataKey, function(err, reply) {
            data = err ? err: reply;
	});

	multi.zcard(dataKey+":sources", function(err, ret) {
		nSources = err ? err : ret;
	});

	multi.zcard(dataKey+":sinks", function(err, ret) {
		nSinks = err ? err : ret;
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		data.nSources = nSources;
		data.nSinks = nSinks;
		cb(null, data);
	    }
	});
    }

    // returns full data element info
    function public_getDataInfoFull(wfId, dataId, cb) {
	var data, sources, sinks, dataKey, taskKeyPfx, tasks = {};
	var multi = rcl.multi();

	dataKey = "wf:"+wfId+":data:"+dataId;
	taskKeyPfx = "wf:"+wfId+":task:";

	// Retrieve data element info
	multi.hgetall(dataKey, function(err, reply) {
            data = err ? err: reply;
	});

	// this is a great feature: sort+get combo (even for hashes)!
	multi.sort(dataKey+":sources", "get", taskKeyPfx+"*->uri",
			               "get", taskKeyPfx+"*->name",
			               "get", taskKeyPfx+"*->status",
	function(err, reply) {
	    if (err) {
		sources = err;
	    } else {
		sources = [];
		for (var i=0; i<reply.length; i+=3) {
			sources.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
		}
		//console.log("sources[0]: "+sources[0]);
	    }
	});

	multi.sort(dataKey+":sinks", "get", taskKeyPfx+"*->uri",
			             "get", taskKeyPfx+"*->name",
			             "get", taskKeyPfx+"*->status",
	function(err, reply) {
	    if (err) {
		sinks = err;
	    } else {
	        sinks = [];	
		for (var i=0; i<reply.length; i+=3) {
			sinks.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
		}
		//console.log("sinks[0]: "+sinks[0]);
	    }
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		cb(null, data, sources, sinks);
	    }
	});
    }


    // Change state of one or more data elements
    // - @spec: JSON object in the format: 
    //   { dataId: { attr: val, attr: val}, dataId: { ... } ... }
    //   e.g. { "1": { "status": "ready", "value": "33" } ... }
    function public_setDataState(wfId, spec, cb) {
        var multi = rcl.multi(),
            notEmpty = false;
        for (var i in spec) {
            //console.log(i, spec[i]);
            var obj = spec[i];
            if (Object.keys(spec).length) { // spec not empty
                (function(dataId, obj) {
                    //console.log(dataId, obj);
                    multi.hmset("wf:"+wfId+":data:"+dataId, obj, function(err, rep) { });
                    notEmpty = true;
                })(i, obj);
            }
        }
        if (notEmpty) {
            multi.exec(function(err, reps) {
                err ? cb(err): cb(null, reps);
            });
        }
    }

    // Returns a 'map' of a workflow. Should be passed a callback:
    // function(nTasks, nData, err, ins, outs, sources, sinks, types, cPortsInfo), where:
    // - nTasks        = number of tasks (also length of ins and outs arrays)
    // - nData         = number of data elements (also length of sources and sinks arrays)
    // - ins[i][j]     = data id mapped to j-th input port of i-th task
    // - outs[i][j]    = data id mapped to j-th output port of i-th task
    // - sources[i][1] = task id which produces data element with id=i (if none, sources[i]=[])
    // - sources[i][2] = port id in this task the data element is mapped to
    // - sinks[i][j]   = task id which consumes data element with id=i (if none, sinks[i]=[])
    // - sinks[i][j+1] = port id in this task the data element is mapped to
    // - types         = ids of tasks with type other than default "task"; format:
    //                   { "foreach": [1,2,5], "service": [3,4] }
    // - cPortsInfo    = information about all control ports of all tasks; format:
    //                   { taskId: { "ins": { portName: dataId } ... }, "outs": { ... } } }
    //                   e.g.: { '1': { ins: { next: '2' }, outs: { next: '2', done: '4' } } } 
    function public_getWfMap(wfId, cb) {
        var wfKey = "wf:"+wfId;
	rcl.zcard(wfKey+":tasks", function(err, ret) {
	    var nTasks = ret; 
	    rcl.zcard(wfKey+":data", function(err, ret) {
		var nData = ret;
		var types = {}, ins = [], outs = [], sources = [], sinks = [], cPortsInfo = {}, taskKey;
		var multi = rcl.multi();
		for (var i=1; i<=nTasks; ++i) {
		    (function(taskId) {
			taskKey = wfKey+":task:"+taskId;
			multi.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
			    ins[taskId] = ret;
			    //ins[taskId].unshift(null); // inputs will be indexed from 1 instead of 0
			});
			multi.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
			    outs[taskId] = ret;
			    //outs[taskId].unshift(null);
			});
                        multi.hgetall(taskKey+":cins", function(err, ret) {
                            if (ret != null) {
                                cPortsInfo[taskId] = {};
                                cPortsInfo[taskId].ins = ret;
                            }
                        });
                        multi.hgetall(taskKey+":couts", function(err, ret) {
                            if (ret != null) {
                                if (!(taskId in cPortsInfo)) {
                                    cPortsInfo[taskId] = {};
                                }
                                cPortsInfo[taskId].outs = ret;
                            }
                        });
		    })(i);
		}
		for (i=1; i<=nData; ++i) {
		    (function(dataId) {
			dataKey = wfKey+":data:"+dataId;
			multi.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
			    sources[dataId] = ret;
			    //console.log(dataId+";"+ret);
			    //sources[dataId].unshift(null);
			});
			/*multi.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
			    if (err) {
			    }
			    sinks[dataId] = ret;
			    //sinks[dataId].unshift(null);
			});*/
		    })(i);
		}
                // Create info about task types (all remaining tasks have the default type "task")
                // TODO: pull the list of types dynamically from redis
                ["foreach", "service", "splitter", "stickyservice"].forEach(function(type) {
                    multi.smembers(wfKey+":tasktype:"+type, function(err, rep) {
                        if (rep) {
                            //console.log(type, rep); // DEBUG
                            types[type] = rep;
                        }
                    });
                });
		multi.exec(function(err, reps) {
		    if (err) {
			cb(err);
		    } else {
			cb(null, nTasks, nData, ins, outs, sources, sinks, types, cPortsInfo);
		    }
		});
	    });
	});
    }

    /*
     * returns task map, e.g.:
     * ins  = [1,4] ==> input data ids
     * outs = [2,3] ==> output data ids
     * sources = { 1: [], 4: [] }  
     *                      ==> which task(s) (if any) produced a given input
     * sinks   = { 2: [108,1,33,3], 3: [108,2,33,4] } 
     *                      ==> which task(s) (if any) consume a given output
     *                          "108,1" means task 108, port id 1
     */
    function public_getTaskMap(wfId, taskId, cb) {
	var ins = [], outs = [], sources = {}, sinks = {};
	var multi = rcl.multi();
	var taskKey = "wf:"+wfId+":task:"+taskId;
	multi.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
	    ins = ret;
	});
	multi.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
	    outs = ret;
	});
	multi.exec(function(err, reps) {
	    if (err) {
		cb(err);
	    } else {
		for (var i in ins) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+ins[i];
			multi.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
			    sources[ins[i]] = ret;
			});
		    })(i);
		}
		for (var i in outs) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+outs[i];
			multi.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
			    sinks[outs[i]] = ret;
			});
		    })(i);
		}
		multi.exec(function(err, reps) {
		    cb(null, ins, outs, sources, sinks);
		});
	    }
	});
    }

    function public_getDataSources(wfId, dataId, cb) {
	var dataKey = "wf:"+wfId+":data:"+dataId;
	rcl.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
            err ? cb(err): cb(null, ret);
	});
    }

    // Retrieves a list of data sinks (tasks). FIXME: workaround for very big lists:
    // retrieves a chunk of 1000 elements at a time from redis, because on windows 
    // (redis 2.4.x) larger replies sometimes don't work (probably a bug...)
    function public_getDataSinks(wfId, dataId, cb) {
	var replies = [], reply = [];
	var dataKey = "wf:"+wfId+":data:"+dataId;
	var multi = rcl.multi();

	rcl.zcard(dataKey+":sinks", function(err, rep) {
	    for (var i=0,j=1; i<=rep; i+=1000,j++) {
		(function(i,j) {
		    multi.zrangebyscore(
			dataKey+":sinks", 0, "+inf", "withscores", "limit", i, "1000", 
			function(err, ret) { 
			replies[j] = ret;
		    });
		})(i,j);
	    }
	    multi.exec(function(err, replies) {
		if (err) {
		    cb(err);
		} else {
		    for (var i=0; i<replies.length; ++i) {
			reply = reply.concat(replies[i]);
		    }
		    cb(null, reply);
		}
	    });
	});
    }

    // Retrieves a list of remote data sinks (tasks). Such sinks are notified over
    // HTTP using their full URI. 
    // FIXME: workaround for very big lists: retrieves a chunk of 1000 elements 
    // at a time from redis, because on windows (redis 2.4.x) larger replies 
    // sometimes don't work (probably a bug...)
    function public_getRemoteDataSinks(wfId, dataId, cb) {
	var replies = [], reply = [];
	var dataKey = "wf:"+wfId+":data:"+dataId;
	var multi = rcl.multi();

	rcl.zcard(dataKey+":sinks", function(err, rep) {
	    for (var i=0,j=1; i<=rep; i+=1000,j++) {
		(function(i,j) {
		    // if score (port id) = -1, the sink is remote
		    multi.zrangebyscore(
			dataKey+":sinks", -1, -1, "withscores", "limit", i, "1000", 
			function(err, ret) { 
			    replies[j] = ret;
			});
		})(i,j);
	    }
	    multi.exec(function(err, replies) {
		if (err) {
		    cb(err);
		} else {
		    for (var i=0; i<replies.length; ++i) {
			reply = reply.concat(replies[i]);
		    }
		    // retrieve URIs and store them instead of port id
		    for (var i=0; i<reply.length; i+=2) {
			(function(i) {
			    var dataKey = "wf:"+wfId+":data:"+reply[i];
			    multi.hmget(dataKey, "uri", function(err, rep) {
				reply[i+1] = rep;
			    });
			})(i);
		    }
		    multi.exec(function(err, reps) {
			cb(null, reply);
		    });
		}
	    });
	});
    }

    // invokes function assinged to task passing input and output objects whose
    // ids are in arrays 'insIds' and 'outsIds'. 
    function public_invokeTaskFunction(wfId, taskId, insIds_, outsIds_, emulate, cb) {
        function isArray(what) {
            return Object.prototype.toString.call(what) === '[object Array]';
        }
        var insIds = [], outsIds = [];
        isArray(insIds_) ? insIds = insIds_: insIds.push(insIds_);
        isArray(outsIds_) ? outsIds = outsIds_: outsIds.push(outsIds_);

        public_getTaskInfoFull(wfId, taskId, function(err, taskInfo, taskIns, taskOuts) {
            if (err) {
                cb(err);
            } else if (emulate) {
                var outs = [];
                for (var i in outsIds) {
                    outs.push(taskOuts[outsIds[i]]);
                }                   
                setTimeout(function() {
                    cb(null, outs);
                }, 100);
            } else {
                if ((taskInfo.fun == "null") || (!taskInfo.fun)) {
                    cb(null, null);
                    return;
                }
                rcl.hgetall("wf:functions:"+taskInfo.fun, function(err, fun) {
                    if (err) {
                        cb(err);
                        return;
                    }
                    // FIXME: how to know the (relative?) path to the module?
                    var f = require('../'+fun.module)[taskInfo.fun]; 
                    var ins = [], outs = [];
                    for (var i in insIds) {
                        ins.push(taskIns[insIds[i]]);
                    }
                    for (var i in outsIds) {
                        outs.push(taskOuts[outsIds[i]]);
                    }                   
		    //console.log(JSON.stringify(taskInfo.config));  //DEBUG
		    var conf     = taskInfo.config ? JSON.parse(taskInfo.config): null, 
			executor = taskInfo.executor ? taskInfo.executor: null;

                    f(ins, outs, executor, conf, function(err, outs) {
                        if (outs) { console.log("VALUE="+outs[0].value); } // DEBUG 
                        cb(null, outs);
                        // write values if any
                        /*var spec = {};
                        outs.forEach(function(out) {
                            if ("value" in out) {
                                spec[out.id] = { "value": out.value };
                            }
                        });
                        //console.log(spec);
                        if (Object.keys(spec).length) { // not empty
                            console.log(spec); // DEBUG
                            public_setDataState(wfId, spec, function(err, reps) {
                                cb(null, outs);
                            });
                        }*/
                    });
                });
            }
        });
    }

    return {
        createInstance: public_createInstance,
        createInstanceFromFile: public_createInstanceFromFile,
	getWfInfo: public_getWfInfo,
	getWfInstanceInfo: public_getWfInstanceInfo,
	setWfInstanceState: public_setWfInstanceState,
	getWfTasks: public_getWfTasks,
	getWfIns: public_getWfIns,
	getWfOuts: public_getWfOuts,
        getWfInsAndOutsInfoFull: public_getWfInsAndOutsInfoFull,
	getTaskInfo: public_getTaskInfo,
	getTaskInfoFull: public_getTaskInfoFull,
	getTaskIns: public_getTaskIns,
	getTaskOuts: public_getTaskOuts,
	setTaskState: public_setTaskState,
	getDataInfo: public_getDataInfo,
        getDataInfoFull: public_getDataInfoFull,
	setDataState: public_setDataState,
        getDataSources: public_getDataSinks,
        getDataSinks: public_getDataSinks,
	getRemoteDataSinks: public_getRemoteDataSinks,
	getWfMap: public_getWfMap,
	getTaskMap: public_getTaskMap,
        invokeTaskFunction: public_invokeTaskFunction
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
            var taskId = i+1, uri;
	    if  (wfJson.tasks[i].host) { // TODO: preparation to handle remote sinks
		    uri = wfJson.tasks[i].host + '/workflow/' + wfname + '/instances/' + instanceId;
	    } else {
		    uri = baseUri;
	    } 
            taskKey = wfKey+":task:"+taskId;
            processTask(wfJson.tasks[i], wfname, uri, wfKey, taskKey, taskId, wfJson, function() { });
        }

        // add workflow data and control "signals"
        var multi = rcl.multi();
        var dataKey;
        for (var i=0; i<wfJson.data.length; ++i) {
            (function(i) {
                var dataId = i+1, score = -1;
                dataKey = wfKey+":data:"+dataId;
                if (wfJson.data[i].control) { // this is a control signal
                    multi.hmset(dataKey, 
                        "uri", baseUri + '/control-' + dataId, 
                        "name", wfJson.data[i].name, 
                        "type", "control", 
                        function(err, ret) { });
                    score = 2;
                } else {                     // this is a data signal
                    multi.hmset(dataKey, 
                        "uri", baseUri + '/data-' + dataId, 
                        "name", wfJson.data[i].name, 
                        "status", "not_ready", 
                        function(err, ret) { });
                    score = 0;
                }

                // add this data id to the sorted set of all workflow signals
                // score determines the type/status of the signal:
                // 0: data signal/not ready, 1: data signal/ready, 2: control signal
                multi.zadd(wfKey+":data", score, dataId, function(err, ret) { });
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

    function processTask(task, wfname, baseUri, wfKey, taskKey, taskId, wfJson, cb) {
        // TODO: here there could be a validation of the task, e.g. Foreach task 
        // should have the same number of ins and outs, etc.
        var multi=rcl.multi();
	var taskType = task.type ? task.type.toLowerCase() : "task";

        multi.hmset(taskKey, 
                "uri", baseUri+"/task-"+taskId, 
                "name", task.name, 
                "status", "waiting", 
                "type", taskType,
		"fun", task.function ? task.function: "null",
		"config", task.config ? JSON.stringify(task.config): "null",
                //"execName", task.name, 
                //"execArgs", task.execArgs, 
                //"execSSHAddr", "balis@192.168.252.130", 
                function(err, ret) { });

        // add task id to sorted set of all wf tasks. Score 0/1/2==waiting/running/finished
        multi.zadd(wfKey+":tasks", 0 /* score */, taskId, function(err, ret) { });

	// For every task of type other than "task" (e.g. "foreach", "service"), add its 
        // id to a type set. 
	// Engine uses this to know which FSM instance to create
	// TODO: need additional, "global" set with all possible task type names
        if (taskType != "task") {
            multi.sadd(wfKey+":tasktype:"+taskType, taskId);
        }

        // add task inputs and outputs + data sources and sinks
        for (var i=0; i<task.ins.length; ++i) {
            (function(inId, dataId) {
                var dataKey = wfKey+":data:"+dataId;
                multi.zadd(taskKey+":ins", inId, dataId, function(err, rep) { });
                multi.zadd(dataKey+":sinks", inId /* score: port id */ , taskId, function(err, ret) { });
                if (wfJson.data[dataId-1].control) { // add all control inputs to a separate hash
                    // FIXME: this way of storing implies that input control port names must be unique
                    // (but it's arguably a good thing that will not have to be changed in the future)
                    multi.hmset(taskKey+":cins", wfJson.data[dataId-1].name, dataId);
                }
            })(i+1, task.ins[i]+1);
        }
        for (var i=0; i<task.outs.length; ++i) {
            (function(outId, dataId) {
                var dataKey = wfKey+":data:"+dataId;
                multi.zadd(taskKey+":outs", outId, dataId, function(err, rep) { });
                multi.zadd(dataKey+":sources", outId /* score: port Id */, taskId, function(err, ret) { });
                if (wfJson.data[dataId-1].control) { // add all control outputs to a separate hash
                    // FIXME: this way of storing implies that output control port names must be unique
                    // (but it's arguably a good thing that will not have to be changed in the future)
                    multi.hmset(taskKey+":couts", wfJson.data[dataId-1].name, dataId);
                }
            })(i+1, task.outs[i]+1);
        }
        multi.exec(function(err, replies) {
            cb();
        });
    }


    // TODO: rewrite this to use multi instead of async.parallel ?
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
                    rcl.hmget(taskKey, "uri", "name", "status", "fun", function(err, reply) {
                        if (err) {
                            tasks[i-from] = err;
                            callback(err);
                        } else {
                            tasks[i-from] = {
				    "uri": reply[0], 
				    "name": reply[1], 
			            "status": reply[2],
			            "fun": reply[3]
			    };
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

	// Retrieve info about ALL data elements (of this wf instance). 
	// FIXME: can it be done better (more efficiently)? 
	// - Could be cached in node process's memory but then data may not be fresh.
	// - We could calculate which subset of data elements we need exactly but that
	//   implies additional processing and more complex data structures...
	// - MULTI instead of many parallel tasks?
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
                cb(err);
            } else {
	        finish = (new Date()).getTime();
	        console.log("getTasks exec time: "+(finish-start)+"ms");

		// replace ids of data elements with their attributes
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
};
