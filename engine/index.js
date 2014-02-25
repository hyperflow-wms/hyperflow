/** Hypermedia workflow execution engine. 
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
    fsm = require('./automata.js'),
    async = require('async'),
    eventServerFactory = require('../eventlog');

var TaskDataflowFSM = require('./taskDataflowFSM.js');
var TaskForeachFSM = require('./taskForeachFSM.js');
var TaskSplitterFSM = require('./taskSplitterFSM.js');
var TaskChoiceFSM = require('./taskChoiceFSM.js');


// TODO: automatically import and register all task FSMs in the current directory
fsm.registerFSM(TaskDataflowFSM);
fsm.registerFSM(TaskForeachFSM);
fsm.registerFSM(TaskSplitterFSM);
fsm.registerFSM(TaskChoiceFSM);

// binary search algorithm for finding elements in workflow arrays
// patching Array's prototype like this causes erroneous behavior elsewhere!!!
/*Array.prototype.binSearch = function(needle, case_insensitive) {
	if (!this.length) return -1;

	var high = this.length - 1;
	var low = 0;
	case_insensitive = (typeof(case_insensitive) !== 'undefined' && case_insensitive) ? true:false;
	needle = (case_insensitive) ? needle.toLowerCase():needle;

	while (low <= high) {
		mid = parseInt((low + high) / 2)
			element = (case_insensitive) ? this[mid].toLowerCase():this[mid];
		if (element > needle) {
			high = mid - 1;
		} else if (element < needle) {
			low = mid + 1;
		} else {
			return mid;
		}
	}
	return -1;
};*/

// Engine constructor
// @config: JSON object which contains Engine configuration:
// - config.emulate (true/false) = should engine work in the emulation mode?
var Engine = function(config, wflib, wfId, cb) {
    this.wflib = wflib;
    this.eventServer = eventServerFactory.createEventServer();;
    this.wfId = wfId;
    this.tasks = [];      // array of task FSMs
    this.ins = [];
    this.outs = [];
    this.sources = [];
    this.sinks = [];
    this.wfOuts = [];
    this.trace = "";  // trace: list of task ids in the sequence they were finished
    this.nTasksLeft = 0;  // how many tasks left (not finished)? 
    this.nWfOutsLeft = 0; // how many workflow outputs are still to be produced? 
    this.syncCb = null; // callback invoked when wf instance finished execution  (passed to runInstanceSync)
                          
    this.emulate = config.emulate == "true" ? true: false;       

    this.startTime = (new Date()).getTime(); // the start time of this engine (workflow)

    var engine = this;
    engine.wflib.getWfMap(wfId, function(err, nTasks, nData, ins, outs, sources, sinks, types, cPortsInfo, fullInfo) {
        //onsole.log("cPortsInfo:"); onsole.log(cPortsInfo); // DEBUG
        engine.nTasksLeft = nTasks;
        engine.ins = ins;
        engine.outs = outs;
        engine.sources = sources;
        engine.sinks = sinks;
        engine.cPorts = cPortsInfo;

        // create processes of types other than default "dataflow" (e.g. "foreach", "splitter", etc.)
        for (var type in types) {
            //onsole.log("type: "+type+", "+types[type]); // DEBUG
            types[type].forEach(function(taskId) {
                engine.tasks[taskId] = fsm.createSession(type);
                engine.tasks[taskId].logic.init(engine, wfId, taskId, engine.tasks[taskId], fullInfo[taskId]);
            });
        }
        // create all other processes (assuming the default type "dataflow")
        for (var taskId=1; taskId<=nTasks; ++taskId) {
            if (!engine.tasks[taskId]) {
                engine.tasks[taskId] = fsm.createSession("dataflow");
                engine.tasks[taskId].logic.init(engine, wfId, taskId, engine.tasks[taskId], fullInfo[taskId]);
            }
        }

        engine.wflib.getWfOuts(engine.wfId, false, function(err, wfOuts) {
            engine.wfOuts = wfOuts;
            engine.nWfOutsLeft = wfOuts.length ? wfOuts.length: -1;
            cb(null);
        });
    });
}
	
    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

Engine.prototype.runInstance = function (cb) {
    var engine = this;
    engine.wflib.setWfInstanceState(engine.wfId, { "status": "running" }, function(err, rep) {
        if (err) return cb(err);
        // send initial signals (if any) to the instance
        engine.wflib.getInitialSigs(engine.wfId, function(err, sigs) {
            if (sigs) {
                engine.emitSignals(sigs, function(err) {
                    cb(err);
                });
            }
        });
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

// callback of this function is invoked only when the workflow instance running in this
// engine has finished execution.
Engine.prototype.runInstanceSync = function(callback) {
    (function(engine) {
        engine.runInstance(function(err) {
            engine.syncCb = callback;
        });
    })(this);
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
                //onsole.log("markDataReady exec time: "+(finish-start));
            });
        });
    })(this);
    cb(null);
}

Engine.prototype.taskFinished = function(taskId) {
    this.trace += taskId;
    this.nTasksLeft--;
    //onsole.log("OUTS LEFT:", this.nWfOutsLeft);
    if (this.nWfOutsLeft == 0 || this.nTasksLeft == 0) {
        this.workflowFinished(); // all wf outputs produced ==> wf is finished (always?)
    } else {
        this.trace += ",";
    }
}

Engine.prototype.workflowFinished = function() {
    console.log("Workflow ["+this.wfId+"] finished. Exec trace:", this.trace+"." );
    //onsole.log(this.syncCb);
    if (this.syncCb) {
        this.syncCb();
    }
}

// NEW API for sending signals for continuous processes with FIFO queues
// WILL DEPRECATE fireSignals
// @sigs (array): ids of signals (data and control ones) to be emitted
//                format: [ { attr: value, 
//                            ... 
//                            "_id": sigId,
//                            "data": [ { ... }, ... { ... } ] => multiple instances of this signal
//                           },
//                           { attr: value,
//                                ...
//                            "_id": sigId,
//                            "data": [ { ... }, ... { ... } ] => multiple instances of this signal
//                           }
//                        ]
Engine.prototype.emitSignals = function(sigs, cb) {
    var timeStamp; // time stamp to be added to each signal (relative to workflow start time)
    var engine = this;

    var copySignal = function(sig) {
        var copy = {};
        if (null == sig || "object" != typeof sig) return sig;
        for (var attr in sig) {
            if (sig.hasOwnProperty(attr) && attr != "data") 
                copy[attr] = sig[attr];
        }
        return copy;
    }

    timeStamp = (new Date()).getTime() - engine.startTime; 

    // iterate over all signals to be sent
    async.each(sigs, function iterator(sig, doneIter) {
        var sigInstances = [];
        sig._ts = timeStamp;
        if (sig.data) { // there is a 'data' array which may contain multiple instances of this signal
            for (var i in sig.data) {
                var s = copySignal(sig);
                s.data = [sig.data[i]];
                sigInstances.push(s);
            }
        } else {
            sigInstances.push(sig);
        }

        // send all instances of a given signal
        async.each(sigInstances, function(s, doneIterInner) {
            var _sigId = s._id;
            engine.wflib.sendSignal(engine.wfId, s, function(err, sinks) {
		//onsole.log(sinks);
                if (!err) {
                    // notify sinks that the signals have arrived
                    for (var j=0; j<sinks.length; j++) {
                        // send event that an input is ready
                        engine.tasks[sinks[j]].fireCustomEvent({
                            wfId: engine.wfId, 
                            taskId: sinks[j], 
                            sigId: _sigId
                        });
                        //onsole.log("sending signal", _sigId, "to task", sinks[j]);
                    }
                }
                doneIterInner(err);
            });
        }, function doneAllInner(err) {
            doneIter(err);
        });

    }, function doneAll(err) {
        if (cb) { cb(err); }
    });
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
// Will be DEPRECATED by emitSignals
Engine.prototype.fireSignals = function(sigs, cb) {
	var spec = {}, ids = [];
	for (var i in sigs) { 
		var sigId = sigs[i].id;
		ids.push(sigId);
		if (sigs[i].type  == "control") { // this is a control signal
			spec[sigId] = {}; // TODO: should we also mark this signal as ready?
		} else { // this is a data signal
			spec[sigId] = sigs[i]; // copy all attributes...
			delete spec[sigId].id; // ... except 'id'
			spec[sigId].status = "ready"; // mark data element as "ready" (produced)
			if (this.wfOuts.indexOf(sigId) != -1) { // a workflow output has been produced
				this.nWfOutsLeft--;
			}
		}
	}

	// notify sinks of all fired signals
	(function(engine) {
		//onsole.log(spec);
		engine.wflib.setDataState(engine.wfId, spec, function(err, reps) {
			//onsole.log("Will notify: "+JSON.stringify(sigs));
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
    wflib.getDataSinks(wfId, sigId, true, function(err, sinks) {
        //onsole.log(sigId, sinks);
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
	obj[dataId] = { "status": "ready" };
	wflib.setDataState(wfId, obj, function(err, rep) {
		if (err) { throw(err); }
		wflib.getDataSinks(wfId, dataId, true, function(err, sinks) {
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
