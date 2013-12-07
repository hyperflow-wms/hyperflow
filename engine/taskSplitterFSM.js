/* Hypermedia workflow. 
 ** Implementation of Finite State Machine of a splitter task, continuous version.
 ** This task waits for an input and emits a sequence of outputs. Typically used for splitting 
 ** the input into chunks, but any other function is possible which for a single input emits 
 ** multiple outputs. 
 ** Inputs:
 ** - MUST have exactly ONE data port (data to be splitted); it MUST be the first input port
 ** - MUST have control NEXT port (triggers emission of the next chunk)
 ** - MAY have control DONE port (commands to finish the task instead of emitting the
 **   next chunk or waiting for the next signal)
 ** Outputs:
 ** - MUST have exactly ONE data port (emits consecutive chunks of input); it must be the 1st output port
 ** - MAY have control NEXT port (emitted after a chunk is emitted to the data port)
 ** - MUST have control DONE port (emitted when there no more chunks)
 ** Function:
 ** - Each invocation of f(x) should return the next chunk of data x or null if there are no more chunks
 ** - The task does not specify how to split the data - it's baked into the the function
 **   (e.g. split file into lines, collection into items, etc.)
 ** - TODO: inject 'i' - the exepcted chunk number - as an additional function argument 
 ** 
 ** Author: Bartosz Balis (2013)
 */

var async = require('async'),
    log4js = require('log4js');

    //log4js.configure('log4js.json');

    //var logger = log4js.getLogger('hf-default-logger');

var TaskSplitterFSM = {
    name: "splitter",
    logic: TaskLogic,

    state : [ 
    {   
        name: "init",
        initial: "true",
        onEnter: function (session) { session.dispatch({msgId: "InitRe"}); }
    },
    { name: "ready" },
    { name: "waiting" },
    { name: "running" },
    { name: "finished" } ],

    transition : [ { 
        event       : "InitRe",
        from        : "init",
        to          : "ready",
        onTransition: function() { }
    }, { 
        event       : "ReRu", // when all data ins and 'next' (if such port exists) have arrived
        from        : "ready",
        to          : "running",
    }, { 
        event       : "ReFi", // when 'done' signal has arrived
        from        : "ready",
        to          : "finished",
    }, { 
        event       : "RuRe", // when task served a request, it is ready to serve another one
        from        : "running",
        to          : "ready",
    }, { 
        event       : "RuWa", 
        from        : "running",
        to          : "waiting",
    }, { 
        event       : "WaRu", 
        from        : "waiting",
        to          : "running",
    } ]
};

// This function is invoked on arrival of an input signal.
// 'obj.message' is a JSON object which should contain:
// - wfId: workflow instance id
// - taskId: id of task whose input is fired
// - inId: port id of the input being fired
//var fi_sync = false;
function fireInput(obj) {
    var msg = obj.message, 
        task = obj.session.logic,
        state = obj.session.getCurrentState().name,
        //sigId = task.ins[msg.inId-1];
        sigId = msg.sigId;

    if (sigId == task.doneInId) { // "done" signal has arrived
        task.done = true;
    } 
    tryTransition(task, obj.session);
}


function fetchInputs(task, cb) {
    var sigs = task.firingSigs;
    task.wflib.fetchInputs(task.wfId, task.id, sigs, true, function(arrived, sigValues) {
        //onsole.log("Task", task.id, "fetch attempt:", arrived);
        if (arrived) {
            if (sigs[sigs.length-1][0] == task.nextInId) {
                sigValues.pop(); // remove next signal (should not be passed to the function)
            }
            task.sigValues = sigValues; // set input signal values to be passed to the function
        } else {
            task.ready = true;
        }
        cb(arrived, sigValues);
    });
}

function fetchNext(task, cb) {
    var sigs = [[task.nextInId, 1]]; 
    task.wflib.fetchInputs(task.wfId, task.id, sigs, true, function(arrived, sigValues) {
        cb(arrived, sigValues);
    });
}

function tryTransition(task, session) {
    if (task.ready && task.done) {
        task.ready = false;
        session.dispatch({ msgId: "ReFi"});
    } else if (task.ready) {
        task.ready = false;
        fetchInputs(task, function(arrived, sigValues) {
            if (arrived) {
                session.dispatch({msgId: "ReRu"});
            } else {
                task.ready = true;
            }
        });
    } else if (task.waiting) {
        task.waiting = false;
        fetchNext(task, function(arrived) {
            if (arrived) {
                session.dispatch({msgId: "WaRu"});
            } else {
                task.waiting = true;
            }
        });
    }
}

function TaskLogic() {
    this.tasks = []; // array of all task FSM "sessions" (so that tasks can send events to other tasks)
    this.wfId = -1; // workflow instance id
    this.id = -1; // id of this task
    this.cnt = 0; // how many signals are waiting on all ports; TODO: store this in redis for persistence
    this.dataIns = []; // which data inputs have arrived (are ready)? (dataIns[id]==true) 
    this.nDataIns = -1; // how many data inputs are there?
    this.next = false; // has the signal arrived to the control "next" port?
    this.done = false; // has the signal arrived to the control "done" port?
    this.nextInId  = undefined; // id of 'next' control input port 
    this.nextOutId = undefined; // id of 'next' control output port 
    this.doneInId  = undefined; // id of 'done' control input port 
    this.doneOutId = undefined; // id of 'done' control output port 
    this.ins = []; // ids of inputs (data and control signals)
    this.outs = []; // ids of outputs (data and control signals)
    this.sources = []; 
    this.sinks = [];
    this.firingInterval = -1; // a task can have 0 data inputs and a firing interval ==> its 
                              // function will be invoked regularly according to this interval
    this.firingSigs = [];
    this.sigValues = null;

    this.ready = false;
    this.waiting = false;

    this.init = function(engine, wfId, taskId, session, fullInfo) {
        this.engine = engine;
        this.wflib = engine.wflib;
	this.tasks = engine.tasks;
	this.wfId = wfId;
	this.id = taskId;
	this.ins = engine.ins[taskId];
	this.outs = engine.outs[taskId];
	this.sources = engine.sources;
	this.sinks = engine.sinks;
        this.nDataIns = engine.ins[taskId].length;
        this.firstInvocation = true;
	this.name = fullInfo.name;
        this.fullInfo = fullInfo;

	if (this.id in engine.cPorts) {
            var taskCPorts = engine.cPorts[this.id];
            if ("ins" in taskCPorts) {
                for (var i in taskCPorts.ins) {
                    // this should be correct: #(data_ins) = #(all_ins) - #(control_ins)
                    // (not an efficient way to compute but there should be max ~2 control ins)
                    this.nDataIns--;
                }
                this.nextInId = taskCPorts.ins.next;
                this.doneInId = taskCPorts.ins.done;
            }
            if ("outs" in taskCPorts) {
                this.nextOutId = taskCPorts.outs.next;
                this.doneOutId = taskCPorts.outs.done;
            }
            //onsole.log("Cports: "+this.nextInId, this.doneInId, this.nextOutId, this.doneOutId); // DEBUG
	}

        for (var i in this.ins) {
            var sigId = this.ins[i];
            if ((sigId != this.nextInId) && (sigId != this.doneInId)) {
                this.firingSigs.push([sigId, 1]);
            }
        }
	if (this.nextInId) {
            this.firingSigs.push([this.nextInId,1]);
	}

        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent         : fireInput
        });
    };

    this.ready_enter = function(session, state, transition, msg) {
        var task = session.logic;
        task.ready = true;
        task.waiting = false;

        tryTransition(task, session);

        //onsole.log("Enter state ready: "+task.id);
    };

    this.waiting_enter = function(session, state, transition, msg) {
        var task = session.logic;
        task.waiting = true;
        task.ready = false;

        tryTransition(task, session);

        //onsole.log("Enter state waiting: "+task.id);
    };

    this.running_enter = function(session, state, transition, msg) {
        //onsole.log("Enter state running: "+this.id+" ("+this.name+")");
        var task = this;
        var funcIns = [], funcOuts = [], emul = task.engine.emulate;
        async.waterfall([
                // 1. set task state to running
                function(cb) {
                    task.wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
                        err ? cb(err): cb(null); 
                    });
                },
                // 2. invoke the function
                function(cb) {
                    // create arrays of data ins and outs ids
                    for (var i in task.firingSigs) {
                        var sigId = task.firingSigs[i][0];
                        if (sigId != task.nextInId && sigId != task.doneInId) {
                            funcIns.push(task.sigId);
                        }
                    }
                    for (var i in task.outs) {
                        outId = task.outs[i];
                        if ((outId != task.nextOutId) && outId != task.doneOutId) {
                            funcOuts.push(outId);
                        }
                    }

                    task.wflib.invokeTaskFunction2(
                            task.wfId, 
                            task.id, 
                            funcIns, 
                            task.sigValues, 
                            funcOuts, emul, 
                            function(err, outs) {
                                err ? cb(err): cb(null, outs);
                            }
                    );
                },
                // 3. emit output signals
                function(outs, cb) {
                    if (outs) {
                        task.cnt -= task.firingSigs.length; // subtract cnt by the number of consumed signals
                        if (task.fullInfo.sticky) 
                            task.cnt += task.fullInfo.sticky; // sticky signals weren't actually consumed!
                        var outValues = outs;
                        for (var i=0; i<funcOuts.length; ++i) {
                            outValues[i]["_id"] = funcOuts[i];
                        }
                        if (task.nextOutId) { // emit next signal if there is such an output port
                            outValues.push({"_id": session.logic.nextOutId });
                        }
                        task.engine.emitSignals(outValues, function(err) {
                            session.dispatch( {msgId: "RuWa"} ); // task goes back to waiting state
                            err ? cb(err): cb(null);
                        });
                    } else {
                        session.dispatch( {msgId: "RuRe"} ); // task goes back to ready state
                        cb(null);
                    }
                }
        ]);
    };

    this.running_exit = function(session, state, transition, msg) {
        //onsole.log("Exit state running: "+this.id+" ("+this.name+")");
    };

    this.finished_enter = function(session, state, transition, msg) {
        var task = this;
        task.wflib.setTaskState(task.wfId, task.id, { "status": "finished" }, function(err, rep) {
            if (err) { throw err; }
            //onsole.log("Enter state finished: "+task.id);
            task.engine.taskFinished(task.id);
        });
    };

    this.ReRutransition = function(session, state, transition, msg) { };
    this.RuRetransition = function(session, state, transition, msg) { };
    this.WaRutransition = function(session, state, transition, msg) { };
    this.RuWatransition = function(session, state, transition, msg) { };

    this.ReFitransition = function(session, state, transition, msg) {
      // emit "done" signal if such a port exists
      if (session.logic.doneOutId) {
            session.logic.engine.emitSignals([{"id": session.logic.doneOutId }]);
      }
    };

    return this;
}

module.exports = TaskSplitterFSM;
