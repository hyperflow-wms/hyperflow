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
                    if (err) return cb(err); 
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
        rcl.hgetall(taskKey, function(err, reply) {
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

    // Returns full task info. Format:
    // TODO ......
    function public_getTaskInfoFull(wfId, taskId, cb) {
        var taskKey = "wf:"+wfId+":task:"+taskId;
        var task, ins, outs, data_ins = {}, data_outs = {}, asyncTasks = [];

        // Retrieve task info
        asyncTasks.push(function(callback) {
            rcl.hgetall(taskKey, function(err, reply) {
                task = err ? err: reply;
                callback(null, task);
            });
        });

        // Retrieve all ids of inputs of the task
        asyncTasks.push(function(callback) {
            rcl.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
                ins = err ? err: ret;
                callback(null, ins);
            });
        });

        // Retrieve all ids of outputs of the task
        asyncTasks.push(function(callback) {
            rcl.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
                outs = err ? err: ret;
                callback(null, outs);
            });
        });

        async.parallel(asyncTasks, function done(err, result) {
            if (err) {
                cb(err);
            } else {
                asyncTasks = [];
                for (var i=0; i<ins.length; ++i) {
                    (function(i) {
                        var dataKey = "wf:"+wfId+":data:"+ins[i];
                        asyncTasks.push(function(callback) {
                            rcl.hgetall(dataKey, function(err, reply) {
                                if (err) {
                                    data_ins[ins[i]] = err;
                                } else {
                                    data_ins[ins[i]] = reply;
                                    data_ins[ins[i]].id = ins[i]; // TODO: redundant (key is the id)
                                    // but WARNING: invoke currently may rely on it
                                }
                                callback(null, reply);
                            });
                        });
                    })(i);
                }
                for (var i=0; i<outs.length; ++i) {
                    (function(i) {
                        var dataKey = "wf:"+wfId+":data:"+outs[i];
                        asyncTasks.push(function(callback) {
                            rcl.hgetall(dataKey, function(err, reply) {
                                if (err) {
                                    data_outs[outs[i]] = err;
                                } else {
                                    data_outs[outs[i]] = reply;
                                    data_outs[outs[i]].id = outs[i]; // TODO: redundant
                                }
                                callback(null, reply);
                            });
                        });
                    })(i);
                }

                async.parallel(asyncTasks, function done(err, result) {
                    if (err) {
                        cb(err);
                    } else {
                        cb(null, task, data_ins, data_outs);
                    }
                });
            }
        });
    }

    // Part of NEW API for continuous processes with FIFO queues
    function public_getTaskInfoFull1(wfId, taskId, insIds, outsIds, cb) {
        var taskKey = "wf:"+wfId+":task:"+taskId;
        var task, ins, outs, data_ins = {}, data_outs = {}, asyncTasks = [];

        // Retrieve task info
        asyncTasks.push(function(callback) {
            rcl.hgetall(taskKey, function(err, reply) {
                task = err ? err: reply;
                callback(null, task);
            });
        });

        // Retrieve all inputs of the task given in 'insIds'
        for (i=0; i<insIds.length; ++i) {
            (function(inIdx) {
                var sigQueueKey = "wf:"+wfId+":task:"+taskId+":ins:"+insIds[inIdx];
                var sigInstanceKey = "wf:"+wfId+":sigs:"+sigId+":"+idx;
                asyncTasks.push(function(callback) {
                    rcl.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
                        ins = err ? err: ret;
                        callback(null, ins);
                    });
                });
            })(i);
        }

        // Retrieve all outputs of the task given in 'outsIds'
        asyncTasks.push(function(callback) {
            rcl.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
                outs = err ? err: ret;
                callback(null, outs);
            });
        });

        async.parallel(asyncTasks, function done(err, result) {
            if (err) {
                cb(err);
            } else {
                asyncTasks = [];
                for (var i=0; i<ins.length; ++i) {
                    (function(i) {
                        var dataKey = "wf:"+wfId+":data:"+ins[i];
                        asyncTasks.push(function(callback) {
                            rcl.hgetall(dataKey, function(err, reply) {
                                if (err) {
                                    data_ins[ins[i]] = err;
                                } else {
                                    data_ins[ins[i]] = reply;
                                    data_ins[ins[i]].id = ins[i]; // TODO: redundant (key is the id)
                                    // but WARNING: invoke currently may rely on it
                                }
                                callback(null, reply);
                            });
                        });
                    })(i);
                }
                for (var i=0; i<outs.length; ++i) {
                    (function(i) {
                        var dataKey = "wf:"+wfId+":data:"+outs[i];
                        asyncTasks.push(function(callback) {
                            rcl.hgetall(dataKey, function(err, reply) {
                                if (err) {
                                    data_outs[outs[i]] = err;
                                } else {
                                    data_outs[outs[i]] = reply;
                                    data_outs[outs[i]].id = outs[i]; // TODO: redundant
                                }
                                callback(null, reply);
                            });
                        });
                    })(i);
                }

                async.parallel(asyncTasks, function done(err, result) {
                    if (err) {
                        cb(err);
                    } else {
                        cb(null, task, data_ins, data_outs);
                    }
                });
            }
        });
    }

    function pushInput(wfId, taskId, sigId, sigIdx, cb) {
        var queueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sigId;
        // checking if this input signal is on a 'sticky' port
        rcl.sismember("wf:"+wfId+":task:"+taskId+":sticky", sigId, function(err, isSticky) {
            if (isSticky) {
                // if the input is 'sticky', the new signal is not queued, only replaces the old one
                // (there is no queue of signals, just the 'currrent' signal value)
                rcl.llen(queueKey, function(err, llen) {
                    if (llen) {
                        rcl.lset(queueKey, 0, sigIdx, function(err, rep) { 
                            cb(err); 
                        });
                    } else {
                        rcl.rpush(queueKey, sigIdx, function(err, rep) { 
                            cb(err); 
                        });
                    }
                    console.log("STICKY PUSH sigId=", sigId, "LLEN=", llen, "Idx=", sigIdx);
                });

            } else {
                rcl.rpush(queueKey, sigIdx, function(err, rep) { 
                    rcl.llen(queueKey, function(err, llen) {
                        console.log("PUSH sigId=", sigId, "LLEN=", llen, "Idx=", sigIdx);
                        cb(err); 
                    });
                });
            }
        });
    }

    function popInput(wfId, taskId, sigId, cb) {
        var sigQueueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sigId;
        var sigInstanceKey = "wf:"+wfId+":sigs:"+sigId;
        // checking if this input signal is on a 'sticky' port
        rcl.sismember("wf:"+wfId+":task:"+taskId+":sticky", sigId, function(err, isSticky) {
            if (isSticky) {
                //console.log("STICKY!", taskId, sigId);
                // if the input is 'sticky', the signal is not removed, just its value is retrieved
                // (there is no queue of signals, just the 'currrent' signal value which is persistent)
                rcl.lindex(sigQueueKey, 0, function(err, sigIdx) { 
                    rcl.hget(sigInstanceKey, sigIdx, function(err, sigValue) {
                        var sig = JSON.parse(sigValue);
                        //sig._id = sigId;
                        cb(err, sig); 
                    });
                });
            } else {
                rcl.lpop(sigQueueKey, function(err, sigIdx) { 
                    rcl.hget(sigInstanceKey, sigIdx, function(err, sigValue) {
                        var sig = JSON.parse(sigValue);
                        //sig._id = sigId;
                        rcl.hlen(sigInstanceKey, function(err, hlen) {
                            rcl.llen(sigQueueKey, function(err, llen) {
                                console.log("sigId=", sigId, "LLEN=", llen, "HLEN=", hlen, "Idx=", sigIdx);
                                cb(err, sig); 
                            });
                        });
                    });
                });
            }
        });
    }

    function resetStickyPorts(wfId, taskId, cb) {
        rcl.smembers("wf:"+wfId+":task:"+taskId+":sticky", function(err, sigs) {
            async.each(sigs, function(sigId, cbNext) {
                var queueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sigId;
                rcl.lpop(queueKey, function(err, rep) { 
                    rcl.llen(queueKey, function(err, len) {
                        console.log(queueKey, "LEN="+len);
                        cbNext(err);
                    });
                });
            },
            function(err) {
                err ? cb(null): cb(err);
            });
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
    // OBSOLETED BY getSignalInfo
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

    // given @sigs - an array of signal Ids, returns their information (metadata)
    // - @sigs: array of signal ids, e.g [1,3,7]
    // - @cb = function(err, sigInfo), where sigInfo the output array 
    //   sigInfo[i] = { "_id": sigId, attr: value, attr: value, ... }
    function getSignalInfo(wfId, sigs, cb) {
        var asyncTasks = [], sigInfo = [];
        for (var i=0; i<sigs.length; ++i) {
            (function(idx) {
                asyncTasks.push(function(callback) {
                    var sigId = sigs[idx];
                    sigKey = "wf:"+wfId+":data:"+sigId; 
                    rcl.hgetall(sigKey, function(err, sig) { 
                        if (err || sig == -1) { callback(new Error("Redis error")); }
                        sigInfo[idx] = sig;
                        sigInfo[idx]._id = sigId;
                        sigInfo[idx].id = sigId; // FIXME compatibility with OLD API: to be removed
                        callback(null, sig);
                    });
                });
            })(i);
        }
        async.parallel(asyncTasks, function done(err, result) {
            cb(err, sigInfo);
        });
    }

    // checks if given input signals are ready (in the queues), and returns their values
    // @spec format: [ [ sigId, count], [sigId, count], ... ]
    // @deref (boolean): if true and all sigs are ready, their values will be returned
    // @cb: function(result, [sigValues])
    //   result: true if 'count' instances of each signal 'sigId' are present in the queues
    //   sigValues (optional) format: [ [ spec[0] signal values ], [ spec[1] signal values ], ... ]
    //                       example: [ [ { name: 'filename',
    //                                      path: 'tmp1/asynctest.js',
    //                                      uri: '/workflow/Wf_continuous_file_splitter/instances/1/data-1',
    //                                      _id: '1',
    //                                      _ts: 8 
    //                                } ] ]
    //   
    function fetchInputs(wfId, taskId, spec, deref, cb) {
        var sigValues = [];
        async.every(spec, function (sig, callback) {
            var queueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sig[0];
            rcl.llen(queueKey, function(err, len) {
                //console.log("FETCH SIG", sig, "LEN", len);
                callback(!err && len>=sig[1]); 
            });
        }, function(result) {
            if (!result || !deref) return cb(result);
            async.times(spec.length, function(n, cbNext) {
                sigValues[n] = [];
                async.timesSeries(spec[n][1] /* count */, function(m, cbNextInner) {
                    popInput(wfId, taskId, spec[n][0] /* sigId */, function(err, sig) {
                        sigValues[n].push(sig);
                        cbNextInner();
                    });
                }, function(err, res) {
                    cbNext();
                });
            }, function(err, res) {
                console.log("CHECK INPUT DEREF:", sigValues);
                cb(result, sigValues);
            });
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
    var asyncTasks = [];
    var wfKey = "wf:"+wfId;
    rcl.zcard(wfKey+":tasks", function(err, ret) {
        if (err || ret == -1) { throw(new Error("Redis error")); }
        var nTasks = ret; 
        rcl.zcard(wfKey+":data", function(err, ret) {
            if (err || ret == -1) { throw(new Error("Redis error")); }
            var nData = ret;
            var types = {}, ins = [], outs = [], sources = [], sinks = [], cPortsInfo = {}, taskKey;
            //var multi = rcl.multi();
            for (var i=1; i<=nTasks; ++i) {
                (function(taskId) {
                    asyncTasks.push(function(callback) {
                        taskKey = wfKey+":task:"+taskId;
                        rcl.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
                            if (err || ret == -1) { throw(new Error("Redis error")); }
                            ins[taskId] = ret;
                            callback(null, ret);
                            //ins[taskId].unshift(null); // inputs will be indexed from 1 instead of 0
                        });
                    });
                    asyncTasks.push(function(callback) {
                        rcl.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
                            if (err || ret == -1) { throw(new Error("Redis error")); }
                            outs[taskId] = ret;
                            //outs[taskId].unshift(null);
                            callback(null, ret);
                        });
                    });
                    asyncTasks.push(function(callback) {
                        rcl.hgetall(taskKey+":cins", function(err, ret) {
                            if (err || ret == -1) { throw(new Error("Redis error")); }
                            if (ret != null) {
                                cPortsInfo[taskId] = {};
                                cPortsInfo[taskId].ins = ret;
                            }
                            callback(null, ret);
                        });
                    });
                    asyncTasks.push(function(callback) {
                        rcl.hgetall(taskKey+":couts", function(err, ret) {
                            if (err || ret == -1) { throw(new Error("Redis error")); }
                            if (ret != null) {
                                if (!(taskId in cPortsInfo)) {
                                    cPortsInfo[taskId] = {};
                                }
                                cPortsInfo[taskId].outs = ret;
                            }
                            callback(null, ret);
                        });
                    });
                })(i);
            }
            for (i=1; i<=nData; ++i) {
                (function(dataId) {
                    dataKey = wfKey+":data:"+dataId;
                    asyncTasks.push(function(callback) {
                        rcl.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
                            if (err || ret == -1) { throw(new Error("Redis error")); }
                            sources[dataId] = ret;
                            //console.log(dataId+";"+ret);
                            //sources[dataId].unshift(null);
                            callback(null, ret);
                        });
                        /*multi.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
                          if (err) {
                          }
                          sinks[dataId] = ret;
                        //sinks[dataId].unshift(null);
                        });*/
                    });
                })(i);
            }
            // Create info about task types (all remaining tasks have the default type "task")
            // TODO: pull the list of types dynamically from redis
            asyncTasks.push(function(callback) {
                async.each(["foreach", "service", "splitter", "csplitter", "stickyservice", "choice", "dataflow"],
                    function iterator(type, next) {
                        rcl.smembers(wfKey+":tasktype:"+type, function(err, rep) {
                            if (err || rep == -1) { throw(new Error("Redis error")); }
                            if (rep) {
                                //console.log(type, rep); // DEBUG
                                types[type] = rep;
                            }
                            next();
                        });
                    },
                    function done(err) {
                        callback(null, types);
                    }
                    );
            });

            console.log("async tasks: "+asyncTasks.length);
            async.parallel(asyncTasks, function done(err, result) {
                cb(null, nTasks, nData, ins, outs, sources, sinks, types, cPortsInfo);
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

// Retrieves a list of data sinks (tasks). 
function public_getDataSinks(wfId, dataId, withports, cb) {
    var dataKey = "wf:"+wfId+":data:"+dataId;

    if (withports) {
        rcl.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
            err ? cb(err): cb(null, ret);
        });
    } else {
        rcl.zrangebyscore(dataKey+":sinks", 0, "+inf", function(err, ret) { 
            err ? cb(err): cb(null, ret);
        });
    }
}


// Retrieves a list of remote data sinks (tasks). Such sinks are notified over
// HTTP using their full URI. 
function public_getRemoteDataSinks(wfId, dataId, cb) {
    var replies = [], reply = [];
    var dataKey = "wf:"+wfId+":data:"+dataId;
    var multi = rcl.multi();

    rcl.zcard(dataKey+":sinks", function(err, rep) {
        multi.zrangebyscore(dataKey+":sinks", -1, -1, "withscores", function(err, ret) { 
            err ? cb(err): cb(null, ret);
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
                return cb(null, null);
            }
            rcl.hgetall("wf:functions:"+taskInfo.fun, function(err, fun) {
                if (err) return cb(err);
                // FIXME: how to know the (relative?) path to the module?
                var f = require('../'+fun.module)[taskInfo.fun]; 
                var ins = [], outs = [];
                for (var i in insIds) {
                    ins.push(taskIns[insIds[i]]);
                }
                for (var i in outsIds) {
                    outs.push(taskOuts[outsIds[i]]);
                }                   
                //console.log("INS:", ins);
                //console.log("OUTS:", outs);
                //console.log(JSON.stringify(taskInfo.config));  //DEBUG
                var conf = taskInfo.config ? JSON.parse(taskInfo.config): null, 
                executor = taskInfo.executor ? taskInfo.executor: null;

            f(ins, outs, executor, conf, function(err, outs) {
                //if (outs) { console.log("VALUE="+outs[0].value); } // DEBUG 
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

// Part of NEW API for continuous processes with FIFO queues
// invokes function assinged to task passing input signal values and output signal placeholders
// whose ids are in arrays 'insIds' and 'outsIds'. 
function public_invokeTaskFunction1(wfId, taskId, insIds_, outsIds_, emulate, cb) {
    function isArray(what) {
        return Object.prototype.toString.call(what) === '[object Array]';
    }
    var insIds = [], outsIds = [];
    isArray(insIds_) ? insIds = insIds_: insIds.push(insIds_);
    isArray(outsIds_) ? outsIds = outsIds_: outsIds.push(outsIds_);

    var ins = [], outs = [];

    public_getTaskInfo(wfId, taskId, function(err, taskInfo) {
        if (err) return cb(err); 

        var asyncTasks = [];

        // retrieve inputs signals given in 'insIds' from their queues
        for (i=0; i<insIds.length; ++i) {
            (function(idx) {
                asyncTasks.push(function(callback) {
                    popInput(wfId, taskId, insIds[idx], function(err, inValue) {
                        ins[idx] = inValue;
                        callback(err, inValue);
                    });
                });
            })(i);
        }

        // retrieve task outputs given in 'outsIds'
        for (i=0; i<outsIds.length; ++i) {
            (function(idx) {
                asyncTasks.push(function(callback) {
                    var dataKey = "wf:"+wfId+":data:"+outsIds[idx];
                    rcl.hgetall(dataKey, function(err, dataInfo) {
                        outs[idx] = dataInfo;
                        callback(err, dataInfo);
                    });
                })
            })(i);
        }

        async.parallel(asyncTasks, function done(err, result) {
            if (err) return cb(err);

            if (emulate) {
                setTimeout(function() {
                    return cb(null, outs);
                }, 100);
            }

            if ((taskInfo.fun == "null") || (!taskInfo.fun)) {
                return cb(new Error("No function defined for task."));
            }

            /////////////////////////
            // INVOKE THE FUNCTION //
            /////////////////////////

            rcl.hgetall("wf:functions:"+taskInfo.fun, function(err, fun) {
                if (err) return cb(err);
                // FIXME: how to know the (relative?) path to the module?
                var f = require('../'+fun.module)[taskInfo.fun]; 
                //console.log("INS:", ins);
                //console.log("OUTS:", outs);
                //console.log(JSON.stringify(taskInfo.config));  //DEBUG
                var conf = taskInfo.config ? JSON.parse(taskInfo.config): null; 
                var executor = taskInfo.executor ? taskInfo.executor: null;

                f(ins, outs, executor, conf, function(err, outs) {
                    //if (outs) { console.log("VALUE="+outs[0].value); } // DEBUG 
                    cb(null, outs);
                });
            });
        });
    });
}


// Part of NEW API for continuous processes with FIFO queues
// @sig format:
// ... TODO
// TODO: implement as a Lua script
function public_sendSignal(wfId, sig, cb) {
    //console.log("sendSignal:", sig);
    var sigId = sig._id;
    delete sig._id;

    // create a new instance of this signal (at hash = "wf:{id}:sigs:{sigId}", field = sig instance id)
    // (signal with a given id may be emitted multiple times within a workflow execution)
    // (hash is better than a list because of easier cleanup of old signals)
    rcl.incr("wf:"+wfId+":sigs:"+sigId+":nextId", function(err, rep) {
        if (err) return cb(err); 
        var idx = rep.toString();
        var sigInstanceKey = "wf:"+wfId+":sigs:"+sigId;
        rcl.hset(sigInstanceKey, idx, JSON.stringify(sig), function(err, rep) {
            if (err) { 
                cb(err); 
            } else {
                public_getDataSinks(wfId, sigId, false, function(err, sinks) {
                    //console.log("sendSignal: ", sigId, sinks);
                    if (err) { 
                        cb(err);
                    } else {
                        // insert the signal (its index in the hash) in the queues of its sinks
                        //console.log("SINKS: ", sinks);
                        async.each(sinks, function iterator(taskId, doneIter) {
                            pushInput(wfId, taskId, sigId, idx, function(err) {
                                doneIter(err);
                            });
                            //var queueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sigId;
                            //rcl.rpush(queueKey, idx, function(err, rep) {
                            //   doneIter(err);
                            //});
                        }, function doneAll(err) {
                            cb(null, sinks);
                        });
                    }
                });
            }
        });
    });
}

// Part of NEW API for continuous processes with FIFO queues
// Creates a new signal group to wait for.
// @spec = specification of the group: "{ sigGroupName: [ sigId, sigId, sigId, ... ], ... }", where
//         sigGroup - a unique name for the signal group to wait for.
//         sigId    - signal Id; can be repeated multiple times which denotes wait for multiple
//                    occurrences of this signal. 
// @cb   = function(err) - callback
//
// Example: waitForSignals(1, 44, { "data": [1,2,3,3,4,4,5] }, function(err) { })
//
// TODO: rewrite this in Lua
function public_waitForSignals(wfId, taskId, spec, cb) {
    for (group in spec) {
        // add the group name to the set of all waiting groups
        rcl.sadd("wf:"+wfId+":task:"+taskId+":waiting", group, function(err, reply) {
            if (err) return cb(err); 
            // For each group, add the sigIds to their respective waiting set, increasing its score by 1 for each
            // occurrence of the sigId
            async.each(spec.group, function iterator(sigId, doneIter) {
                var waitSetKey = "wf:"+wfId+":task:"+taskId+":waiting:"+group;
                rcl.zincrby(waitSetKey, 1, sigId, function(err, rep) {
                    doneIter(err);
                });
            }, function doneAll(err) {
                cb(err);
            });
        });
    }
}

// checks if all signals with specified ids are ready for a given task; if so, returns their values
// @spec - array of elements: [ { "id": id, "count": count }, { "id": id, "count": count }, ... ] where
//             id    - input signal identifier for task taskId
//             count - number of instances of this signal which are waited for (typically 1, but
//                     a task may also consume multiple data elements at once from a given port)
function public_getInsIfReady(wfId, taskId, spec, cb) {
    async.reduce(spec, 0, function iterator(memo, sig, cbNext) {
        var queueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sig.id;
        rcl.llen(queueKey, function(err, len) {
            err ?  cbNext(err): cbNext(null, memo + (len == sig.count ? 1: 0));
        });
    }, function done(err, result) {
        if (err) return cb(err); 
        if (result == spec.length) {
            // all signals are ready
            var queueKey = "wf:"+wfId+":task:"+taskId+":ins:"+sig.id; 
            // TODO: retrieve signals
            //rcl.lrange(queueKey, 0, )
        } else {
            cb(null, null);
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
    invokeTaskFunction: public_invokeTaskFunction,
    invokeTaskFunction1: public_invokeTaskFunction1,
    sendSignal: public_sendSignal,
    getSignalInfo: getSignalInfo,
    popInput: popInput,
    resetStickyPorts: resetStickyPorts,
    fetchInputs: fetchInputs
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
    var multi = rcl.multi(); // FIXME: change this to async.parallel
    var dataKey;
    for (var i=0; i<wfJson.data.length; ++i) {
        (function(i) {
            var dataId = i+1, score = -1;
            var dataObj = wfJson.data[i];
            dataObj.status = "not_ready"
            dataKey = wfKey+":data:"+dataId;
            if (dataObj.control) { // this is a control signal
                dataObj.uri = baseUri + '/control-' + dataId;
                dataObj.type = "control";
                delete dataObj.control; // FIXME: json & redis representation of control sig attribute should be unified
                multi.hmset(dataKey, dataObj, function(err, ret) { });
                score = 2;
            } else {                     // this is a data signal
                dataObj.uri = baseUri + '/data-' + dataId; 
                multi.hmset(dataKey, dataObj, function(err, ret) { });
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
    // register workflow functions
    for (var i in wfJson.functions) {
        multi.hset("wf:functions:"+wfJson.functions[i].name, "module", wfJson.functions[i].module, function(err, rep) { });
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
    // add info on which input ports (if any) are "sticky" 
    if (!task.sticky) task.sticky = [];
    for (var i=0; i<task.sticky.length; ++i) {
        (function(sigId) {
            //console.log("STICKY ADDING", sigId);
            rcl.sadd(taskKey+":sticky", sigId, function(err, res) { });
        })(task.sticky[i]+1);
    }

    multi.exec(function(err, replies) {
        cb();
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
    // - MULTI instead of many parallel tasks? ==> NO, that sometimes breaks 
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
