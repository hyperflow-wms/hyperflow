 /* Hypermedia workflow. 
 ** Implementation of Finite State Machine of a basic task. This task waits for all inputs,
 ** then invokes the task's function and emits all outputs. 
 ** 
 ** Author: Bartosz Balis (2013)
 */

var TaskFSM = {
    name: "task",
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
    msg.msgId = "ReRe";
    obj.session.dispatch(msg);
}


function TaskLogic() {
    this.tasks = []; // array of all task FSM "sessions" (so that tasks can send events to other tasks)
    this.wfId = -1; // workflow instance id
    this.id = -1; // id of this task
    this.n = -1;  // number of inputs
    this.cnt = 0; // number of inputs which are 'ready'
    this.ins = []; // ids of inputs
    this.outs = []; // ids of outputs
    this.sources = []; 
    this.sinks = [];

    this.init = function(engine, wfId, taskId, session) {
        this.engine = engine;
        this.wflib = engine.wflib;
	this.tasks = engine.tasks;
	this.wfId = wfId;
	this.id = taskId;
	this.ins = engine.ins[taskId];
	this.n = engine.ins[taskId].length;
	this.outs = engine.outs[taskId];
	this.sources = engine.sources;
	this.sinks = engine.sinks;
        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent: fireInput
        });
    };

    this.ready_onEnter = function(session, state, transition, msg) {
        console.log("Enter state ready");
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id);
	(function(task) {
	    task.wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
                if (err) { throw err; }
                var emul = task.engine.emulate;
                task.wflib.invokeTaskFunction(task.wfId, task.id, task.ins, task.outs, emul, function(err, outs) {
                    if (err) {
                        throw(err);
                        // TODO: how does the engine handle error in invocation of task's
                        // function? E.g. Does it affect the state machine of the task?
                        // Should there be an error state and transitions from it, e.g. retry? 
                    } else {
                        // mark outputs ready and notify sinks
                        task.engine.fireSignals(outs, function(err) {
                            session.dispatch( {msgId: "RuFi"} );
                        });
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
		if (err) {
		    throw err;
		}
		console.log("Enter state finished: "+task.id);
		task.engine.taskFinished(task.id);
	    });
	})(this);
    };

    this.trReRe = function(session, state, transition, msg) {
	this.cnt++;
	//console.log(this.id+","+this.cnt+","+this.n);
	if (this.cnt == this.n) {
	    //console.log("dispatching ReRu");
	    session.dispatch( {msgId: "ReRu"} );
	}
        //console.log("Transition ReRu, task "+this.id);
    };

    this.trReRu = function(session, state, transition, msg) {
        //console.log("Transition ReRu, task "+this.id);
    };

    this.trRuFi = function(session, state, transition, msg) {
        /*var dataIds = [];
	for (var i=0; i<this.outs.length; ++i) {
            dataIds.push(this.outs[i]);
	    //markDataReadyAndNotifySinks(this.wfId, this.outs[i], this.tasks, function() { });
	}
        this.engine.markDataReady(dataIds, function() {});*/
    };

    return this;
}

module.exports = TaskFSM;
