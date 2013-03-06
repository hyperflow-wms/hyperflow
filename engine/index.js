/* Hypermedia workflow. 
 ** Hypermedia workflow execution engine based on Actor-FSM execution model
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
    fsm = require('automata'),
    wflib = require('../wflib').init();

var trace = "", numTasks = 0;

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
	this.n = ins.length-1;
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
		setTimeout(function() { 
		    session.dispatch( {msgId: "RuFi"} );
		}, 10000);
	    });
	})(this);
    };

    this.running_onExit = function(session, state, transition, msg) {
	trace += this.id+",";
	//console.log(trace);
        //console.log("Exit state running");
    };

    this.finished_onEnter = function(session, state, transition, msg) {
	(function(task) {
	    wflib.setTaskState(task.wfId, task.id, { "status": "finished" }, function(err, rep) {
		if (err) {
		    throw err;
		}
		console.log("Enter state finished: "+task.id);
		numTasks--;
		if (!numTasks) {
		    console.log(trace);
		}
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
	for (var i=1; i<=this.outs.length-1; ++i) {
	    (function(task,i) {
		wflib.setDataState(task.wfId, task.outs[i], { "status": "ready" }, function(err, rep) {
		    if (err) {
			throw err;
		    }
		    for (var j=1,x=task.sinks[task.outs[i]]; j<=x.length-1; j += 2) {
			task.tasks[x[j]].dispatch({ msgId: "ReRe", wfId: task.wfId, taskId: x[j], inId: x[j+1] } );
			console.log("sending to task "+x[j]+", port "+x[j+1]);
		    }
		});
	    })(this,i);
	}
    };

    return this;
}


fsm.registerFSM( {
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
});

	
exports.init = function() {

    //////////////////////////////////////////////////////////////////////////
    /////////////////////////////// data /////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////



    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function public_runInstance(wfId, emulate, cb) {
	wflib.getWfMap(wfId, function(err, nTasks, nData, ins, outs, sources, sinks) {
	    numTasks = nTasks;
	    var tasks = [];
	    for (var i=1; i<=nTasks; ++i) {
		tasks[i] = fsm.createSession("Task");
		tasks[i].logic.init(tasks, wfId, i, ins[i], outs[i], sources, sinks);
	        //task[i].addListener({
		    // custom event sent to a task FSM
		    // e.inId - id of input port the event was directed to
		    // e.value - optional value of the event (event-specific json obj)
		//});
	    }

	    // TEST: simulate workflow execution: send signal to all tasks' inputs
	    // which are not produced by any other tasks (sources = [])
	    if (emulate) {
		for (var i=1; i<=nTasks; ++i) {
		    for (var j=1; j<=ins[i].length-1; ++j) {
			//console.log(sources[ins[i][j]].length);
			if (sources[ins[i][j]].length == 1) {
			    (function(i,j) {
				wflib.setDataState(wfId, ins[i][j], { "status": "ready" }, function(err, rep) {
				    if (err) {
					throw err;
				    }
				    //if (i<10) { console.log("i="+i+",j="+j+",sources="+sources[ins[i][j]]); }
				    console.log("i="+i);
				    tasks[i].dispatch( { msgId: "ReRe", wfId: wfId, taskId: i, inId: j } );
				});
			    })(i,j);
			}
		    }
		}
	    }
	    wflib.setWfInstanceState( wfId, { "status": "running" }, function(err, rep) {
		cb(err);
		console.log("Finished");
	    });
	});
    }

    return {
        runInstance: public_runInstance,
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////
};

