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
    fsm = require('automata');

var TaskFSM        = require('./taskFSM.js');
var TaskForeachFSM = require('./taskForeachFSM.js');

// TODO: automatically import and register all task FSMs in the current directory
fsm.registerFSM(TaskFSM); 
fsm.registerFSM(TaskForeachFSM);

// Engine constructor
// @config: JSON object which contains Engine configuration:
// - config.emulate (tru/false) = should engine work in the emulated mode?
var Engine = function(config, wflib, wfId, cb) {
    this.wflib = wflib;
    this.wfId = wfId;
    this.tasks = [];      // array of task FSMs
    this.ins = [];
    this.outs = [];
    this.sources = [];
    this.sinks = [];
    this.trace = "";  // trace: list of task ids in the sequence they were finished
    this.nTasksLeft = 0;  // how many tasks left (not finished)? FIXME: what if a task can 
                          // never be finished (e.g. TaskService?)
                          
    this.emulate = config.emulate == "true" ? true: false;       

    (function(engine) {
        engine.wflib.getWfMap(wfId, function(err, nTasks, nData, ins, outs, sources, sinks, types) {
            engine.nTasksLeft = nTasks;
            engine.ins = ins;
            engine.outs = outs;
            engine.sources = sources;
            engine.sinks = sinks;

            // create tasks of types other than default "task"
            for (var type in types) {
                //console.log("type: "+type+", "+types[type]); // DEBUG
                types[type].forEach(function(taskId) {
                    engine.tasks[taskId] = fsm.createSession(type);
                    engine.tasks[taskId].logic.init(engine, wfId, taskId, engine.tasks[taskId]);
                });
            }
            // create all other tasks (assuming the default type "task")
            for (var i=1; i<=nTasks; ++i) {
                // TODO: read taks type from WfMap (getWfMap needs changing)
                if (!engine.tasks[i]) {
                    engine.tasks[i] = fsm.createSession("task");
                    engine.tasks[i].logic.init(engine, wfId, i, engine.tasks[i]);
                }
            }
            cb(null);
        });
    })(this);
}
	
    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

Engine.prototype.runInstance = function (cb) {
    this.wflib.setWfInstanceState( this.wfId, { "status": "running" }, function(err, rep) {
        cb(err);
        //console.log("Finished");
    });

    // Emulate workflow execution: change state of all workflow inputs to "ready" and send
    // signal to all sink tasks; pretend task Functions are invoked and results computed.
    if (this.emulate) {
        (function(engine) {
            engine.wflib.getWfIns(engine.wfId, false, function(err, wfIns) {
                for (var i=0; i<wfIns.length; ++i) {
                    markDataReadyAndNotifySinks(engine.wfId, wfIns[i], engine.tasks, engine.wflib, function() { });
                }
            });
        })(this);
    }
}

// FIXME: check if input is marked more than once (probably in task FSM implementation)
Engine.prototype.markTaskInputReady = function (taskId, dataId, cb) {
    cb(new Error("Not implemented"));
}

// Marks data elements as 'ready' and notify their sinks
// dataIds - single data Id or an array of dataIds
// FIXME: check what happens if data is marked more than once
Engine.prototype.markDataReady = function(dataIds, cb) {
    function isArray(what) {
        return Object.prototype.toString.call(what) === '[object Array]';
    }

    var Ids = [];
    isArray(dataIds) ? Ids = dataIds: Ids.push(dataIds);
    //var start = (new Date()).getTime(), finish;
    (function(engine) {
        Ids.forEach(function(dataId) {
            markDataReadyAndNotifySinks(engine.wfId, dataId, engine.tasks, engine.wflib, function() {
                //finish = (new Date()).getTime();
                //console.log("markDataReady exec time: "+(finish-start));
            });
        });
    })(this);
    cb(null);
}

Engine.prototype.taskFinished = function(taskId) {
    this.trace += taskId;
    this.nTasksLeft--;
    if (!this.nTasksLeft) {
        console.log(this.trace+'. ['+this.wfId+']');
    } else {
        this.trace += ',';
    }
}

/*
// change API to this instead of "markDataReady" ?
// this function would set state and value of data elements
Engine.prototype.outputsReady = function(outs) {
    var spec = {};
    for (var i in outs) {

    }
}
*/

module.exports = Engine;

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

function markDataReadyAndNotifySinks(wfId, dataId, taskFSMs, wflib, cb) {
    var obj = {};
    obj[dataId] = {"status": "ready" };
    wflib.setDataState(wfId, obj, function(err, rep) {
	if (err) { throw(err); }
	wflib.getDataSinks(wfId, dataId, function(err, sinks) {
	    if (err) { throw(err); }
	    for (var j=0; j<sinks.length; j+=2) {
                // send event that an input is ready
                taskFSMs[sinks[j]].fireCustomEvent({
		    wfId: wfId, 
		    taskId: sinks[j], 
		    inId: sinks[j+1] 
		});
		console.log("sending to task "+sinks[j]+", port "+sinks[j+1]);
	    }
	    if (cb) { cb(); } 
	});
    });
}
