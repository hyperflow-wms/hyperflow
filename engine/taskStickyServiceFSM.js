 /* Hypermedia workflow. 
 ** Implementation of Finite State Machine of a 'sticky' service task. This task ... 
 ** Inputs:
 ** - ...
 ** Outputs:
 ** - ...
 ** Function:
 ** - ... 
 ** 
 ** Author: Bartosz Balis (2013)
 */

var TaskStickyServiceFSM = {
    name: "stickyservice",
    logic: TaskLogic,

    state : [ 
        {
	    name: "ready", 
            initial: true,
            onEnter: "ready_onEnter"
	},
    	{ 
	    name: "running", 
            onEnter: "running_onEnter",
            onExit: "running_onExit"
	},
    	{
	    name: "finished", 
            onEnter: "finished_onEnter"
	}
    ],

    transition : [ 
        { 
	    event       : "ReRu", // when all data ins and 'next' have arrived
	    from        : "ready",
	    to          : "running",
	    onTransition: "trReRu",
	},
        { 
	    event       : "ReFi", // when 'done' signal has arrived
	    from        : "ready",
	    to          : "finished",
	    onTransition: "trReFi",
	},
	{ 
	    event       : "RuRe", // when task served a request, it is ready to serve another one
	    from        : "running",
	    to          : "ready",
	    onTransition: "trRuRe",
	}
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

    if (sigId == task.nextInId) { // "next" signal has arrived
        task.next = true;
        if (state == "ready" && task.cnt == task.nDataIns) {
            task.next = false;
            msg.msgId = "ReRu";
            obj.session.dispatch(msg);
        }
    } else if (sigId == task.doneInId) { // "done" signal has arrived
        task.done = true;
        if (state == "ready") {
            msg.msgId = "ReFi"
            obj.session.dispatch(msg);
        }
    } else { // something arrived at a data port
        if (!(task.dataIns[sigId])) {
            task.dataIns[sigId] = true;
            task.cnt++;
        }
        if (state == "ready" && task.cnt == task.nDataIns && task.next == true) {
            task.next = false;
            msg.msgId = "ReRu";
            obj.session.dispatch(msg);
        }
    }
}


function TaskLogic() {
    this.tasks = []; // array of all task FSM "sessions" (so that tasks can send events to other tasks)
    this.wfId = -1; // workflow instance id
    this.id = -1; // id of this task
    this.cnt = 0; // how many data inputs have arrived
    this.dataIns = []; // which data inputs have arrived (are ready)? (dataIns[id]==true) 
    this.nDataIns = -1; // how many data inputs are there?
    this.next = false; // has the signal arrived to the control "next" port?
    this.done = false; // has the signal arrived to the control "done" port?
    this.nextInId  = undefined; // id of 'next' control input port (-1 = there is none)
    this.nextOutId = undefined; // id of 'next' control output port (-1 = there is none)
    this.doneInId  = undefined; // id of 'done' control input port (-1 = there is none)
    this.doneOutId = undefined; // id of 'done' control output port (there should be one)
    this.ins = []; // ids of data inputs 
    this.outs = []; // ids of data outputs 
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
        this.nDataIns = engine.ins[taskId].length;
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
        var task = session.logic;
        if (task.done) {
            msg.msgId = "ReFi";
            session.dispatch(msg);
        } else if (task.next && task.cnt == task.nDataIns) {
            task.next = false;
            msg.msgId = "ReRu";
            session.dispatch(msg);
        }
        console.log("Enter state ready: "+task.id);
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id);
	(function(task) {
	    task.wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
                if (err) { throw err; }
                var funcIns = [], funcOuts = [], emul = task.engine.emulate;

                // create arrays of data ins and outs ids
                // FIXME: done not very efficiently
                for (var i in task.ins) {
                    inId = task.ins[i];
                    if ((inId != task.nextInId) && inId != task.doneInId) {
                        funcIns.push(inId);
                    }
                }
                for (var i in task.outs) {
                    outId = task.outs[i];
                    if ((outId != task.nextOutId) && outId != task.doneOutId) {
                        funcOuts.push(outId);
                    }
                }

                //console.log(funcIns, funcOuts);
                task.wflib.invokeTaskFunction(task.wfId, task.id, funcIns, funcOuts, emul, function(err, rep) {
                    if (err) {
                        throw(err);
                        // TODO: how does the engine handle error in invocation of task's
                        // function? E.g. Does it affect the state machine of the task?
                        // Should there be an error state and transitions from it, e.g. retry? 
                    } else {
                        session.dispatch( {msgId: "RuRe"} );
                        task.engine.fireSignals(rep);
                        if (task.nextOutId) {
                            task.engine.fireSignals([{"id": session.logic.nextOutId }]);
                        }
                    }
                });
            });
	})(this);
    };

    this.running_onExit = function(session, state, transition, msg) {
        //console.log("Exit state running");
    };

    this.finished_onEnter = function(session, state, transition, msg) {
	(function(task) {
	    task.wflib.setTaskState(task.wfId, task.id, { "status": "finished" }, function(err, rep) {
		if (err) { throw err; }
		console.log("Enter state finished: "+task.id);
		task.engine.taskFinished(task.id);
	    });
	})(this);
    };

    this.trReRu = function(session, state, transition, msg) {
        //console.log("Transition ReRu, task "+this.id);
    };

    this.trReFi = function(session, state, transition, msg) {
      if (session.logic.doneOutId) {
            session.logic.engine.fireSignals([{"id": session.logic.doneOutId }]);
      }
    };

    this.trRuRe = function(session, state, transition, msg) {
  
    };

    return this;
}

module.exports = TaskStickyServiceFSM;
