 /* Hypermedia workflow. 
 ** Implementation of Finite State Machine of a 'foreach' task. This task processes its inputs
 ** one by one, sequentially. Algorithm: (i) when task starts, cnt:=1; (ii) if cnt=i and i-th input 
 ** is ready, the task's function is passed this input and invoked; (iv) the result of the
 ** invocation is emitted to the i-th output. (v) when all inputs are served, the task is finished.
 ** Limitation: currently only single-input single-output functions are handled. 
 ** 
 ** Author: Bartosz Balis (2013)
 */

var wflib = require('../wflib').init(),
    engine = module.parent.exports;

var TaskForeachFSM = {
    name: "TaskForeach",
    logic: TaskLogic,

    state : [ 
        {
	    name: "ready",
            initial: true
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
	    event       : "ReRe",
	    from        : "ready",
	    to          : "ready",
	    onTransition: "trReRe",
	},
        { 
	    event       : "ReRu",
	    from        : "ready",
	    to          : "running",
	    onTransition: "trReRu",
	},
        { 
	    event       : "RuRe",
	    from        : "running",
	    to          : "ready",
	    onTransition: "trRuRe",
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
// on the particular task type semantics. In this case, the Ready-Ready transition is fired. 
// 'obj.msg' is a JSON object which should contain:
// - wfId: workflow instance id
// - taskId: id of task whose input is fired
// - inId: port id of the input being fired
function fireInput(obj) {
    var msg = obj.message;
    this.insReady[msg.inId] = true;
    if (obj.session.getCurrentState().name == "ready") {
        msg.msgId = "ReRe";
        obj.session.dispatch(msg);
    }
}


function TaskLogic() {
    this.tasks = []; // array of all task FSM "sessions" (so that tasks can send events to other tasks)
    this.wfId = -1;  // workflow instance id
    this.id = -1;    // id of this task
    this.n = -1;     // number of inputs
    this.cnt = 1;    // id of the input the task currently waits for
    this.ins = [];   // ids of inputs
    this.insReady = []; // insReady[i] == true means that i-th input is ready
    this.outs = [];  // ids of outputs
    this.sources = []; 
    this.sinks = [];

    this.init = function(tasks, wfId, taskId, ins, outs, sources, sinks) {
	this.tasks = tasks;
	this.wfId = wfId;
	this.id = taskId;
	this.ins = ins;
	this.n = ins.length;
	this.outs = outs;
	this.sources = sources;
	this.sinks = sinks;
        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent: fireInput
        });
    };

    this.ready_onEnter = function(session, state, transition, msg) {
	//console.log(this.id+","+this.cnt+","+this.n);
	if (insReady[this.cnt]) {
	    session.dispatch( {msgId: "ReRu"} );
	}
        console.log("Enter state ready");
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id);
	(function(task) {
	    wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
		if (err) {
		    throw err;
		}

                if (engine.emul()) {
                    setTimeout(function() { 
                        session.dispatch( {msgId: "RuFi"} );
                    }, 100);
                } else {
                    wflib.invokeTaskFunction(task.wfId, task.id, 
                        task.ins[task.cnt-1], task.outs[task.cnt-1], 
                    function(err, rep) {
                        if (err) {
                            throw(err);
                            // TODO: how does the engine handle error in invocation of task's
                            // function? E.g. Does it affect the state machine of the task?
                            // Should there be an error state and transitions from it, e.g. retry? 
                        } else {
                            task.cnt++;
                            if (task.cnt <= task.n) {
                                engine.markDataReady(task.wfId, task.outs[cnt-2], function() {
                                    session.dispatch( { msgId: "RuRe" } );
                                });
                            } else {
                                session.dispatch( { msgId: "RuFi" } );
                            }
                        }
                    });
                }
	    });
	})(this);
    };

    this.running_onExit = function(session, state, transition, msg) {
        //console.log("Exit state running");
    };

    this.finished_onEnter = function(session, state, transition, msg) {
	(function(task) {
	    wflib.setTaskState(task.wfId, task.id, { "status": "finished" }, function(err, rep) {
		if (err) {
		    throw err;
		}
		console.log("Enter state finished: "+task.id);
		engine.taskFinished(task.wfId, task.id);
	    });
	})(this);
    };

    this.trReRe = function(session, state, transition, msg) {

    };

    this.trReRu = function(session, state, transition, msg) {
        //console.log("Transition ReRu, task "+this.id);
    };

    this.trRuRe = function(session, state, transition, msg) {
        //console.log("Transition RuRe, task "+this.id);
    };

    this.trRuFi = function(session, state, transition, msg) {
  
    };

    return this;
}

module.exports = TaskForeachFSM;
