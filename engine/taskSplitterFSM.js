 /* Hypermedia workflow. 
 ** Implementation of Finite State Machine of a splitter task. This task waits for an input
 ** and emits a sequence of outputs. Typically used for splitting the input into chunks, but 
 ** any other function is possible which for a single input emits multiple outputs. 
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

var TaskSplitterFSM = {
    name: "splitter",
    logic: TaskLogic,

    state : [ 
        {
	    name: "ready", // ready for the data input
            initial: true,
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
	    event       : "RuFi",
	    from        : "running",
	    to          : "finished",
	    onTransition: "trRuFi",
	},
    ]
};

// This function is invoked when one of task's inputs becomes ready. What happens next depends 
// on the particular task type semantics. 
// 'obj.message' is a JSON object which should contain:
// - wfId: workflow instance id
// - taskId: id of task whose input is fired
// - inId: port id of the input being fired
function fireInput(obj) {
    var msg = obj.message, 
        task = obj.session.logic,
        state = obj.session.getCurrentState().name,
        sigId = task.ins[msg.inId-1];

    if (sigId == task.ins[0]) {
        if (task.dataIn) {
            // duplicate signal on data input port? TODO: log warning
            //throw (new Error("Duplicate data on input port"));
            // do nothing, we should already be in the waiting or running state
        } else {
            task.dataIn = true;
            msg.msgId = "ReRu";
            obj.session.dispatch(msg);
        }
    } else if (sigId == task.nextInId) {
        task.next = true;
        if (state == "waiting") {
            msg.msgId = "WaRu";
            task.next = false;
            obj.session.dispatch(msg);
        }
    } else {
        throw (new Error("Wrong input port id"));
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
    this.nextInId  = -1; // id of 'next' control input port (-1 = there is none)
    this.nextOutId = -1; // id of 'next' control output port (-1 = there is none)
    this.doneInId  = -1; // id of 'done' control input port (-1 = there is none)
    this.doneOutId = -1; // id of 'done' control output port (there should be one)
    this.ins = []; // ids of data inputs (should be exactly one)
    this.outs = []; // ids of data outputs (should be exaclty one)
    this.sources = []; 
    this.sinks = [];

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
        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent: fireInput
        });
    };

    this.ready_onEnter = function(session, state, transition, msg) {
        console.log("Enter state ready: "+this.id);
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id);
	(function(task) {
	    task.wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
                if (err) { throw err; }
                var funcIns = [task.ins[0]], funcOuts = [task.outs[0]], emul = task.engine.emulate;
                //funcIns.push(task.i); // number of chunk the function is supposed to return FIXME won't work like this
                //console.log(funcIns, funcOuts);
                task.wflib.invokeTaskFunction(task.wfId, task.id, funcIns, funcOuts, emul, function(err, rep) {
                    if (err) {
                        throw(err);
                        // TODO: how does the engine handle error in invocation of task's
                        // function? E.g. Does it affect the state machine of the task?
                        // Should there be an error state and transitions from it, e.g. retry? 
                    } else if (rep != null) {
                        task.i++;
                        session.dispatch( {msgId: "RuWa"} );
                        task.engine.fireSignals(rep);
                    } else {
                        session.dispatch( {msgId: "RuFi"} );
                    }
                });
            });
	})(this);
    };

    this.waiting_onEnter = function(session, state, transition, msg) {
        console.log("Enter state waiting: "+this.id);
        if (session.logic.next) {
            //msg.msgId = "WaRu";
            session.logic.next = false;
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
            session.logic.engine.fireSignals([{"id": session.logic.nextOutId }]);
        }
    };

    this.trRuFi = function(session, state, transition, msg) {
        if (session.logic.doneOutId) {
            session.logic.engine.fireSignals([{"id": session.logic.doneOutId }]);
        }
    };

    return this;
}

module.exports = TaskSplitterFSM;
