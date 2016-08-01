/* HyperFlow engine.
 ** Author: Bartosz Balis (2013-2014)
 **
 ** Implementation of a 'choice' process. This process waits for all data inputs, invokes the process's function, 
 ** and emits **any subset** of data outputs, enabling conditional execution patterns.
 **
 ** Inputs:
 ** - a number of data ports x1 .. xn
 ** Outputs:
 ** - a number of data ports y1 .. ym
 ** Function:
 ** - The function determines which of the m outputs should be emitted. To this end, the function 
 **   should insert a pair << "condition": "true" >> into the json objects of appropriate output 
 **   data elements.
 ** 
 */

var async = require('async'),
    ProcLogic = require('./process.js').ProcLogic,
    fireInput = require('./process.js').fireInput,
    extend = require('./process.js').extend;


var ChoiceLogic = function() {
    ProcLogic.call(this);

    this.init2 = function() {
        // set firing sigs
        for (var i in this.ins) {
            var sigId = this.ins[i];
            if (!(sigId in this.ctrIns)) {
                this.firingSigs[sigId] = 1;
            }
        }
        // "next" signal (if present) is also required for firing (even the first one)
        if ("next" in this.ctrIns) {
            this.firingSigs.push[this.ctrIns.next] = 1;
        }
    }


    this.ready_enter = function(session, state, transition, msg) {
        var proc = session.logic;
        proc.ready = true;
        proc.tryTransition(proc, session);

        //onsole.log("Enter state ready: "+proc.procId);
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

    // overrides postInvoke in order to emit only signals with "condition" flag. 
    this.postInvoke = function(outs, asyncInvocation, funcIns, funcOuts, firingId, firingSigs, cb) {
        var proc = this;
        //proc.cnt -= proc.firingSigs.length; // subtract cnt by the number of consumed signals
        //if (proc.fullInfo.sticky) 
         //   proc.cnt += proc.fullInfo.sticky; // sticky signals weren't actually consumed!

        var outValues = [];
        for (var i=0; i<funcOuts.length; ++i) {
            if (outs[i].condition == "true") {
                // attribute 'condition' is only relevant for making the decision on which signals 
                // to emit. it's safe (and cleaner) to remove it before passing the signal on
                delete outs[i].condition; 
                outs[i]["_id"] = +funcOuts[i];
                outs[i]["source"] = +proc.procId;
                outs[i]["firingId"] = +firingId;
                outValues.push(outs[i]);
            }
        }
        // if there exists "merge" output, emit the 'merge' control signal first. 
        // see 'join' process for explanation
        if (proc.ctrOuts.merge) {
            var Nj = outValues.length, Nb = Nj; 
            proc.engine.emitSignals([{"_id": proc.ctrOuts.merge, "data": [{"Nb": Nb, "Nj": Nj}]}],
                    function(err) { });
            //onsole.log("CHOICE EMIT MERGE", proc.ctrOuts.merge);
        }
        if (proc.ctrOuts.next) { // emit "next" signal if there is such an output port
            outValues.push({"_id": proc.ctrOuts.next });
        }
        if (outValues.length > 0) {
            proc.engine.emitSignals(outValues, function(err) {
                proc.runningCount -= 1;
                //onsole.log("runningCount (" + proc.fullInfo.name + ")/2:", proc.runningCount);
                err ? cb(err): cb(null);
            });
        } else {
            cb(null);
        }
    }

    return this;
}

extend(ChoiceLogic, ProcLogic);

var ProcChoiceFSM = {
    name: "choice",
    logic: ChoiceLogic,

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

module.exports = ProcChoiceFSM;
