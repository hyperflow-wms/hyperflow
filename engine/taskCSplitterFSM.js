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
var async = require('async');

var TaskCSplitterFSM = {
    name: "csplitter",
    logic: TaskLogic,

    state : [ 
        {
            name: "init",
            initial: true,
            onEnter: function (session) { session.dispatch({msgId: "InitRe"}); }
        },
        {
	    name: "ready", // ready for the data input
            onEnter: "ready_onEnter"
	},
        { 
	    name: "waiting", // waiting for the 'next' signal to emit the next chunk
            onEnter: "waiting_onEnter",
            onExit: "waiting_onExit"
	},
    	{ 
	    name: "running", // invoking the function and emitting the next chunk
            onEnter: "running_onEnter",
            onExit: "running_onExit"
	},
    	{
	    name: "finished", // task terminates
            onEnter: "finished_onEnter"
	}
    ],

    transition : [ 
        { 
	    event       : "InitRe",
	    from        : "init",
	    to          : "ready",
	    onTransition: function() { }
	},
        { 
	    event       : "ReRu",
	    from        : "ready",
	    to          : "running",
	    onTransition: "trReRu",
	},
        { 
	    event       : "WaRu",
	    from        : "waiting",
	    to          : "running",
	    onTransition: "trWaRu",
	},
	{ 
	    event       : "RuWa",
	    from        : "running",
	    to          : "waiting",
	    onTransition: "trRuWa",
	},
        { 
	    event       : "RuRe",
	    from        : "running",
	    to          : "ready",
	    onTransition: "trRuRe",
	},
    ]
};

// This function is invoked when a signal arrives on task's input 
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

    //fi_sync = true;

    if (sigId == task.doneInId) {
        task.done = true; // we got a "done" signal (commands to finish the task as soon as all ins are processed)
        //fi_sync = false;
    } else if (state == "ready") { // if we're in "ready" state, check if data input and "next" have arrived
        var sigs = task.firingSigs.slice(0); // clone the array
        if (task.nextInId && task.i > 1) { // for the first chunk, we don't wait for "next"
            // FIXME: this code is never reached?
            sigs.push([task.nextInId, 1]);
        }
        task.wflib.fetchInputs(task.wfId, task.id, sigs, true, function(arrived, sigValues) {
            //console.log("ARRIVED", arrived);
            if (arrived) {
                //console.log("SIG VALUES", sigValues);
                if (sigs[sigs.length-1][0] == task.nextInId) {
                    sigValues.pop();
                }
                this.sigValues = sigValues;
                obj.session.dispatch({msgId: "ReRu"});
            }
            //fi_sync = false;
        });
    } else if (state == "waiting") { // if we're in "waiting" state, check if "next" has arrived
        if (task.nextInId) { 
            task.wflib.fetchInputs(task.wfId, task.id, [[task.nextInId, 1]], true, function(arrived) {
                //console.log("ARRIVED2", arrived);
                if (arrived) {
                    obj.session.dispatch({msgId: "WaRu"});
                }
                //fi_sync = false;
            });
        } else { /*fi_sync = false;*/ }
    } else { 
        //fi_sync = false; 
    }
}


function TaskLogic() {
    this.tasks = []; // array of all task FSM "sessions" (so that tasks can send events to other tasks)
    this.wfId = -1; // workflow instance id
    this.id = -1; // id of this task
    this.i = 1; // the number of data chunk to be emitted next
    this.dataIn = false; // has the signal arrived to the data port?
    this.next = false; // has the signal arrived to the control "next" port?
    this.done = false; // has the signal arrived to the control "done" port?
    this.nextInId  = undefined; // id of 'next' control input port (-1 = there is none)
    this.nextOutId = undefined; // id of 'next' control output port (-1 = there is none)
    this.doneInId  = undefined; // id of 'done' control input port (-1 = there is none)
    this.doneOutId = undefined; // id of 'done' control output port (there should be one)
    this.ins = []; // ids of data inputs (should be exactly one)
    this.outs = []; // ids of data outputs (should be exaclty one)
    this.sources = []; 
    this.sinks = [];
    this.sigValues = null; 

    this.init = function(engine, wfId, taskId, session) {
        this.engine = engine;
        this.wflib = engine.wflib;
	this.tasks = engine.tasks;
	this.wfId = wfId;
	this.id = taskId;
	this.ins = engine.ins[taskId];
	this.outs = engine.outs[taskId];
	this.sources = engine.sources;
	this.sinks = engine.sinks;
        this.firingSigs = []; // data inputs to wait for in the format accepted by fetchInputs
        //console.log(engine.cPorts);
	if (this.id in engine.cPorts) {
            var taskCPorts = engine.cPorts[this.id];
            if ("ins" in taskCPorts) {
                this.nextInId = taskCPorts.ins.next;
                this.doneInId = taskCPorts.ins.done;
            }
            if ("outs" in engine.cPorts[this.id]) {
                this.nextOutId = taskCPorts.outs.next;
                this.doneOutId = taskCPorts.outs.done;
            }
            //console.log("Cports: "+this.nextInId, this.doneInId, this.nextOutId, this.doneOutId); // DEBUG
	}
        var task = this;
        this.ins.forEach(function(input) {
            if (input != task.nextInId && input != task.doneInId) { // FIXME: recognize smarter which ins are control signals
                task.firingSigs.push([input, 1]);
            }
            console.log(task.firingSigs); 
        });
        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent: fireInput
        });
    };

    this.ready_onEnter = function(session, state, transition, msg) {
        var task = session.logic;
        var sigs = task.firingSigs.slice(0); // clone the array
        /*if (task.nextInId) {
            sigs.push([task.nextInId, 1]); // we should never wait for 'next' in ready state?
        }*/
        this.wflib.fetchInputs(task.wfId, task.id, sigs, true, function(arrived, sigValues) {
            if (arrived) {
                this.sigValues = sigValues;
                session.dispatch({msgId: "ReRu"});
            } else if (task.done) {
                session.dispatch({msgId: "ReFi"});
            }
        });

        console.log("Enter state ready: "+this.id);
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id);
	(function(task) {
            var funcIns = [task.ins[0]], funcOuts = [task.outs[0]];
            async.waterfall([
                // 1. set task state to running
                function(cb) {
                    //console.log("STEP 1");
                    task.wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
                        err ? cb(err): cb(null);
                    });
                }, 
                // 2. invoke the function
                function(cb) {
                    //console.log("STEP 2");
                    var emul = task.engine.emulate;
                    //funcIns.push(task.i); // number of chunk the function is supposed to return FIXME won't work like this
                    task.wflib.invokeTaskFunction1(task.wfId, task.id, funcIns, funcOuts, emul, function(err, outs) {
                        err ? cb(err): cb(null, outs);
                    });
                },
                // 3. emit output signals
                function(outs, cb) {
                    //console.log("STEP 3");
                    if (outs == null) { // no more chunks 
                        session.dispatch( {msgId: "RuRe"} ); // back to waiting for data input
                        return cb(null);
                    } else {
                        task.i++;
                        var outValues = outs;
                        for (var i=0; i<funcOuts.length; ++i) {
                            outValues[i]["_id"] = funcOuts[i];
                        }
                        if (task.nextOutId) {
                            outValues.push({"_id": session.logic.nextOutId });
                        }
                        task.engine.emitSignals(outValues, function(err) {
                            session.dispatch( {msgId: "RuWa"} );
                            err ? cb(err): cb(null);
                        });
                    }
                }
            ], function(err) {
                if (err) { 
                    // TODO: error handling
                }
            });
        })(this);
    }

    this.waiting_onEnter = function(session, state, transition, msg) {
        console.log("Enter state waiting: "+this.id);
        if (session.logic.nextInId) { // there is a "next" input port -> check its queue 
            this.wflib.fetchInputs(this.wfId, this.id, [[this.nextInId, 1]], true, function(arrived) {
                if (arrived) {
                    session.dispatch({msgId: "WaRu"});
                }
            });
        } else {
            // there is no "next" input port -> immediately do next round of processing
            session.dispatch({msgId: "WaRu"});
        }
    };

    this.waiting_onExit = function(session, state, transition, msg) {
        //console.log("Exit state waiting");
    };

    this.running_onExit = function(session, state, transition, msg) {
        //console.log("Exit state running");
    };

    this.finished_onEnter = function(session, state, transition, msg) {
	(function(task) {
	    task.wflib.setTaskState(task.wfId, task.id, { "status": "finished" }, function(err, rep) {
		if (err) {
		    throw err;
		}
		console.log("Enter state finished: "+task.id);
		task.engine.taskFinished(task.id);
	    });
	})(this);
    };

    this.trReRe = function(session, state, transition, msg) {

    };

    this.trReRu = function(session, state, transition, msg) {
        //console.log("Transition ReRu, task "+this.id);
    };

    this.trRuWa = function(session, state, transition, msg) {
        if (session.logic.nextOutId) {
            session.logic.engine.emitSignals([{"id": session.logic.nextOutId }]);
        }
    };

    this.trRuRe = function(session, state, transition, msg) {
        this.i = 1; // the number of data chunk to be emitted next
        this.dataIn = false; // has the signal arrived to the data port?
        this.next = false; // has the signal arrived to the control "next" port?
    };

    this.trRuFi = function(session, state, transition, msg) {
        if (session.logic.doneOutId) {
            session.logic.engine.emitSignals([{"id": session.logic.doneOutId }]);
        }
    };

    return this;
}

module.exports = TaskCSplitterFSM;
