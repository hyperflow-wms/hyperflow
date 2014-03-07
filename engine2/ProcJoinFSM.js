 /* HyperFlow engine.
 ** Author: Bartosz Balis (2014).
 **
 ** Implementation of the 'join' process. This process joins/merges multiple branches
 ** of execution associated with its input signals. Two properties of the 'join' process
 ** determine its behavior:
 ** - Nb (activeBranchesCount): how many branches are active?
 ** - Nj (joinCount): how many branches should we wait for before firing the process?
 ** where
 ** Nj <= Nb <= N (total number of branches / input signals)
 **
 ** The process will:
 ** - fire after 'Nj' signals have arrived
 ** - "reset" after 'Nb' signals have arrived (only then it will be ready for next firing).
 ** 
 ** This process type allows one to implement the following workflow patterns
 ** (see http://www.workflowpatterns.com/patterns/control): 
 ** - Structured discriminator
 ** - Blocking discriminator (?)
 ** - Structured partial join
 ** - Blocking partial join (?)
 ** - Local synchronizing merge
 **
 ** Inputs:
 ** - One or more data signals
 ** - Optional 'merge' control signal (emitted by the 'choice' process, so that 'join' can
 **   merge branches activated by 'choice')
 ** - Optional 'done' and 'next' control signals
 ** Outputs:
 ** - Zero or more data outputs
 ** - Optional 'done' and 'next' control signals
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

    // firingSigsH[0] and paramsH[0] store, respectively, signal ids and Nb/Nj params to be used 
    // in the next firing. firingSigsH[i] / paramsH[i] store the same for the i-th firing from "now". 
    // paramsH is used only when there is a 'merge' control input signal. 
    // The algorithm is quite convoluted; the problem is to compute which signals should be
    // fired and which discarded in each firing. 
    // For example, given Nb=2, Nj=1, and the following order of signals ("1"=branch 1, "2"=branch 2): 
    // [2,2,2,1,1,1,1,2], the process will fire four times as follows (fired/discarded): 
    // - 2/1
    // - 2/1
    // - 2/1
    // - 1/2
    // With 'merge' signal, Nb/Nj additionally changes for each firing.
    this.firingSigsH = [];
    this.paramsH = [];

    this.canReset = false;

    this.init2 = function(session) {
        // when there is a 'merge' input signal, Nb/Nj are actually computed based on the signal data
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

        // prevent computation of Nb0/Nj0 after reset, when there are 
        // no more 'merge' signals waiting (paramsH is empty!).
        if (proc.ctrIns.merge && !proc.paramsH.length)
            return;

        var Nb0 = proc.ctrIns.merge ? proc.paramsH[0].Nb: proc.Nb,
            Nj0 = proc.ctrIns.merge ? proc.paramsH[0].Nj: proc.Nj;

        if (proc.ready) {
            //onsole.log("TRY TRANSITION", proc.firingSigsH);
            if (proc.firingSigsH[0] && proc.firingSigsH[0].length == Nb0) {
                proc.canReset = true;
            }
            if (proc.firingSigsH[0] && proc.firingSigsH[0].length >= Nj0) {
                proc.ready = false;
                proc.firingSigs = [];
                for (var i=0; i<Nj0; ++i) {
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
        var sigs = [];

        proc.canReset = false;
        var reset = function() {
            proc.ready = true;
            proc.firingSigsH.shift();
            if (proc.ctrIns.merge) {
                console.log("RESET Nb="+proc.paramsH[0].Nb+", Nj="+proc.paramsH[0].Nj);
                proc.paramsH.shift();
            }
            cb();
        }

        var Nb0 = proc.ctrIns.merge ? proc.paramsH[0].Nb: proc.Nb,
            Nj0 = proc.ctrIns.merge ? proc.paramsH[0].Nj: proc.Nj;

        if (Nb0 > Nj0) { // remove discarded signals (if any)
            var sigs = proc.firingSigsH[0].slice(Nj0);
            for (var i in sigs) { 
                proc.dataIns[sigs[i]]--;
                sigs[i] = [ sigs[i], 1 ];
            }
        }
        if (proc.ctrIns.merge) { // also remove the 'merge' signal if exists
            sigs.push([proc.ctrIns.merge, 1]);
        }
        if (sigs.length) {
            proc.wflib.fetchInputs(proc.appId, proc.procId, sigs, true, function(arrived, sigValues) {
                if (arrived) {
                    // TODO(?): additional signals ("between" Nj and Nb) are simply discarded;
                    // is this the right semantics? Or should the function be called again,
                    // but without emitting output signals? Or should we allow to define
                    // "function2" (optionally) to be called for the additional signals?
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
	    event       : "RuRe", 
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

    console.log("RECV SIG", sig.name, proc.ctrIns.merge);
    if (sigId == proc.ctrIns.done) { // "done" signal has arrived
        proc.done = true;
    } else if (proc.ctrIns.merge && sigId == proc.ctrIns.merge)  { // there is a 'merge' input port
        //onsole.log("JOIN RECV MERGE");
        proc.paramsH.push({ "Nj": sig.data[0].Nj, "Nb": sig.data[0].Nb});
    } else {
        if (!proc.dataIns[sigId]) {
            proc.dataIns[sigId] = 1;
            proc.cnt++;
        } else {
            proc.dataIns[sigId] += 1;
        }

        var Nb, Nj;

        // algorithm which places a new sig in the appropriate "set" and determines
        // whether the signal will be fired or discarded, and in which firing
        var qsigs = function(idx) {
            //console.log("QSIG", idx, proc.firingSigsH);
            Nb = proc.ctrIns.merge ? proc.paramsH[idx].Nb: proc.Nb;
            Nj = proc.ctrIns.merge ? proc.paramsH[idx].Nj: proc.Nj;
            if (proc.firingSigsH[idx]) {
                if ((proc.firingSigsH[idx].length >= Nb) || 
                    (proc.firingSigsH[idx].indexOf(sigId) != -1))  {
                    return qsigs(idx+1);
                }
                proc.firingSigsH[idx].push(sigId);
            } else {
                proc.firingSigsH[idx] = [ sigId ];
            }
        }
        var idx = proc.dataIns[sigId]-1;
        qsigs(idx);

        var Nb0 = proc.ctrIns.merge ? proc.paramsH[0].Nb: proc.Nb;
        if (proc.firingSigsH[0] && proc.firingSigsH[0].length == Nb0) {
            proc.canReset = true;
        }

        proc.tryTransition();
    }
}

module.exports = ProcJoinFSM;
