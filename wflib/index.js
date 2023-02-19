/* HyperFlow workflow engine
 ** API over redis-backed workflow instance
 ** Author: Bartosz Balis (2013-2023)
 */
var fs = require('fs'),
    redis = require('redis'),
    async = require('async'),
    value = require('value'),
    request = require('request'),
    Q = require('q'),
    pathTool = require('path'),
    //toobusy = require('toobusy'),
    shortid = require('shortid'),
    Mustache = require('mustache'),
    RemoteJobConnector = require('./connector'),
    rcl;


// for profiling
var fetchInputsTime = 0;
var sendSignalTime = 0;


var global_hfid = 0; // global UUID of this HF engine instance (used for logging)
var globalInfo = {}; // object holding global information for a given HF engine instance
var nActiveTasks = 0; // tracks the number of active tasks (function invoked to callback called)

let jobConnectors = {}; // object holding remote jobs' connectors

function p0() {
    return (new Date()).getTime();
}

function p1(start, name) {
    var end = (new Date()).getTime();
    console.log(name, "TOOK", end - start + "ms");
    return end;
}

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function public_createInstanceFromFile(filename, baseUrl, config, cb) {
        fs.readFile(filename, 'utf8', function(err, data) {
            if (err) { return cb(err); }
            var start = (new Date()).getTime(), finish;

            // 1. render '{{var}}' variables in the workflow file
            var renderedWf=data;
            if (config.vars) {
                renderedWf = Mustache.render(data, config.vars);
                //onsole.log(renderedWf);
            }
            // 2. parse workflow to JSON
            var wfJson = JSON.parse(renderedWf);
            public_createInstance(wfJson, baseUrl, function(err, wfId) {
                finish = (new Date()).getTime();
                console.log("createInstance time: "+(finish-start)+"ms");
                err ? cb(err): cb(null, wfId, wfJson);
            });
        });
    }

    // creates a new workflow instance from its JSON representation
    async function public_createInstance(wfJson, baseUrl, cb) {
        var wfId, procs, sigs, funs, schemas, ins, outs;
        var start, finish;
        //var recoveryMode = false;

        // preprocessing: converts signal names to array indexes, etc.
        var preprocess = function() {

            var sigKeys = {};

            var convertSigNames = function(sigArray) {
                for (var i in sigArray) {
                    var sigId = sigArray[i];
                    if (value(sigId).typeOf(String)) {
                        if (sigKeys[sigId].length != 1) {
                            throw new Error("Error parsing workflow (signal name=" + sigId +
                                    "). Signal names must be unique when used in 'ins' and 'outs' arrays.");
                        }
                        sigArray[i] = sigKeys[sigId][0];
                    }
                }
            }

            // both "processes" and "tasks" (old) are allowed as a name for array of processes
            procs = wfJson.processes ? wfJson.processes: wfJson.tasks;
            // both "signals" and "data" (old) are allowed as a name of array of signals
            sigs = wfJson.signals ? wfJson.signals: wfJson.data;
            funs = wfJson.functions;
            schemas = wfJson.schemas;
            ins = wfJson.ins;
            outs = wfJson.outs;

            // create a map: sigName => sigIndexes
            for (var i=0; i<sigs.length; ++i) {
                var sigName = sigs[i].name;
                if (sigKeys[sigName])
                    sigKeys[sigName].push(i); // TODO: here throw exception to enforce unique names
                else
                    sigKeys[sigName] = [i];
            }

            // extract signal counts and set proc.fullInfo.{incounts,outcounts} objects
            // as follows (example): { '1': '3', '2': 'id:4' }, which means:
            // - signal with id '1' has count 3
            // - signal with id '2' has count associated with a count signal with id 4
            // For output signal counts only the 'id:xxx' variant is valid (of course)
            var incounts = {}, outcounts = {};
            for (var i in procs) {
                for (var j in procs[i].ins) {
                    if (value(procs[i].ins[j]).typeOf(String)) {
                        var sig = procs[i].ins[j].split(":");
                        if (sig.length > 1) { // there is a 'count' modifier
                            procs[i].ins[j] = sig[0];
                            var sigId = +sigKeys[sig[0]][0]+1;
                            if (parseInt(sig[1])) { // count is a number
                                sig[1] = +sig[1];
                                //onsole.log(sigId, "COUNT IS A NUMBER:", sig[1]);
                                if (sig[1] != 1) {
                                    incounts[+sigId] = +sig[1];
                                }
                            } else { // count isn't a number, then it must be a signal name
                                if (!(sig[1] in sigKeys) || sigs[sigKeys[sig[1]][0]].control != "count") {
                                    throw(new Error("Signal count modifier in '" + procs[i].outs[j] +
                                                "' for process '" + procs[i].name +
                                                "' must be a valid control signal name."));
                                }
                                var sigCountId = +sigKeys[sig[1]][0]+1;
                                if (!incounts.rev)
                                    incounts.rev = {};
                                incounts.rev[+sigCountId] = +sigId; // reverse map (sigCountId => sigId)
                                incounts[+sigId] = "id:"+sigCountId; // this count will be set dynamically by the count signal
                                procs[i].ins.push(sig[1]); // add the signal to the list of process' inputs
                            }
                        }
                    }
                }
                //onsole.log("INCOUNTS", incounts);
                //onsole.log("PROC", +i+1, "INS", procs[i].ins);
                for (var j in procs[i].outs) {
                    if (value(procs[i].outs[j]).typeOf(String)) {
                        var sig = procs[i].outs[j].split(":");
                        if (sig.length > 1) { // there is a 'count' modifier
                            if (!(sig[1] in sigKeys) || sigs[sigKeys[sig[1]][0]].control != "count") {
                                throw(new Error("Signal count modifier in '" + procs[i].outs[j] + "' for process '" +
                                            procs[i].name + "' must be a valid control signal name."));
                            }
                            procs[i].outs[j] = sig[0];
                            procs[i].outs.push(sig[1]); // add the 'count' signal to process outputs (FIXME: it could result in duplicate signal id if the signal already was on the list -- this should be no harm because of utilizing redis sets; however -- there is also the score)
                            var sigId = +sigKeys[sig[0]][0]+1,
                                sigCountId = +sigKeys[sig[1]][0]+1;
                            outcounts[+sigId] = "id:"+sigCountId;
                        }
                    }
                }
                //onsole.log("PROC", +i+1, "OUTS", procs[i].outs);

                if (Object.keys(incounts).length) {
                    procs[i].incounts = incounts;
                }
                if (Object.keys(outcounts).length) {
                    procs[i].outcounts = outcounts;
                }
            }
            //onsole.log(" INCOUNTS: ", incounts);
            //onsole.log("OUTCOUNTS: ", outcounts);

            // convert process' ins, outs and sticky arrays
            for (var i in procs) {
                convertSigNames(procs[i].ins)
                convertSigNames(procs[i].outs)
                convertSigNames(procs[i].sticky)
            }

            // convert workflow ins and outs
            convertSigNames(ins);
            convertSigNames(outs);
        }

        var createWfInstance = async function(cb) {
            var wfname = wfJson.name;
            var baseUri = baseUrl + '/apps/' + wfId;
            var wfKey = "wf:"+wfId;

            await rcl.hSet(wfKey, "uri", baseUri); // obsolete, not used for anything now

            jobConnectors[wfId] = new RemoteJobConnector(rcl, wfId, 3000);
            jobConnectors[wfId].run();

           var multi = rcl.multi(); // FIXME: change this to async.parallel

            var addSigInfo = async function(sigId) {
                var score = -1;
                var sigObj = sigs[sigId-1];
                //sigObj.status = "not_ready"; // FIXME: remove (deprecated)
                sigKey = wfKey+":data:"+sigId;
                if (sigObj.control) { // this is a control signal
                    sigObj.type = "control";
                    delete sigObj.control; // FIXME: unify json & redis representation of control sigs
                    score = 2;
                } else {              // this is a data signal
                    score = 0;
                }
                // FIXME: signal uri removed temporarily (currently unused)
                //sigObj.uri = baseUri + '/sigs/' + sigId;

                if (sigObj.schema && value(sigObj.schema).typeOf(Object)) { // this is an inline schema
                    //onsole.log("INLINE SCHEMA", sigObj.schema);
                    var schemasKey = wfKey + ":schemas";
                    var schemaField = "$inline$"+sigId; // give a name to the schema, and save it to a hash
                    multi.hset(schemasKey, schemaField, JSON.stringify(sigObj.schema), function(err, ret) { });
                    sigObj.schema = schemaField;
                }

                if (sigObj.data) { // signal info also contains its instance(s) (initial signals to the workflow)
                    // add signal instance(s) to a special hash
                    await rcl.hSet(wfKey + ":initialsigs", sigId, JSON.stringify(sigObj));
                    delete sigObj.data; // don't store instances in signal info
                }

                if (sigObj.remoteSinks) { // signal info contains URIs to remote sinks
                    sigObj.remoteSinks.forEach(function(sink) {
                        multi.sAdd(sigKey+":remotesinks", sink.uri);
                    });
                    sigObj.remoteSinks = true; // don't store remote sinks URIs in sig info, just a flag
                }

                // create a reverse index to look up sig Id by its name (assumes unique names!)
                multi.hSet(wfKey+":siglookup:name", sigObj.name, sigId);

                multi.hSet(sigKey, sigObj);

                // add this signal id to the sorted set of all workflow signals
                // score determines the type/status of the signal:
                // 0: data signal/not ready, 1: data signal/ready, 2: control signal
                // FIXME: score deprecated
                multi.zAdd(wfKey+":data", { score: score, value: JSON.stringify(sigId)} );
            }

            // add workflow processes
            var procKey;
            for (var i=0; i<procs.length; ++i) {
                var procId = i+1, uri;
                if (procs[i].host) { // FIXME: host deprecated (replaced by remote sinks)
                    uri = procs[i].host + '/apps/' + wfId;
                } else {
                    uri = baseUri;
                }
                procKey = wfKey+":task:"+procId;
                await processProc(procs[i], wfname, uri, wfKey, procKey, procId, function() { });
            }

            // add signal schemas
            if (wfJson.schemas) {
                var schemasKey = wfKey + ":schemas";
                //onsole.log(wfJson.schemas);
                for (var sKey in wfJson.schemas) {
                    //onsole.log("ADDING SCHEMA", sKey, wfJson.schemas[sKey]);
                    multi.hset(schemasKey, sKey, JSON.stringify(wfJson.schemas[sKey]), function(err, ret) { });
                }
            }

            var dataKey;
            // add information about workflow data and control signals
            for (var i=0; i<sigs.length; ++i) {
                addSigInfo(i+1);
            }

            // add workflow inputs and outputs
            for (var i=0; i<wfJson.ins.length; ++i) {
                (function(inId, dataId) {
                    multi.zAdd(wfKey+":ins", { score: inId, value: JSON.stringify(dataId) } );
                })(i+1, wfJson.ins[i]+1);
            }
            for (var i=0; i<wfJson.outs.length; ++i) {
                (function(outId, dataId) {
                    multi.zAdd(wfKey+":outs", { score: outId, value: JSON.stringify(dataId) });
                })(i+1, wfJson.outs[i]+1);
            }
            // register workflow functions
            for (var i in wfJson.functions) {
                multi.hset("wf:"+wfId+":functions:"+wfJson.functions[i].name, "module",
                        wfJson.functions[i].module, function(err, rep) { });
            }

            await multi.exec();
            console.log('Done processing workflow JSON.');
            cb(null);
        }

        var processProc = async function(task, wfname, baseUri, wfKey, procKey, procId, cb) {
            // TODO: here there could be a validation of the process, e.g. Foreach process
            // should have the same number of ins and outs, etc.
            var multi=rcl.multi();

            var taskObject = function(task) {
                var copy = {};
                if (null == task || value(task).notTypeOf(Object)) return task;
                for (var attr in task) {
                    if (task.hasOwnProperty(attr)) {
                        if (value(task[attr]).typeOf(Object)) {
                            copy[attr] = JSON.stringify(task[attr]);
                        } else if (value(task[attr]).typeOf(Array)) {
                            copy[attr] = task[attr].length; // arrays are not stored, just their length!
                        } else {
                            copy[attr] = task[attr];
                        }
                    }
                }
                copy.fun = task.function ? task.function: "null"; // FIXME: unify this attr name
                copy.wfname = wfname || "null";
                /*if (!copy.config)
                    copy.config = "null";*/
                copy.status = "waiting";
                return copy;
            }

            multi.hSet(procKey, taskObject(task));
            //await multi.exec();
            //let x = await rcl.HGETALL(procKey);
            //console.log("DDDD", x);

            // FIXME: "task" type deprecated, change the default type to "dataflow"
            // add task id to sorted set of all wf tasks. Score 0/1/2==waiting/running/finished
            // FIXME: score is now deprecated
            task.type = task.type ? task.type.toLowerCase() : "task";
            multi.zAdd(wfKey+":tasks", { score: 0, value: JSON.stringify(procId) });

            // For every task of type other than "task" (e.g. "foreach", "choice"), add its
            // id to a type set.
            // Engine uses this to know which FSM instance to create
            // TODO: need additional, "global" set with all possible task type names
            if (task.type != "task") {
                multi.sAdd(wfKey+":tasktype:"+task.type, JSON.stringify(procId));
            }

            // add process inputs and outputs + signals sources and sinks
            for (var i=0; i<task.ins.length; ++i) {
                let inId = i+1;
                let dataId = task.ins[i]+1;
                var dataKey = wfKey+":data:"+dataId;
                //console.log("inId", inId, "dataId", dataId)
                multi.zAdd(procKey+":ins", { score: inId, value: JSON.stringify(dataId) });
                multi.zAdd(dataKey+":sinks", { score: inId /* score: port id */, value: JSON.stringify(procId) });
                //TEST 
                //let x = await rcl.zRange(procKey+":ins", 0, 1000, 'BYSCORE');
                //let x = await rcl.zRange(dataKey+":sinks", 0, 1000, { BY: 'SCORE'});
                //console.log(x);


                if (sigs[dataId-1].control) { // add all control inputs to a separate hash
                    //multi.hmset(procKey+":cins", sigs[dataId-1].control, dataId);
                    multi.hSet(procKey+":cins", dataId, sigs[dataId-1].control);
                    multi.sAdd(procKey+":cinset", JSON.stringify(dataId));
                }
            }
            for (var i=0; i<task.outs.length; ++i) {
                let outId = i+1;
                let dataId = task.outs[i]+1;
                var dataKey = wfKey+":data:"+dataId;
                multi.zAdd(procKey+":outs", { score: outId, value: JSON.stringify(dataId) });
                multi.zAdd(dataKey+":sources", {score: outId /* score: port Id */, value: JSON.stringify(procId) });
                if (sigs[dataId-1].control) { // add all control outputs to a separate hash
                    multi.hSet(procKey+":couts", sigs[dataId-1].control, JSON.stringify(dataId));
                    multi.sAdd(procKey+":coutset", JSON.stringify(dataId));
                }
            }

            // add info about input and output counts
            for (var sig in task.incounts) {
                (function(s, c) {
                    if (s == "rev") {
                        c = JSON.stringify(c);
                    }
                    multi.hSet(procKey+":incounts", s, c);
                })(sig, task.incounts[sig])
            }
            for (var sig in task.outcounts) {
                (function(s, c) {
                    multi.hSet(procKey+":outcounts", s, c);
                })(sig, task.outcounts[sig])
            }

            // add info on which input ports (if any) are "sticky"
            if (!task.sticky) task.sticky = [];
            for (var i=0; i<task.sticky.length; ++i) {
                (function(sigId) {
                    //onsole.log("STICKY ADDING", sigId);
                    rcl.sadd(procKey+":sticky", sigId, function(err, res) { });
                })(task.sticky[i]+1);
            }

            await multi.exec();
            cb();
        }

        wfId = await rcl.incr("wfglobal:nextId");
        preprocess();
        createWfInstance(function (err) {
            cb(null, wfId); // FIXME: is race with 'setnx' above impossible? (EDIT: pending removal)
        });
    }


    // returns a list of tasks with ids within [from..to], and their ins and outs
    function public_getWfTasks(wfId, from, to, cb) {
        rcl.zcard("wf:"+wfId+":data", function(err, ret) {
            var dataNum = ret;
            if (to < 0) {
                rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
                    if (err) return cb(err);
                    var to1 = ret+to+1;
                    //onsole.log("From: "+from+", to: "+to1);
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

    async function public_setWfInstanceState(wfId, obj, cb) {
        let rep = await rcl.hSet("wf:"+wfId, obj);
        cb(null, rep);
    }

    async function public_getWfIns(wfId, withports, cb) {
        let ret;
        if (withports) {
            ret = await rcl.zRange("wf:"+wfId+":ins", 0, 99999999, 'WITHSCORES');
        } else {
            ret = await rcl.zRange("wf:"+wfId+":ins", 0, 99999999);
        }
        cb(null, ret);
    }

    async function public_getWfOuts(wfId, withports, cb) {
        let ret;
        if (withports) {
            ret = await rcl.zRange("wf:"+wfId+":outs", 0, 99999999, 'WITHSCORES');
        } else {
            ret = await rcl.zRange("wf:"+wfId+":outs", 0, 99999999);
        }
        cb(null, ret);
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
            if (err) { return cb(err); }
            for (var i=0; i<ins.length; ++i) {
                (function(i) {
                    var dataKey = "wf:"+wfId+":data:"+ins[i];
                    multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
                        ins[i] = err ? err: {"uri": reply[0], "name": reply[1], "status": reply[2]};
                    });
                })(i);
            }
            for (var i=0; i<outs.length; ++i) {
                (function(i) {
                    var dataKey = "wf:"+wfId+":data:"+outs[i];
                    multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
                        outs[i] = err ? err: {"uri": reply[0], "name": reply[1], "status": reply[2]};
                    });
                })(i);
            }

            multi.exec(function(err, replies) {
                err ? cb(err): cb(null, ins, outs);
            });
        });
    }

    async function public_getTaskInfo(wfId, procId) {
        var procKey = "wf:"+wfId+":task:"+procId;
        let reply = await rcl.hGetAll(procKey);
        if (reply == null || Object.keys(reply).length == 0) return null;
        return reply;
    }

    function public_getTaskIns(wfId, procId, withports, cb) {
        var procKey = "wf:"+wfId+":task:"+procId;
        if (withports) {
            rcl.zrangebyscore(procKey+":ins", 0, "+inf", "withscores", function(err, ret) {
                err ? cb(err): cb(null, ret);
            });
        } else {
            rcl.zrangebyscore(procKey+":ins", 0, "+inf", function(err, ret) {
                err ? cb(err): cb(null, ret);
            });
        }
    }

    function public_getTaskOuts(wfId, procId, withports, cb) {
        var procKey = "wf:"+wfId+":task:"+procId;
        if (withports) {
            rcl.zrangebyscore(procKey+":outs", 0, "+inf", "withscores", function(err, ret) {
                err ? cb(err): cb(null, ret);
            });
        } else {
            rcl.zrangebyscore(procKey+":outs", 0, "+inf", function(err, ret) {
                err ? cb(err): cb(null, ret);
            });
        }
    }

    function pushInput(wfId, procId, sigId, sigIdx, cb) {
        var isStickyKey = "wf:"+wfId+":task:"+procId+":sticky"; // KEYS[1]
        var queueKey = "wf:"+wfId+":task:"+procId+":ins:"+sigId; // KEYS[2]

        // LUA Script
        // ARGS[1] = sigId
        // ARGS[2] = sigIdx
        var pushScript = '\
            local ret \
            if redis.call("SISMEMBER", KEYS[1], ARGV[1]) == 1 then \
                local len = redis.call("LLEN", KEYS[2]) \
                if (len > 0) then \
                    ret = redis.call("LSET", KEYS[2], ARGV[2]) \
                else \
                    ret = redis.call("RPUSH", KEYS[2], ARGV[2]) \
                end \
            else \
                ret = redis.call("RPUSH", KEYS[2], ARGV[2]) \
            end \
            return ret';

        rcl.eval([pushScript, 2, isStickyKey, queueKey, sigId, sigIdx], function(err, res) {
	    if (err) throw err;
            cb(err);
        });
        return;

        // OLD non-Lua implementation
        // checking if this input signal is on a 'sticky' port
        rcl.sismember("wf:"+wfId+":task:"+procId+":sticky", sigId, function(err, isSticky) {
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
                    //onsole.log("STICKY PUSH sigId=", sigId, "LLEN=", llen, "Idx=", sigIdx);
                });

            } else {
                rcl.rpush(queueKey, sigIdx, function(err, rep) {
                    cb(err);
                    //rcl.llen(queueKey, function(err, llen) {
                        //onsole.log("PUSH sigId=", sigId, "LLEN=", llen, "Idx=", sigIdx);
                        //cb(err);
                    //});
                });
            }
        });
    }

    async function popInput(wfId, procId, sigId, cb) {
        //onsole.log("POP INPUT", wfId, procId, sigId);
        var sigQueueKey = "wf:"+wfId+":task:"+procId+":ins:"+sigId;
        var sigInstanceKey = "wf:"+wfId+":sigs:"+sigId;
        var isStickyKey = "wf:"+wfId+":task:"+procId+":sticky";

        // LUA Script
        // KEYS[1] = sigQueueKey
        // KEYS[2] = sigInstanceKey
        // KEYS[3] = isStickyKey
        // ARGV[1] = sigId
        var popScript = '\
            local sigval \
            local idx \
            if redis.call("SISMEMBER", KEYS[3], ARGV[1]) == 1 then \
                idx = redis.call("LINDEX", KEYS[1], 0) \
                sigval = redis.call("HGET", KEYS[2], idx) \
            else \
                idx = redis.call("LPOP", KEYS[1]) \
                sigval = redis.call("HGET", KEYS[2], idx) \
            end \
            return {sigval,idx}';

        let scriptSha = await rcl.scriptLoad(popScript);
        let res = await rcl.evalSha(scriptSha, {
            keys: [sigQueueKey, sigInstanceKey, isStickyKey],
            arguments: [JSON.stringify(sigId)]
        });

        //rcl.eval([popScript, 3, sigQueueKey, sigInstanceKey, isStickyKey, sigId], function(err, res) {
        var sig = JSON.parse(res[0]);
        //sig.sigIdx = res[1];
        return cb(null, sig);

        // OLD non-Lua implementation
        // checking if this input signal is on a 'sticky' port
        rcl.sismember("wf:"+wfId+":task:"+procId+":sticky", sigId, function(err, isSticky) {
            if (isSticky) {
                //onsole.log("STICKY!", procId, sigId);
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
                        cb(err, sig);
                        //rcl.hlen(sigInstanceKey, function(err, hlen) {
                         //   rcl.llen(sigQueueKey, function(err, llen) {
                                //onsole.log("sigId=", sigId, "LLEN=", llen, "HLEN=", hlen, "Idx=", sigIdx);
                                //cb(err, sig);
                            //});
                        //});
                    });
                });
            }
        });
    }

    function resetStickyPorts(wfId, procId, cb) {
        rcl.smembers("wf:"+wfId+":task:"+procId+":sticky", function(err, sigs) {
            async.each(sigs, function(sigId, cbNext) {
                var queueKey = "wf:"+wfId+":task:"+procId+":ins:"+sigId;
                rcl.lpop(queueKey, function(err, rep) {
                    rcl.llen(queueKey, function(err, len) {
                        //onsole.log(queueKey, "LEN="+len);
                        cbNext(err);
                    });
                });
            },
            function(err) {
                err ? cb(null): cb(err);
            });
        });
    }


    async function public_setTaskState(wfId, procId, obj, cb) {
        let rep = await rcl.hSet("wf:"+wfId+":task:"+procId, obj);
        cb(null, rep);
    }

    function public_getDataInfo(wfId, dataId, cb) {
        var data, nSources, nSinks, dataKey;
        var multi = rcl.multi();

        dataKey = "wf:"+wfId+":data:"+dataId;
        procKeyPfx = "wf:"+wfId+":task:";

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
        var data, sources, sinks, dataKey, procKeyPfx, tasks = {};
        var multi = rcl.multi();

        dataKey = "wf:"+wfId+":data:"+dataId;
        procKeyPfx = "wf:"+wfId+":task:";

        // Retrieve data element info
        multi.hgetall(dataKey, function(err, reply) {
            data = err ? err: reply;
        });

        // this is a great feature: sort+get combo (even for hashes)!
        multi.sort(dataKey+":sources", "get", procKeyPfx+"*->uri",
                "get", procKeyPfx+"*->name",
                "get", procKeyPfx+"*->status",
                function(err, reply) {
                    if (err) {
                        sources = err;
                    } else {
                        sources = [];
                        for (var i=0; i<reply.length; i+=3) {
                            sources.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
                        }
                        //onsole.log("sources[0]: "+sources[0]);
                    }
                });

        multi.sort(dataKey+":sinks", "get", procKeyPfx+"*->uri",
                "get", procKeyPfx+"*->name",
                "get", procKeyPfx+"*->status",
                function(err, reply) {
                    if (err) {
                        sinks = err;
                    } else {
                        sinks = [];
                        for (var i=0; i<reply.length; i+=3) {
                            sinks.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
                        }
                        //onsole.log("sinks[0]: "+sinks[0]);
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

    // returns sigId of signal with name 'sigName'
    function getSigByName(wfId, sigName, cb) {
        var wfKey = "wf:"+wfId;
        rcl.hget(wfKey+":siglookup:name", sigName, function(err, sigId) {
            err ? cb(err): cb(null, sigId);
        });
    }


    // checks if given input signals are ready (in the queues), and returns their values
    // @sigsSpec format: { sigId: count, sigId: count, ... }
    // @deref (boolean): if true and all sigs are ready, their values will be returned
    // @cb: function(result, [sigValues])
    //   result: true if 'count' instances of each signal 'sigId' are present in the queues
    //   sigValues (optional) format: [ [ spec[0] signal values ], [ spec[1] signal values ], ... ]
    //                       example: [ [ { name: 'filename',
    //                                      uri: '/apps/1/sigs/1',
    //                                      _id: '1',
    //                                      _ts: 415334,
    //                                      data: [ { path: 'tmp1/asynctest.js' } ]
    //                                } ] ]
    //
    // TODO: optimize by introducing a counter of how many signals await on ALL ports of a given task.
    //       often it will be enough to tell that a process is NOT ready to fire, without checking all queues
    async function fetchInputs(wfId, procId, sigsSpec, deref, cb) {
        //var time = (new Date()).getTime();
        var spec = [];
        for (var i in sigsSpec)  { // TODO: rewrite the code below to use object, instead of converting to array
            spec.push([i, sigsSpec[i]]);
        }
        var sigValues = [];
        async.every(spec, async function (sig, callback) {
            let queueKey = "wf:"+wfId+":task:"+procId+":ins:"+sig[0];
            let len = await rcl.lLen(queueKey);
            callback(len >= sig[1]);
        }, function(result) {
            if (!result || !deref) return cb(result);
            async.times(spec.length, function (n, cbNext) {
                //sigValues[n] = [];
                async.timesSeries(spec[n][1] /* count */, function(m, cbNextInner) {
                    popInput(wfId, procId, spec[n][0] /* sigId */, function(err, sig) {
                        if (!sig.control) { // don't return values of control signals!
                            if (m==0) {
                                sigValues.push([sig]);
                            } else {
                                sigValues[sigValues.length-1].push(sig);
                            }
                        }
                        cbNextInner();
                    });
                }, function(err, res) {
                    cbNext();
                });
            }, function(err, res) {
                //time -= (new Date()).getTime();
                //onsole.log("FETCHING INPUTS FOR", procId , "TOOK", -time+"ms");
                //fetchInputsTime -= time;
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
            //onsole.log(i, spec[i]);
            var obj = spec[i];
            if (Object.keys(spec).length) { // spec not empty
                (function(dataId, obj) {
                    //onsole.log(dataId, obj);
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
    // function(nProcs, nData, err, ins, outs, sources, sinks, types, cPortsInfo), where:
    // - nProcs        = number of processes (also length of ins and outs arrays)
    // - nSigs         = number of data elements (also length of sources and sinks arrays)
    // - ins[i][j]     = data id mapped to j-th input port of i-th task
    // - outs[i][j]    = data id mapped to j-th output port of i-th task
    // - sources[i][1] = task id which produces data element with id=i (if none, sources[i]=[])
    // - sources[i][2] = port id in this task the data element is mapped to
    // - sinks[i][j]   = task id which consumes data element with id=i (if none, sinks[i]=[])
    // - sinks[i][j+1] = port id in this task the data element is mapped to
    // - types         = ids of tasks with type other than default "task"; format:
    //                   { "foreach": [1,2,5], "choice": [3,4] }
    // - cPortsInfo    = information about all control ports of all tasks; format:
    //                   { procId: { "ins": { portName: sigId } ... }, "outs": { ... } } }
    //                   e.g.: { '1': { ins: { next: '2' }, outs: { next: '2', done: '4' } } }
    // - fullInfo[i]   = all additional attributes of i-th task (e.g. firingInterval etc.)
async function public_getWfMap(wfId, cb) {
    var asyncTasks = [];
    var wfKey = "wf:"+wfId;

    let nProcs = await rcl.zCard(wfKey + ":tasks");
    let nSigs = await rcl.zCard(wfKey + ":data");

    var types = {}, ins = [], outs = [], sources = [], sinks = [], cPortsInfo = {}, fullInfo = [];
    for (i = 1; i <= nProcs; ++i) {
        let procId = i;
        let procKey = wfKey + ":task:" + procId;
        let taskInfo = await rcl.hGetAll(procKey); 
        fullInfo[procId] =  taskInfo;

        // add additional info to fullInfo

        if (taskInfo.sticky) {
            var stickyKey = procKey + ":sticky";
            rcl.smembers(stickyKey, function (err, stickySigs) {
                if (!stickySigs) stickySigs = [];
                fullInfo[procId].stickySigs = {};
                stickySigs.forEach(function (s) {
                    fullInfo[procId].stickySigs[+s] = true;
                });
                cb(err);
            });
        }

        // input control signals
        let cins = await rcl.sMembers(procKey + ":cinset");
        //onsole.log("CINS", cins);
        if (!cins) cins = [];
        fullInfo[procId].cinset = {};
        cins.forEach(function (c) {
            fullInfo[procId].cinset[+c] = true;
        });

        // output control signals
        let couts = await rcl.sMembers(procKey + ":coutset");
        if (!couts) couts = [];
        //onsole.log("COUTS", couts);
        fullInfo[procId].coutset = {};
        couts.forEach(function (c) {
            fullInfo[procId].coutset[+c] = true;
        });

        let incounts = await rcl.hGetAll(procKey + ":incounts");
        if (incounts && incounts.rev) {
            incounts.rev = JSON.parse(incounts.rev);
        } else { incounts = null; }
        fullInfo[procId].incounts = incounts;

        let outcounts = await rcl.hGetAll(procKey + ":outcounts");
        if (outcounts == null || Object.keys(outcounts).length == 0) { outcounts = null; }
        fullInfo[procId].outcounts = outcounts;
        //onsole.log("INCOUNTS=", JSON.stringify(incounts, null, 2), " OUTCOUNTS=", JSON.stringify(outcounts, null, 2));

        let procIns = await rcl.sendCommand(['ZRANGEBYSCORE', procKey + ":ins", '0', '+inf'])
        .catch(err => { console.log(err); throw(err) });
        ins[procId] = procIns;

        let procOuts = await rcl.sendCommand(['ZRANGEBYSCORE', procKey + ":outs", '0', '+inf']);
        outs[procId] = procOuts;

        let csigs = await rcl.hGetAll(procKey + ":cins");
        if (csigs == null || Object.keys(csigs).length == 0) { csigs = null; }
        if (csigs != null) {
            var tmp = {};
            for (var s in csigs) {
                if (tmp[csigs[s]]) {
                    tmp[csigs[s]].push(s);
                } else {
                    tmp[csigs[s]] = [s];
                }
            }
            for (var i in tmp) {
                if (tmp[i].length == 1) {
                    tmp[i] = tmp[i][0];
                }
           }
            if (!(procId in cPortsInfo)) {
                cPortsInfo[procId] = {};
            }
            cPortsInfo[procId].ins = tmp;
            //onsole.log("C PORTS INFO=", JSON.stringify(cPortsInfo));
        }

        let csigouts = await rcl.hGetAll(procKey + ":couts");
        //onsole.log("Proc COUTS WFLIB", ret);
        if (csigouts != null && Object.keys(csigouts).length != 0) {
            if (!(procId in cPortsInfo)) {
                cPortsInfo[procId] = {};
            }
            cPortsInfo[procId].outs = csigouts;
        }
    }

    for (i = 1; i <= nSigs; ++i) {
        let sigId = i;
        let dataKey = wfKey + ":data:" + sigId;
        // info about all signal sources
        let srcs = await rcl.sendCommand(['ZRANGE', dataKey + ":sources", '0', '-1', 'WITHSCORES']);
        sources[sigId] = srcs;
        //onsole.log(sigId+";"+ret);
        //sources[sigId].unshift(null);

        // info about signal sinks
        /*asyncTasks.push(function(callback) {
            rcl.zrange(dataKey+":sinks", 0, -1, function(err, ret) {
                if (err || ret == -1) { throw(new Error("Redis error")); }
                sinks[sigId] = ret;
                //sinks[sigId].unshift(null);
                callback(null, ret);
            });
        });*/
    }
    // Create info about task types (all remaining tasks have the default type "task")
    // TODO: pull the list of types dynamically from redis
    for (let type of ["foreach", "splitter", "csplitter", "choice", "cchoice", "dataflow", "join"]) {
        let cnt = await rcl.sMembers(wfKey + ":tasktype:" + type);
        if (cnt) {
            types[type] = cnt;
        }
    }
  
    /*console.log("WF MAP:");
    console.log("types", JSON.stringify(types, null, 2));
    console.log("ins", JSON.stringify(ins, null, 2));
    console.log("outs", JSON.stringify(outs, null, 2));
    console.log("sources", JSON.stringify(sources, null, 2));
    console.log("sinks", JSON.stringify(sinks, null, 2));
    console.log("cPortsInfo", JSON.stringify(cPortsInfo, null, 2));
    console.log("fullInfo", JSON.stringify(fullInfo, null, 2));*/
    cb(null, nProcs, nSigs, ins, outs, sources, sinks, types, cPortsInfo, fullInfo);
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
function public_getTaskMap(wfId, procId, cb) {
    var ins = [], outs = [], sources = {}, sinks = {};
    var multi = rcl.multi();
    var procKey = "wf:"+wfId+":task:"+procId;
    multi.zrangebyscore(procKey+":ins", 0, "+inf", function(err, ret) {
        ins = ret;
    });
    multi.zrangebyscore(procKey+":outs", 0, "+inf", function(err, ret) {
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



/*
 * @insValues - array of input signal values as returned by fetchInputs
 * @appConfig - configuration specific for this workflow instance (the engine.config object), e.g. working directory
 */
async function public_invokeProcFunction(wfId, procId, firingId, insIds_, insValues, outsIds_, emulate, eventServer, appConfig, cb) {
    function isArray(what) {
        return Object.prototype.toString.call(what) === '[object Array]';
    }

    //onsole.log("INVOKING:", insIds_, insValues);

    var insIds = [], outsIds = [];
    isArray(insIds_) ? insIds = insIds_: insIds.push(insIds_);
    isArray(outsIds_) ? outsIds = outsIds_: outsIds.push(outsIds_);

    // convert an array of signals to an object-array
    var convertSigs2ObjArray = function(sigs) {
        if (sigs == null) return null;
        function Arg() {}
        Arg.prototype = Object.create(Array.prototype);
        var outSigs = new Arg;
        sigs.forEach(function(s) {
            outSigs.push(s);
        });
        outSigs.forEach(function(s, idx) {
            outSigs[s.name] = outSigs[idx];
        });
        return outSigs;
    }

    // TODO: reuse convertSigs2ObjArray
    var convertSigValuesToFunctionInputs = function() {
        function Arg() {} // arguments will be an Array-like object
        Arg.prototype = Object.create(Array.prototype);
        var funcIns = new Arg;
        for (var i=+0; i<insIds.length; ++i) {
            funcIns.push(insValues[i][0]);
            //funcIns[i] = insValues[i][0]; // for start, copy the first signal instance
            delete funcIns[i]._ts;
            delete funcIns[i].ts;
            delete funcIns[i]._uri;
            delete funcIns[i].uri;
            delete funcIns[i].status;
            // if there were more signal instances, only copy their data
            for (var j=1; j<insValues[i].length; ++j) {
                funcIns[i].data.push(insValues[i][j].data[0]);
            }
            var sigName = funcIns[i].name; // TODO: validate names
            funcIns[sigName] = funcIns[i]; // as a result, in the function input signals can be accessed by their name or index
        }
        return funcIns;
    }

    var ins = convertSigValuesToFunctionInputs();

    // TODO: for each ins[i].data[j], create a map (i,j) => metadata (for provenance logging)
    // In functions user-defined provenance could look like:
    // - options.prov.push(["read", "foo", 0]), where "foo" is sig name, "0" is 'data' array index

    //onsole.log("FUNC INS", ins);

    let procInfo = await public_getTaskInfo(wfId, procId);
    //console.log("PRoc info", procInfo)

    var prepareFuncOutputs = function (callback) {
        // if in recovery mode, use recovery data --> pass outputs that were produced
        // during the previous run. The function will decide if re-execution is needed.
        if (appConfig.recovery) {
            var key = procId + "_" + firingId;
                // if outputs from this firing have been persisted in the previous execution, we reuse them!
            if (key in appConfig.recoveryData.outputs) {
                var outs = convertSigs2ObjArray(appConfig.recoveryData.outputs[key]);
                    //onsole.log("RECOVERY DATA FOUND!!!", outs);
                return callback(outs, true);
            }
        }

        var asyncTasks = [], outsTmp = [];

        // retrieve task outputs given in 'outsIds'
        for (i=0; i<outsIds.length; ++i) {
            (function(idx) {
                asyncTasks.push(async function(callback) {
                    let dataKey = "wf:"+wfId+":data:"+outsIds[idx];
                    let dataInfo = await rcl.hGetAll(dataKey);
                    outsTmp[+idx] = dataInfo;
                    callback(null, dataInfo);
                })
            })(i);
        }

        /*function Arg() {} // make 'outs' an Array-like object
        Arg.prototype = Object.create(Array.prototype);
        var outs = new Arg;*/

        async.parallel(asyncTasks, function done(err, result) {
            if (err) return cb(err);

            // convert 'outsTmp' array to array-like object 'outs'
            var outs = convertSigs2ObjArray(outsTmp);
            //onsole.log("OUTS", outs);

            /*for (var i=0; i<outsTmp.length; i++) {
                outs.push(outsTmp[i]);
                outs[outsTmp[i].name] = outs[i];
            }*/
            callback(outs, false);
        });
    }

    prepareFuncOutputs(async function (outs, recovered) {
        if (emulate) {
            return setTimeout(function () {
                cb(null, ins, outs);
            }, 100);
        }

        function hasForceRecomputeFlag() {
            var key = procId + "_" + firingId;
            var s = appConfig.recoveryData ? appConfig.recoveryData.settings : undefined;
            return s && s[key] && s[key].flags && s[key].flags.includes('forceRecompute');
        }

        // when this is a recovered firing, unless the process has set flag "executeWhenRecovering",
        // and unless "forceRecompute" flag is set in the recovery file -- this means that
        // something has changed (e.g. software version) and the task must be recomputed
        var recomputeForced = hasForceRecomputeFlag();
        if (recovered && !procInfo.executeWhenRecovering && !recomputeForced) {
            return cb(null, ins, outs, {"recovered": "true", "recomputeForced": recomputeForced });
        }

        if ((procInfo.fun == "null") || (!procInfo.fun)) {
            throw new Error("No function defined for the process." + JSON.stringify(procInfo));
        }

        /////////////////////////
        // INVOKE THE FUNCTION //
        /////////////////////////

        let fun = await rcl.hGetAll("wf:" + wfId + ":functions:" + procInfo.fun);

        if (appConfig.workdir) {
            process.chdir(appConfig.workdir);
        }

        // Load the function trying the following locations, in order:
        // 1) Module declared in workflow.json (if any)
        // 2) "functions.js" file in the workflow's directory
        // 3) HyperFlow core "functions" module
        var f;

        // if the function's module was declared in the workflow file -- use it
        // otherwise try "functions.js"
        var funModuleName = (fun && fun.module) ? fun.module : "functions.js";
        var funPath = pathTool.join(appConfig.workdir ? appConfig.workdir : "", funModuleName);

        if (fs.existsSync(funPath)) {
            try {
                f = require(funPath)[procInfo.fun];
            } catch (err) {
                throw err;
            }
        } else {
            // if the function could not be loaded, look in the core HyperFlow functions
            funPath = pathTool.join(require('path').dirname(require.main.filename), "..", "functions");
            f = require(funPath)[procInfo.fun];
        }

        // the function couldn't be found anywhere
        if (!f) {
            throw (new Error("Unable to load the process function: " +
                procInfo.fun + " in module: " + funPath + ", exception:  " + err));
        }

        //onsole.log("FUNCTION", procInfo.fun, module);
        //onsole.log("FPATH", fpath, "F", f, "FUN", procInfo.fun);
        //onsole.log("FUNCTION", procInfo.fun, module);
        //onsole.log("FPATH", fpath, "F", f, "FUN", procInfo.fun);
        //onsole.log("INS:", ins);
        //onsole.log("OUTS:", outs);
        //onsole.log(JSON.stringify(procInfo.config));  //DEBUG
        var conf = procInfo.config ? JSON.parse(procInfo.config) : {};
        conf.name = procInfo.name;
        conf.appConfig = appConfig;
        //var executor = procInfo.executor ? procInfo.executor: null;

        //onsole.log("INS VALUES", insValues);
        if (eventServer !== 'undefined') {
            conf['eventServer'] = eventServer;
        }

        // Pass identifiers to the function
        conf.hfId = global_hfid;
        conf.appId = wfId;
        conf.procId = procId;
        conf.firingId = firingId;
        // 'task' denotes a process firing/activation
        conf.taskId = conf.hfId + ":" + conf.appId + ":" + conf.procId + ":" + conf.firingId;
        conf.wfname = procInfo.wfname;

        // This function is passed to the Process' Function (through 'context')
        // and can be used to wait for task completion. It reads a key from redis
        // that should be set by the task's executor.
        // 'taskId' to be waited for is read from the process context, but
        // optionally it can be set by the caller via parameter 'taskIdentifier'
        var getJobResult = async function (timeout, taskIdentifier) {
            const taskId = taskIdentifier || conf.taskId;
            let wfId = taskId.split(':')[1];
            let connector = jobConnectors[wfId];
            return connector.waitForTask(taskId);
        }

        conf.jobResult = getJobResult;
        conf.redis_url = process.env.REDIS_URL || "redis://127.0.0.1:6379";

        // The next two functions may be used by the job function/executor to, 
        // respectively, mark that or check if the task has been completed.
        // Useful e.g. in Kubernetes which sometimes restarts a succesfully 
        // completed job for uknown reason.
        var markTaskCompleted = async function (taskIdentifier) {
            const completedTasksSetKey = "wf:" + wfId + ":completedTasks";
            const taskId = taskIdentifier || conf.taskId;
            let reply = await rcl.sAdd(completedTasksSetKey, taskId);
            return reply;
        }

        var checkTaskCompletion = async function (taskIdentifier) {
            const completedTasksSetKey = "wf:" + wfId + ":completedTasks";
            const taskId = taskIdentifier || conf.taskId;
            let hasCompleted = await rcl.sIsMember(completedTasksSetKey, taskId);
            return hasCompleted;
        }

        conf.markTaskCompleted = markTaskCompleted;
        conf.checkTaskCompletion = checkTaskCompletion;

        // This function is passed to the Process' Function (through 'context')
        // and can be used to pass a job message (via Redis) to a job executor 
        // 'taskId' to be waited for is read from the process context, but 
        // optionally it can be set by the caller via parameter 'taskIdentifier' 
        var sendMessageToJob = async function (message, taskIdentifier) {
            const taskId = taskIdentifier || conf.taskId;
            const taskMessageKey = taskId + "_msg";
            let reply = await rcl.lPush(taskMessageKey, message);
            return reply;
        }

        conf.sendMsgToJob = sendMessageToJob;

        // Pass the workflow working directory
        if (appConfig.workdir) {
            conf.workdir = appConfig.workdir;
        }


        if (recovered) { conf.recovered = true; }
        f(ins, outs, conf, function (err, outs, options) {
            //if (outs) { onsole.log("VALUE="+outs[0].value); } // DEBUG
            if (recovered) {
                if (!options) {
                    options = { recovered: true }
                } else {
                    options.recovered = true;
                }
            }
            cb(null, ins, outs, options);
        });
    });
}


async function getInitialSignals(wfId, cb) {
    let wfKey = "wf:" + wfId;
    let sigs = await rcl.hGetAll(wfKey + ":initialsigs");
    let sigSpec = [];
    for (var sigId in sigs) {
        var sig = JSON.parse(sigs[sigId]);
        delete sig._ts;
        delete sig.ts;
        delete sig._uri;
        delete sig.uri;
        delete sig.status;
        sig._id = +sigId;
        sigSpec.push(sig);
        /*sigInstances = JSON.parse(sigs[sigId]);
        for (var idx in sigInstances) {
            // FIXME: retrieve signal metadata to 's' and set 's.data = sigInstances[ids]'
            var s = sigInstances[idx];
            //onsole.log("INITIAL:", s);
            s._id = sigId;
            sigSpec.push(s);
        }*/
    }
    cb(null, sigSpec);
}

async function sendSignalLua(wfId, sigValue, cb) {
    var sigId = sigValue._id; // ARGV[1]
    var sigKey = "wf:"+wfId+":data:"+sigId; // KEYS[1]
    var sigInstanceKey = "wf:"+wfId+":sigs:"+sigId; // KEYS[2]
    var sigNextIdKey = "wf:"+wfId+":sigs:"+sigId+":nextId"; // KEYS[3]
    var sigSinksKey = sigKey + ":sinks"; // KEYS[4]
    var wfKey = "wf:" + wfId; // KEYS[5]
    var sig ; // ARGV[2]
    //onsole.log(sigInstanceKey);
    //onsole.log(sigNextIdKey);
    //onsole.log(sigSinksKey);
    //onsole.log(sig);

    //var time = (new Date()).getTime(); // for profiling
    var sendSignalScriptTest = '\
        local ret \
        return ARGV[1]';

    var sendSignalScript = '\
        local ret \
        local sigIdx = ARGV[3] \
        redis.call("HSET", KEYS[2], sigIdx, ARGV[2]) \
        local sinks = redis.call("ZRANGE", KEYS[4], 0, -1) \
        for k,procId in pairs(sinks) do \
            local ret \
            local isStickyKey = KEYS[5] .. ":task:" .. procId .. ":sticky" \
            local sigQueueKey = KEYS[5] .. ":task:" .. procId .. ":ins:" .. ARGV[1] \
            if redis.call("SISMEMBER", isStickyKey, ARGV[1]) == 1 then \
                local len = redis.call("LLEN", sigQueueKey) \
                if (len > 0) then \
                    ret = redis.call("LSET", sigQueueKey, sigIdx) \
                else \
                    ret = redis.call("RPUSH", sigQueueKey, sigIdx) \
                end \
            else \
                ret = redis.call("RPUSH", sigQueueKey, sigIdx) \
            end \
        end \
        return sinks';

    // sigIdx = unique signal instance id
    let sigIdx = await rcl.incr("wf:"+wfId+":sigs:"+sigId+":nextId");
    sigValue.sigIdx = +sigIdx;
    sig = JSON.stringify(sigValue);
    //let res = await rcl.eval([sendSignalScript, 5, sigKey, sigInstanceKey, sigNextIdKey, sigSinksKey, wfKey, sigId, sig, sigIdx]);
    let script = await rcl.scriptLoad(sendSignalScript);
    let res = await rcl.evalSha(script, {
        keys: [sigKey, sigInstanceKey, sigNextIdKey, sigSinksKey, wfKey], 
        arguments: [JSON.stringify(sigId), sig, JSON.stringify(sigIdx)]
    });

    if (sigValue.remoteSinks) {
        let remoteSings = await rcl.sMembers(sigKey + ":remotesinks");
        delete sigValue.remoteSinks;
        async.each(remoteSinks, function (sinkUri, doneIterCb) {
            request.post({
                headers: { 'content-type': 'application/json' },
                url: sinkUri,
                json: sigValue
            }, function (error, response, body) {
                if (error) console.log("ERROR", error);
                doneIterCb();
                //onsole.log(error);
                //onsole.log(response);
                //onsole.log(body);
            });
            //onsole.log("REMOTE SINKS: ", ret);
        }, function doneAll(err) {
            cb(null, res);
        });
    } else {
        cb(null, res);
    }
}


function getSigRemoteSinks(wfId, sigId, cb) {
    var rsKey = "wf:"+wfId+":data:"+sigId+":remotesinks";
    rcl.smembers(rsKey, function(err, ret) {
        cb(err, ret);
    });
}

// sets remote sinks for a signal
// @remoteSinks = array: [ { "uri": uri1 }, { "uri": uri2 }, ... ]
// @options = object; possible values:
//      { "replace": true }: if present, currently defined remote sinks will be replaced
//                           if not, new remote sinks will be added to existing ones
function setSigRemoteSinks(wfId, sigId, remoteSinks, options, cb) {
    var replace = options && options.replace == true,
        wfKey = "wf:"+wfId;
        sigKey = wfKey+":data:"+sigId,
        rsKey = wfKey+":data:"+sigId+":remotesinks";

    Q.fcall(function() {
        if (replace) {
            rcl.del(rsKey, function(err) {
                if (err) throw(err);
                return;
            });
        } else return;
    })
    .then(function() {
        async.eachSeries(remoteSinks, function(sink, doneIterCb) {
            rcl.sadd(rsKey, sink.uri, function(err, ret) {
                doneIterCb(err);
            });
        }, function doneAll(err) {
            if (err) throw(err);
            return;
        });
    })
    .then(function() {
        rcl.hset(sigKey, "remoteSinks", true, function(err, ret) {
            if (err) throw(err);
            return;
        });
    })
    .catch(function(error) {
        cb(error);
    })
    .done(function() {
        cb(null);
    });
}


function getStickySigs(wfId, procId, cb) {
    var stickyKey = "wf:"+wfId+":task:"+procId+":sticky";
    rcl.smembers(stickyKey, function(err, stickySigs) {
        cb(err, stickySigs);
    });
}


// checks if all signals with specified ids are ready for a given task; if so, returns their values
// @spec - array of elements: [ { "id": id, "count": count }, { "id": id, "count": count }, ... ] where
//             id    - input signal identifier for task procId
//             count - number of instances of this signal which are waited for (typically 1, but
//                     a task may also consume multiple data elements at once from a given port)
function public_getInsIfReady(wfId, procId, spec, cb) {
    async.reduce(spec, 0, function iterator(memo, sig, cbNext) {
        var queueKey = "wf:"+wfId+":task:"+procId+":ins:"+sig.id;
        rcl.llen(queueKey, function(err, len) {
            err ?  cbNext(err): cbNext(null, memo + (len == sig.count ? 1: 0));
        });
    }, function done(err, result) {
        if (err) return cb(err);
        if (result == spec.length) {
            // all signals are ready
            var queueKey = "wf:"+wfId+":task:"+procId+":ins:"+sig.id;
            // TODO: retrieve signals
            //rcl.lrange(queueKey, 0, )
        } else {
            cb(null, null);
        }
    });
}


//////////////////////////////////////////////////////////////////////////
///////////////////////// private functions //////////////////////////////
//////////////////////////////////////////////////////////////////////////

function getTasks1(wfId, from, to, dataNum, cb) {
    var tasks = [], ins = [], outs = [], data  = [];
    var asyncTasks = [];
    var start, finish;
    start = (new Date()).getTime();
    for (var i=from; i<=to; ++i) {
        // The following "push" calls need to be wrapped in an anynomous function to create
        // a separate scope for each value of "i". See http://stackoverflow.com/questions/2568966
        (function(i) {
            var procKey = "wf:"+wfId+":task:"+i;
            // Retrieve task info
            asyncTasks.push(function(callback) {
                rcl.hmget(procKey, "uri", "name", "status", "fun", function(err, reply) {
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
                rcl.sort(procKey+":ins", function(err, reply) {
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
                rcl.sort(procKey+":outs", function(err, reply) {
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

    //onsole.log("async tasks: "+asyncTasks.length);

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

exports.init = function(redisClient) {
    // FIXME: only this module should have a connection to redis. Currently app.js creates
    // the client which has to be passed around other modules. (For testing purposes
    // optional passing of client could be possible);
    async function init_redis() {
        if (redisClient) {
            rcl = redisClient;
        } else {
            const redisURL = process.env.REDIS_URL ? { url: process.env.REDIS_URL } : undefined
            rcl = redisURL ? redis.createClient({ url: redisURL }) : redis.createClient();
            rcl.on('error', err => console.log('Redis Client Error', err));
            await rcl.connect();
        }

        if (global_hfid == 0) {
            global_hfid = shortid.generate();
        }

        // this object holds global information about this HF engine instance
        // written to redis as a hash map with key "hflow:<uuid>"
        // TODO: add more attributes
        let x = await rcl.hSet("hflow:" + global_hfid, "hf_version", "???");

        console.log("hfid:", global_hfid);
    }
    
    init_redis();

    return {
        createInstance: public_createInstance,
        createInstanceFromFile: public_createInstanceFromFile,
        getWfInfo: public_getWfInfo,
        //getWfInstanceInfo: public_getWfInstanceInfo,
        setWfInstanceState: public_setWfInstanceState,
        getWfTasks: public_getWfTasks,
        getWfIns: public_getWfIns,
        getWfOuts: public_getWfOuts,
        //getWfInsAndOutsInfoFull: public_getWfInsAndOutsInfoFull,
        getTaskInfo: public_getTaskInfo,
        //getTaskIns: public_getTaskIns,
        //getTaskOuts: public_getTaskOuts,
        setTaskState: public_setTaskState,
        getDataInfo: public_getDataInfo,
        getDataInfoFull: public_getDataInfoFull,
        setDataState: public_setDataState,
        getDataSources: public_getDataSinks,
        getDataSinks: public_getDataSinks,
        getRemoteDataSinks: public_getRemoteDataSinks,
        getWfMap: public_getWfMap,
        getTaskMap: public_getTaskMap,
        invokeProcFunction: public_invokeProcFunction,
        //sendSignal: public_sendSignal,
        sendSignal: sendSignalLua,
        getSignalInfo: getSignalInfo,
        popInput: popInput,
        resetStickyPorts: resetStickyPorts,
        fetchInputs: fetchInputs,
        getInitialSigs: getInitialSignals,
        sendSignalLua: sendSignalLua,
        getSigByName: getSigByName,
        getSigRemoteSinks: getSigRemoteSinks,
        setSigRemoteSinks: setSigRemoteSinks,

        hfid: global_hfid
    }
}


process.on('exit', function() {
    //console.log("fetchInputs total time:", fetchInputsTime/1000);
    //console.log("sendSignal total time:", sendSignalTime/1000);
});
