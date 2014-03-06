 /* HyperFlow engine.
 ** Author: Bartosz Balis (2013-2014)
 **
 ** Implementation of a basic 'dataflow' process. This process waits for all input signals, 
 ** invokes the process's function, and emits all data output signals.
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
 **   a given input port 
 */

var async = require('async'),
    log4js = require('log4js'),
    ProcLogic = require('./process.js').ProcLogic,
    fireInput = require('./process.js').fireInput,
    extend = require('./process.js').extend;

    //log4js.configure('log4js.json');

    //var logger = log4js.getLogger('hf-default-logger');


var DataflowLogic = function() {
    ProcLogic.call(this);

    this.init2 = function() {
        // set firing sigs
        for (var i in this.ins) {
            var sigId = this.ins[i];
            if (!this.fullInfo.cinset[sigId]) {
                this.firingSigs.push([sigId, 1]);
            }
        }
        if ("next" in this.ctrIns) {
            this.firingSigs.push([this.ctrIns.next,1]);
        }
    }


    this.ready_enter = function(session, state, transition, msg) {
        var proc = session.logic;
        proc.ready = true;
        proc.tryTransition(proc, session);

        //onsole.log("Enter state ready: "+task.procId);
    };

    this.running_enter = function(session, state, transition, msg) {
        //onsole.log("Enter state running: "+this.procId+" ("+this.name+")");
        var proc = this;
        var funcIns = [], funcOuts = [], emul = proc.engine.emulate;

        proc.firingId += 1;

        var firingId = proc.firingId,
            firingSigs = proc.firingSigs,
            sigValues = proc.sigValues,
            asyncInvocation;

        async.waterfall([
                // 1. pre-invoke: check firing limits, set proc state to running, etc.
                function(cb) {
                    proc.preInvoke(cb);
                },
                // 2. invoke the function
                function(cb) {
                    proc.invokeFunction(cb);
                },
                // 3. post-invoke: emit output signals
                function(outs, wasAsync, funcIns, funcOuts, cb) {
                    asyncInvocation = wasAsync;
                    proc.postInvoke(outs, asyncInvocation, funcIns, funcOuts, firingId, firingSigs, cb);
                },
                // 4. make state transition from the running state
                function(cb) {
                    proc.postInvokeTransition(asyncInvocation, cb);
                }
        ]);
    };

    this.running_exit = function(session, state, transition, msg) {
        //onsole.log("Exit state running: "+this.procId+" ("+this.name+")");
    };

    this.finished_enter = function(session, state, transition, msg) {
        var proc = this;
        proc.wflib.setTaskState(proc.appId, proc.procId, { "status": "finished" }, function(err, rep) {
            if (err) { throw err; }
            //onsole.log("Enter state finished: "+proc.procId);
            proc.engine.taskFinished(proc.procId);
        });
    };

    this.ReRutransition = function(session, state, transition, msg) {
        //onsole.log("Transition ReRu, task "+this.procId);
    };

    this.ReFitransition = function(session, state, transition, msg) {
      // emit "done" signal if such a port exists
      if (this.ctrOuts.done) {
          session.logic.engine.emitSignals([{ "_id": session.ctrOuts.done }]);
      }
    };

    this.RuRetransition = function(session, state, transition, msg) { };

    return this;
}

extend(DataflowLogic, ProcLogic);

var ProcDataflowFSM = {
    name: "dataflow",
    logic: DataflowLogic,

    state : [ 
        {   
            name: "init",
            initial: "true",
            onEnter: function (session) { session.dispatch({msgId: "InitRe"}); }
        }, {
	    name: "ready", 
	}, { 
	    name: "running", 
	}, {
	    name: "finished", 
	}
    ],

    transition : [ 
        { 
	    event       : "InitRe",
	    from        : "init",
	    to          : "ready",
	    onTransition: function() { }
	}, { 
	    event       : "ReRu", // when all data ins and 'next' (if such port exists) have arrived
	    from        : "ready",
	    to          : "running",
	}, { 
	    event       : "ReFi", // when 'done' signal has arrived
	    from        : "ready",
	    to          : "finished",
	}, { 
	    event       : "RuRe", // after firing
	    from        : "running",
	    to          : "ready",
	}
    ]
};

module.exports = ProcDataflowFSM;
