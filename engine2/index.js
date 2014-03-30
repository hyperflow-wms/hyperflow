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


var ProcDataflowFSM = require('./ProcDataflowFSM.js');
var ProcChoiceFSM = require('./ProcChoiceFSM.js');
var ProcForeachFSM = require('./ProcForeachFSM.js');
var ProcJoinFSM = require('./ProcJoinFSM.js');
var ProcSplitterFSM = require('./ProcSplitterFSM.js');


// TODO: automatically import and register all task FSMs in the current directory
fsm.registerFSM(ProcDataflowFSM);
fsm.registerFSM(ProcChoiceFSM);
fsm.registerFSM(ProcForeachFSM);
fsm.registerFSM(ProcJoinFSM);
fsm.registerFSM(ProcSplitterFSM);


// Engine constructor
// @config: JSON object which contains Engine configuration:
// - config.emulate (true/false) = should engine work in the emulation mode?
var Engine = function(config, wflib, wfId, cb) {
    this.wflib = wflib;
    this.eventServer = eventServerFactory.createEventServer();
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

    this.logProvenance = false;
                          
    this.eventServer.on('prov', function(data) {
        console.log(arguments[1]);
    });

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

// Function used by processes to emit signals
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
                // at this point "s" contains unique 'sigIdx' set in 'sendSignal' => we can emit "write" 
                // provenance events (for signals which have "source", i.e. were written by a process)
                if (s.source && engine.logProvenance) { 
                    engine.eventServer.emit("prov", ["write", +engine.wfId, s.source, s.firingId, s._id, s.sigIdx]);
                }

                if (!err) {
                    // notify sinks that the signals have arrived
                    for (var j=0; j<sinks.length; j++) {
                        // send event that an input is ready
                        engine.tasks[sinks[j]].fireCustomEvent({
                            wfId: engine.wfId, 
                            taskId: sinks[j], 
                            sigId: _sigId,
                            sig: s
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

module.exports = Engine;
