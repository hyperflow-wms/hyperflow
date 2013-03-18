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

var tasks = [],    // array of task FSMs
    trace = "",    // trace: list of task ids in the sequence they were finished
    nTasksLeft = 0,  // how many tasks left (not finished)? 
                   // FIXME: what if a task can never be finished (e.g. TaskService?)
    emulate;       // should the execution be emulated?

var TaskFSM        = require('./taskFSM.js');
var TaskForeachFSM = require('./taskForeachFSM.js');

// TODO: automatically import and register all task FSMs in the current directory
fsm.registerFSM(TaskFSM); 
fsm.registerFSM(TaskForeachFSM);

	
    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

var Engine = function(config) {
};

    // emul: if true, workflow execution will be emulated
function public_runInstance(wfId, emul, cb) {
    emulate = emul;
    wflib.getWfMap(wfId, function(err, nTasks, nData, ins, outs, sources, sinks) {
        nTasksLeft = nTasks;
        for (var i=1; i<=nTasks; ++i) {
            tasks[i] = fsm.createSession("Task");
            tasks[i].logic.init(tasks, wfId, i, ins[i], outs[i], sources, sinks, tasks[i]);
        }

        wflib.setWfInstanceState( wfId, { "status": "running" }, function(err, rep) {
            cb(err);
            //console.log("Finished");
        });

        // Emulate workflow execution: change state of all workflow inputs to "ready" and send
        // signal to all sink tasks; pretend task Functions are invoked and results computed.
        if (emulate) {
            wflib.getWfIns(wfId, false, function(err, wfIns) {
                for (var i=0; i<wfIns.length; ++i) {
                    markDataReadyAndNotifySinks(wfId, wfIns[i], tasks, function() { });
                }
            });
        }
    });
}

// FIXME: check if input is marked more than once (probably in task FSM implementation)
function public_markTaskInputReady(wfId, taskId, dataId, cb) {
    cb(new Error("Not implemented"));
}

// Marks data elements as 'ready' and notify their sinks
// dataIds - single data Id or an array of dataIds
// FIXME: check what happens if data is marked more than once
function public_markDataReady(wfId, dataIds, cb) {
    function isArray(what) {
        return Object.prototype.toString.call(what) === '[object Array]';
    }

    var Ids = [];
    isArray(dataIds) ? Ids = dataIds: Ids.push(dataIds);
    //var start = (new Date()).getTime(), finish;
    Ids.forEach(function(dataId) {
        markDataReadyAndNotifySinks(wfId, dataId, tasks, function() {
            //finish = (new Date()).getTime();
            //console.log("markDataReady exec time: "+(finish-start));
        });
    });
    cb(null);
}

function taskFinished(wfId, taskId) {
    trace += taskId;
    nTasksLeft--;
    if (!nTasksLeft) {
        console.log(trace+'.');
    } else {
        trace += ',';
    }
}

exports.runInstance = public_runInstance;
exports.markTaskInputReady = public_markTaskInputReady;
exports.markDataReady = public_markDataReady;
exports.taskFinished = taskFinished;
exports.nTasksLeft = nTasksLeft;
exports.trace = trace;
exports.taskFSMs = tasks;
exports.emul = function() { return emulate; };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

function markDataReadyAndNotifySinks(wfId, dataId, taskFSMs, cb) {
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
