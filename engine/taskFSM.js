var wflib = require('../wflib').init(),
    engine = module.parent.exports;

var TaskFSM = {
    name: "Task",
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

    this.init = function(tasks, wfId, taskId, ins, outs, sources, sinks) {
	this.tasks = tasks;
	this.wfId = wfId;
	this.id = taskId;
	this.ins = ins;
	this.n = ins.length;
	this.outs = outs;
	this.sources = sources;
	this.sinks = sinks;
    };

    this.ready_onEnter = function(session, state, transition, msg) {
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
                    wflib.invokeTaskFunction(task.wfId, task.id, task.ins, task.outs, function(err, rep) {
                        if (err) {
                            throw(err);
                            // TODO: how does the engine handle error in invocation of task's
                            // function? E.g. Does it affect the state machine of the task?
                            // Should there be an error state and transitions from it, e.g. retry? 
                        } else {
                            session.dispatch( {msgId: "RuFi"} );
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
        var dataIds = [];
	for (var i=0; i<this.outs.length; ++i) {
            dataIds.push(this.outs[i]);
	    //markDataReadyAndNotifySinks(this.wfId, this.outs[i], this.tasks, function() { });
	}
        engine.markDataReady(this.wfId, dataIds, function() {});
    };

    return this;
}

module.exports = TaskFSM;
