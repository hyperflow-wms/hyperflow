/* Hypermedia workflow. 
 ** Hypermedia workflow execution engine based on a DEDS/FSM (Discrete-Event Dynamic System / Finite State Machine)
 ** execution model.
 ** Author: Bartosz Balis (2013)
 */

/*
 * Uses workflow map retrieved from redis:
 *  - ins[i][j]     = data id mapped to j-th output port of i-th task
 *  - outs[i][j]    = data id mapped to j-th input port of i-th task
 *  - sources[i][1] = task id which produces data element with id=i (if none, sources[i]=[])
 *  - sources[i][2] = port id in this task the data element is mapped to
 *  - sinks[i][j]   = task id which consumes data element with id=i (if none, sinks[i]=[])
 *  - sinks[i][j+1] = port id in this task the data element is mapped to
 */

var fs = require('fs'),
    xml2js = require('xml2js'),
    fsm = require('automata'),
    async = require('async');

var TaskFSM        = require('./taskFSM.js');
var TaskForeachFSM = require('./taskForeachFSM.js');
var TaskSplitterFSM = require('./taskSplitterFSM.js');
var TaskStickyServiceFSM = require('./taskStickyServiceFSM.js');

// TODO: automatically import and register all task FSMs in the current directory
fsm.registerFSM(TaskFSM); 
fsm.registerFSM(TaskForeachFSM);
fsm.registerFSM(TaskSplitterFSM);
fsm.registerFSM(TaskStickyServiceFSM);

// Engine constructor
// @config: JSON object which contains Engine configuration:
// - config.emulate (true/false) = should engine work in the emulation mode?
var Engine = function(config, wflib, wfId, cb) {
    this.wflib = wflib;
    this.wfId = wfId;
    this.tasks = [];      // array of task FSMs
    this.ins = [];
    this.outs = [];
    this.sources = [];
    this.sinks = [];
    this.trace = "";  // trace: list of task ids in the sequence they were finished
    this.nTasksLeft = 0;  // how many tasks left (not finished)? FIXME: what if a task can 
                          // never be finished (e.g. TaskService?)
                          
    this.emulate = config.emulate == "true" ? true: false;       

    (function(engine) {
        engine.wflib.getWfMap(wfId, function(err, nTasks, nData, ins, outs, sources, sinks, types, cPortsInfo) {
            //console.log("cPortsInfo:"); console.log(cPortsInfo); // DEBUG
            engine.nTasksLeft = nTasks;
            engine.ins = ins;
            engine.outs = outs;
            engine.sources = sources;
            engine.sinks = sinks;
            engine.cPorts = cPortsInfo;

            // create tasks of types other than default "task" (e.g. "foreach", "splitter", etc.)
            for (var type in types) {
                //console.log("type: "+type+", "+types[type]); // DEBUG
                types[type].forEach(function(taskId) {
                    engine.tasks[taskId] = fsm.createSession(type);
                    engine.tasks[taskId].logic.init(engine, wfId, taskId, engine.tasks[taskId]);
                });
            }
            // create all other tasks (assuming the default type "task")
            for (var taskId=1; taskId<=nTasks; ++taskId) {
                if (!engine.tasks[taskId]) {
                    engine.tasks[taskId] = fsm.createSession("task");
                    engine.tasks[taskId].logic.init(engine, wfId, taskId, engine.tasks[taskId]);
                }
            }
            cb(null);
        });
    })(this);
}
	
    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

Engine.prototype.runInstance = function (cb) {
    this.wflib.setWfInstanceState( this.wfId, { "status": "running" }, function(err, rep) {
        cb(err);
        //console.log("Finished");
    });

    // Emulate workflow execution: change state of all workflow inputs to "ready" and send
    // signal to all sink tasks; pretend task Functions are invoked and results computed.
    if (this.emulate) {
        (function(engine) {
            engine.wflib.getWfIns(engine.wfId, false, function(err, wfIns) {
                for (var i=0; i<wfIns.length; ++i) {
                    markDataReadyAndNotifySinks(engine.wfId, wfIns[i], engine.tasks, engine.wflib, function() { });
                }
            });
        })(this);
    }
}


// Marks data elements as 'ready' and notify their sinks
// dataIds - single data Id or an array of dataIds
// FIXME: check what happens if data is marked more than once
// quasi-deprecated (should refactor remaining places which still us this old API)
// now fireSignals should be used
Engine.prototype.markDataReady = function(dataIds, cb) {
    function isArray(what) {
        return Object.prototype.toString.call(what) === '[object Array]';
    }

    var Ids = [];
    isArray(dataIds) ? Ids = dataIds: Ids.push(dataIds);
    //var start = (new Date()).getTime(), finish;
    (function(engine) {
        Ids.forEach(function(dataId) {
            markDataReadyAndNotifySinks(engine.wfId, dataId, engine.tasks, engine.wflib, function() {
                //finish = (new Date()).getTime();
                //console.log("markDataReady exec time: "+(finish-start));
            });
        });
    })(this);
    cb(null);
}

Engine.prototype.taskFinished = function(taskId) {
    this.trace += taskId;
    this.nTasksLeft--;
    if (!this.nTasksLeft) {
        console.log(this.trace+'. ['+this.wfId+']');
    } else {
        this.trace += ',';
    }
}


// Fires a set of signals notifying all tasks which are their sinks.
// For data signals also updates their state (e.g. marks data elements as ready)
// @sigs (array): ids of signals (data and control ones) to be fired
//                format: [ { attr: value, 
//                            ... 
//                            "id": sigId
//                           },
//                           { attr: value,
//                                ...
//                            "id": sigId
//                           }
//                        ]
// FIXME: protect against firing signals more than once (currently some task 
// implementations will break in such a case). 
Engine.prototype.fireSignals = function(sigs, cb) {
    var spec = {}, ids = [];
    for (var i in sigs) { 
        var sigId = sigs[i].id;
        ids.push(sigId);
        if (sigs[i].type  == "control") { // this is a control signal
            spec[sigId] = {}; // TODO: should we also mark this signal as ready?
        } else { // this is a data signal
            spec[sigId] = { "status":"ready" } // mark data element as "ready" (produced)
            if ("value" in sigs[i]) { // save data value if present in the signal info
                spec[sigId].value = sigs[i].value;
            }
        }
    }

    // notify sinks of all fired signals
    (function(engine) {
        //console.log(spec);
        engine.wflib.setDataState(engine.wfId, spec, function(err, reps) {
            //console.log("Will notify: "+JSON.stringify(sigs));
            async.each(ids, function iterator(sigId, doneIter) {
                notifySinks(engine.wfId, sigId, engine.tasks, engine.wflib, function() { 
                    doneIter(null);
                });
            }, function doneAll(err) {
                if (cb) { cb(err); }
            });
        });
    })(this);
}


module.exports = Engine;

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////
    
function notifySinks(wfId, sigId, taskFSMs, wflib, cb) {
    wflib.getDataSinks(wfId, sigId, function(err, sinks) {
        //console.log(sigId, sinks);
        if (err) { throw(err); }
        for (var j=0; j<sinks.length; j+=2) {
            // send event that an input is ready
            taskFSMs[sinks[j]].fireCustomEvent({
                wfId: wfId, 
                taskId: sinks[j], 
                inId: sinks[j+1] 
            });
            console.log("sending to task "+sinks[j]+", port "+sinks[j+1]);
        }
        cb(null);
    });
}


// quasi-deprecated (only used by the engine when emulating the execution to fire wf ins)
// TODO: refactor engine to use fireSignals instead
function markDataReadyAndNotifySinks(wfId, dataId, taskFSMs, wflib, cb) {
    var obj = {};
    obj[dataId] = {"status": "ready" };
    wflib.setDataState(wfId, obj, function(err, rep) {
	if (err) { throw(err); }
	wflib.getDataSinks(wfId, dataId, function(err, sinks) {
	    if (err) { throw(err); }
	    for (var j=0; j<sinks.length; j+=2) {
                // send event that an input is ready
                taskFSMs[sinks[j]].fireCustomEvent({
		    wfId: wfId, 
		    taskId: sinks[j], 
		    inId: sinks[j+1] 
		});
		console.log("sending to task "+sinks[j]+", port "+sinks[j+1]);
	    }
	    if (cb) { cb(); } 
	});
    });
}
