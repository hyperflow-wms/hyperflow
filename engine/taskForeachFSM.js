 /* Hypermedia workflow. 
 ** Implementation of Finite State Machine of a 'foreach' task. This task processes its inputs
 ** one by one, sequentially. Algorithm: (i) when task starts, cnt:=1; (ii) if cnt=i and i-th input 
 ** is ready, the task's function is passed this input and invoked; (iv) the result of the
 ** invocation is emitted to the i-th output. (v) when all inputs are served, the task is finished.
 ** Limitation: currently only single-input single-output functions are handled. 
 ** 
 ** Author: Bartosz Balis (2013)
 */

var TaskForeachFSM = {
    name: "foreach",
    logic: TaskLogic,

    state : [ 
        {
	    name: "ready",
            onEnter: "ready_onEnter",
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


function TaskLogic() {
    this.tasks = []; // array of all task FSM "sessions" (so that tasks can send events to other tasks)
    this.wfId = -1; // workflow instance id
    this.id = -1; // id of this task
    this.n = -1;  // number of inputs
    this.cnt = 1; // id of input the task is currently waiting for
    this.ins = []; // ids of inputs
    this.insReady = []; // insReady[i] == true means that i-th input is ready
    this.outs = []; // ids of outputs
    this.sources = []; 
    this.sinks = [];

    // This function is invoked when one of task's inputs becomes ready. What happens next depends 
    // on the particular task type semantics. In this case, the Ready-Ready transition is fired. 
    // 'obj.msg' is a JSON object which should contain:
    // - wfId: workflow instance id
    // - taskId: id of task whose input is fired
    // - inId: port id of the input being fired
    this.fireInput = function(obj) {
        var msg = obj.message;
        obj.session.logic.insReady[msg.inId] = true;
        if (obj.session.getCurrentState().name == "ready") {
            console.log('Firing ReRe from state: '+obj.session.getCurrentState().name, msg);
            msg.msgId = "ReRe";
            obj.session.processMessage(msg);
        }
    };


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
            stateChanged        : function( obj ) { 
                console.log("state changed: "+obj.session.getCurrentState().name);
            },
            customEvent: this.fireInput
        });
    };

    this.ready_onEnter = function(session, state, transition, msg) {
        console.log("Enter state ready");
	if (this.insReady[this.cnt]) {
	    session.processMessage( {msgId: "ReRu"} );
	}
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id+session.getCurrentState().name);
	(function(task) {
	    task.wflib.setTaskState(task.wfId, task.id, { "status": "running" }, function(err, rep) {
		if (err) {
		    throw err;
		}

                if (!task.engine.emulate) {
                    setTimeout(function() { 
                        task.cnt++;
                        if (task.cnt <= task.n) {
                            task.engine.markDataReady(task.outs[task.cnt-2], function() {
                                session.processMessage( { msgId: "RuRe" } );
                            });
                        } else {
                            session.processMessage( { msgId: "RuFi" } );
                        }
                    }, 100);
                } else {
                    var ins = task.ins[task.cnt-1], outs = task.outs[task.cnt-1]; 
                    console.log(task.ins[task.cnt-1], task.outs[task.cnt-1]);  // DEBUG
                    console.log("ins="+ins, "outs="+outs, "cnt="+task.cnt); // DEBUG
                    task.wflib.invokeTaskFunction(task.wfId, task.id, ins, outs, function(err, rep) {
                        if (err) {
                            throw(err);
                            // TODO: how does the engine handle error in invocation of task's
                            // function? E.g. Does it affect the state machine of the task?
                            // Should there be an error state and transitions from it, e.g. retry? 
                        } else {
                            console.log("invoke reply="+JSON.stringify(rep)); // DEBUG
                            task.outs[task.cnt-1] = rep[0];
                            task.cnt++;
                            if (task.cnt <= task.n) {
                                task.engine.markDataReady(task.outs[task.cnt-2], function() {
                                    session.processMessage( { msgId: "RuRe" } );
                                });
                            } else {
                                session.processMessage( { msgId: "RuFi" } );
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

    this.trRuRe = function(session, state, transition, msg) {
        //console.log("Transition RuRe, task "+this.id);
    };

    this.trRuFi = function(session, state, transition, msg) {
  
    };

    return this;
}

module.exports = TaskForeachFSM;
