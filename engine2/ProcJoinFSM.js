 /* HyperFlow engine.
 ** Author: Bartosz Balis (2014).
 **
 ** Implementation of the 'join' process. This process joins/merges multiple branches
 ** of execution associated with its input signals. Two properties of the 'join' process
 ** determine its behavior:
 ** - Nb (activeBranchesCount): how many branches are active?
 ** - Nj (joinCount): how many branches should we wait for before firing the process?
 **
 ** The process will:
 ** - fire after 'Nj' signals have arrived
 ** - "reset" after 'Nb' signals have arrived (only then it will be ready for next firing).
 ** 
 ** This process type allows to implement the following workflow patterns
 ** (see http://www.workflowpatterns.com/patterns/control): 
 ** - Structured discriminator
 ** - Blocking discriminator (?)
 ** - Structured partial join
 ** - Blocking partial join (?)
 ** - Local synchronizing merge
 **
 ** Inputs:
 ** - ...
 ** Outputs:
 ** - ...
 ** Function:
 ** - The function is passed only Nj signals (ones that arrived first). Consequently, 
 **   the signals should be recognized by name, not by index, as it is not known which 
 **   Nj (out of Nb) signals actually caused the firing.
 **
 */

var async = require('async'),
    ProcLogic = require('./process.js').ProcLogic,
    fireInput = require('./process.js').fireInput,
    extend = require('./process.js').extend;

function JoinLogic() {
    ProcLogic.call(this);

    this.firingSigsH = [];
    this.canReset = false;

    this.init2 = function(session) {
        // Nj: how many branches must arrive before firing? 
        this.Nj = this.fullInfo.joinCount ? this.fullInfo.joinCount: this.nDataIns;

        // Nb: how many branches must arrive before resetting the process? 
        this.Nb = this.fullInfo.activeBranchesCount ? this.fullInfo.activeBranchesCount: this.nDataIns;

        this.ready = true;

        session.sessionListener[0].customEvent = fireInputJoin;
    }

    this.ready_enter = function(session, state, transition, msg) {
        var proc = session.logic;
        //proc.ready = true;

        if (proc.canReset) {
            proc.resetProc(function() {
                proc.tryTransition();
            });
        }
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
        //onsole.log("Exit state running: "+this.id+" ("+this.name+")");
    };

    this.finished_enter = function(session, state, transition, msg) {
        var proc = this;
        proc.wflib.setTaskState(proc.appId, proc.procId, { "status": "finished" }, function(err, rep) {
            if (err) { throw err; }
            //onsole.log("Enter state finished: "+proc.procId);
            proc.engine.taskFinished(proc.procId);
        });
    };

    this.ReFitransition = function(session, state, transition, msg) {
      // emit "done" signal if such a port exists
      if (session.logic.ctrOuts.done) {
          session.logic.engine.emitSignals([{"_id": session.logic.ctrOuts.done }]);
      }
    };

    this.ReRutransition = function(session, state, transition, msg) { };
    this.RuRetransition = function(session, state, transition, msg) { };

    this.tryTransition = function() {
        var proc = this;
        if (proc.ready && proc.done) {
            proc.ready = false;
            proc.makeTransition("ReFi");
            return;
        } 

        if (proc.ready) {
            //onsole.log("TRY TRANSITION", proc.firingSigsH);
            if (proc.firingSigsH[0] && proc.firingSigsH[0].length == proc.Nb) {
                proc.canReset = true;
            }
            if (proc.firingSigsH[0] && proc.firingSigsH[0].length >= proc.Nj) {
                proc.ready = false;
                proc.firingSigs = [];
                for (var i=0; i<proc.Nj; ++i) {
                    var sigId = proc.firingSigsH[0][i]; 
                    proc.firingSigs.push([sigId, 1]);
                }
                //onsole.log("FIRE!", proc.firingSigs, "ready="+proc.ready, "Nj="+proc.Nj, "Nb="+proc.Nb);
                proc.fetchInputs(proc, function(arrived, sigValues) {
                    if (arrived) {
                        proc.makeTransition("ReRu");
                    } else {
                        proc.ready = true;
                    }
                });
            }
        } 
    }

    this.resetProc = function(cb) {
        var proc = this;
        proc.canReset = false;
        var reset = function() {
            proc.ready = true;
            proc.firingSigsH.shift();
            cb();
        }
        if (proc.Nb > proc.Nj) {
            var sigs = proc.firingSigsH[0].slice(proc.Nj);
            for (var i in sigs) {
                proc.dataIns[sigs[i]]--;
                sigs[i] = [ sigs[i], 1 ];
            }
            proc.wflib.fetchInputs(proc.appId, proc.procId, sigs, true, function(arrived, sigValues) {
                if (arrived) {
                } else {
                    console.error("Join: should not happen!"); // FIXME: throw error
                }
                reset();
            });
        } else {
            reset();
        }
    }

    return this;
}

extend(JoinLogic, ProcLogic);

var ProcJoinFSM = {
    name: "join",
    logic: JoinLogic,

    state : [ 
        {   name: "init",
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
	    event       : "ReRu", // when 'Nj' ins have arrived
	    from        : "ready",
	    to          : "running"
	}, { 
	    event       : "RuRe", // after firing, when 'Nj' == 'Nb'
	    from        : "running",
	    to          : "ready"
	}, { 
	    event       : "ReFi", // when 'done' signal has arrived
	    from        : "ready",
	    to          : "finished"
	}
    ]
};

// This function is invoked on arrival of an input signal.
// 'obj.message' is a JSON object which should contain:
// - wfId: workflow instance id
// - sigId: signal id
// - sig: the actual signal
// - ...
function fireInputJoin(obj) {
    var msg = obj.message, 
        proc = obj.session.logic,
        state = obj.session.getCurrentState().name,
        sigId = msg.sigId,
        sig = msg.sig;

    if (sigId == proc.ctrIns.done) { // "done" signal has arrived
        proc.done = true;
    } else {
        if (!proc.dataIns[sigId]) {
            proc.dataIns[sigId] = 1;
            proc.cnt++;
        } else {
            proc.dataIns[sigId] += 1;
        }
        var qsigs = function(idx) {
            if (proc.firingSigsH[idx]) {
                if ((proc.firingSigsH[idx].length >= proc.Nb) || 
                    (proc.firingSigsH[idx].indexOf(sigId) != -1))  {
                    return qsigs(idx+1);
                }
                proc.firingSigsH[idx].push(sigId);
            } else {
                proc.firingSigsH[idx] = [ sigId ];
            }
     
        }
        var idx = Math.floor(proc.dataIns[sigId]-1 / proc.Nj);
        qsigs(idx);

        if (proc.firingSigsH[0] && proc.firingSigsH[0].length == proc.Nb) {
            proc.canReset = true;
        }

        proc.tryTransition();
    }
}

module.exports = ProcJoinFSM;
