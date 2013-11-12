 /* Hypermedia workflow. 
 ** Author: Bartosz Balis (2013)
 **
 ** Implementation of Finite State Machine of a basic 'dataflow' task. This task waits for all
 ** data inputs, invokes the task's function, and emits all data outputs.
 **
 ** Inputs:
 ** - ...
 ** Outputs:
 ** - ...
 ** Function:
 ** - ... 
 ** 
 ** TODO:
 ** - Implement 'firing rules' to specify how many data elements ('tokens') need to arrive on
 **   a given input port (currently always 1 data element is waited for any consumed for each port)
 */

var async = require('async'),
    log4js = require('log4js');

    //log4js.configure('log4js.json');

    //var logger = log4js.getLogger('hf-default-logger');

var TaskDataflowFSM = {
    name: "dataflow",
    logic: TaskLogic,

    state : [ 
        {   name: "init",
            initial: "true",
            onEnter: function (session) { session.dispatch({msgId: "InitRe"}); }
        },
        {
	    name: "ready", 
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
	    event       : "InitRe",
	    from        : "init",
	    to          : "ready",
	    onTransition: function() { }
	},
        { 
	    event       : "ReRu", // when all data ins and 'next' (if such port exists) have arrived
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
//var fi_sync = false;
function fireInput(obj) {
    var msg = obj.message, 
        task = obj.session.logic,
        state = obj.session.getCurrentState().name,
        //sigId = task.ins[msg.inId-1];
        sigId = msg.sigId;

    //if (fi_sync) { logger.debug("HOPSASA"); process.exit(); return process.nextTick(fireInput(obj)); }
    //fi_sync = true;

    if (sigId == task.nextInId) { // "next" signal has arrived
        task.next = true;
        if (task.ready && task.cnt == task.nDataIns) {
            task.next = false; task.cnt = 0;
            task.ready = false;
            obj.session.dispatch({ msgId: "ReRu" });
        }
    } else if (sigId == task.doneInId) { // "done" signal has arrived
        task.done = true;
        if (task.ready) {
            task.ready = false;
            obj.session.dispatch({ msgId: "ReFi" });
        }
    } else { // something arrived at a data port
        if (!(task.dataIns[sigId])) {
            task.dataIns[sigId] = true;
            task.cnt++;
            //logger.debug("task", task.id, "cnt="+task.cnt, ", nDataIns="+task.nDataIns);
        }
        if (task.ready && task.cnt == task.nDataIns && (!task.nextInId || task.next == true)) {
            task.next = false; task.cnt = 0;
            task.ready = false;
            obj.session.dispatch({msgId: "ReRu"});
        }
    }

    //fi_sync = false;
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

    this.ready = false;

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

        if (this.nDataIns == 0) { // special case with no data inputs (a 'source' task)
            // FIXME: add assertion/validation that firing interval is defined!
            this.firingInterval = fullInfo.firingInterval;
	}

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
            //logger.debug("Cports: "+this.nextInId, this.doneInId, this.nextOutId, this.doneOutId); // DEBUG
	}
        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent         : fireInput
        });
    };

    this.ready_onEnter = function(session, state, transition, msg) {
        var task = session.logic;
        task.ready = true;
        if (task.done) {
            task.ready = false;
            session.dispatch({ msgId: "ReFi"});
        } else if ((!task.nextInId || task.next) && task.cnt == task.nDataIns) {
            task.next = false;
            if (task.nDataIns == 0) { // a "source" task: to be fired regurarly according to a firing interval
                task.ready = false;
                setTimeout(function() {
                    session.dispatch( {msgId: "ReRu"} );
                }, task.firingInterval);
            } else {
                task.ready = false;
                session.dispatch( {msgId: "ReRu"} );
            }
        }
        console.log("Enter state ready: "+task.id);
    };

    this.running_onEnter = function(session, state, transition, msg) {
        console.log("Enter state running: "+this.id);
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

                    //logger.debug(funcIns, funcOuts);
                    task.wflib.invokeTaskFunction1(task.wfId, task.id, funcIns, funcOuts, emul, function(err, outs) {
                        err ? cb(err): cb(null, outs);
                    });
                },
                // 2a. pop next signal (if such port exists) 
                // FIXME: temporary; need a clean way to pop all input signals in one place
                function(outs, cb) {
                    if (task.nextInId) {
                        task.wflib.popInput(task.wfId, task.id, task.nextInId, function(err, inValue) {
                            cb(null, outs);
                        });
                    } else {
                        cb(null, outs);
                    }
                },
                // 3. emit output signals
                function(outs, cb) {
                    task.dataIns = []; task.cnt = 0; // back to waiting for all data ins
                    var outValues = outs;
                    for (var i=0; i<funcOuts.length; ++i) {
                        outValues[i]["_id"] = funcOuts[i];
                    }
                    if (task.nextOutId) { // emit next signal if there is such an output port
                        outValues.push({"_id": session.logic.nextOutId });
                    }
                    task.engine.emitSignals(outValues, function(err) {
                        session.dispatch( {msgId: "RuRe"} ); // task goes back to ready state
                        err ? cb(err): cb(null);
                    });
                }
        ]);
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
      // emit "done" signal if such a port exists
      if (session.logic.doneOutId) {
            session.logic.engine.emitSignals([{"id": session.logic.doneOutId }]);
      }
    };

    this.trRuRe = function(session, state, transition, msg) {
  
    };

    return this;
}

module.exports = TaskDataflowFSM;
