 /* Hypermedia workflow. 
 ** Author: Bartosz Balis (2013)
 **
 ** Common functions used by processes
 ** 
 */

var async = require('async'),
    log4js = require('log4js');

// This function is invoked on arrival of an input signal.
// 'obj.message' is a JSON object which should contain:
// - wfId: workflow instance id
// - sigId: signal id
// - sig: the actual signal
// - ...
function fireInput(obj) {
    var msg = obj.message, 
        proc = obj.session.logic,
        state = obj.session.getCurrentState().name,
        sigId = msg.sigId,
        sig = msg.sig;

    //onsole.log("FIRE INPUT Proc", proc.procId);

    if (sigId == proc.ctrIns.done) { // "done" signal has arrived
        proc.done = true;
    } else {
        if (!proc.dataIns[sigId]) {
            proc.dataIns[sigId] = 1;
            proc.cnt++;
        } else {
            proc.dataIns[sigId] += 1;
        }

        //onsole.log("CNT Proc", proc.procId, proc.cnt, proc.dataIns);
        if (proc.cnt >= proc.firingSigs.length) { // not accurate if signal counts > 1 in the firing pattern
            proc.tryTransition();
        }
    }
}

var ProcLogic = function() {
    this.procs = []; // array of all process FSM "sessions" (so processes can send events to other processes)
    this.appId = -1; // workflow instance id
    this.procId = -1; // id of this process
    this.cnt = 0; // how many inputs have at least one signal on the queue
    this.dataIns = []; // dataIns[sigId] = count of instances of signal 'sigId' awaiting on the queue
    this.nDataIns = -1; // how many data inputs are there?
    this.next = false; // has the "next" control sig arrived?
    this.done = false; // has the "done" control sig arrived? 
    this.ctrIns = {};  // control inputs (map sig name -> sigId)
    this.ctrOuts = {}; // control outputs (map sig name -> sigId)
    this.ins = []; // ids of inputs (data and control signals)
    this.outs = []; // ids of outputs (data and control signals)
    this.sources = []; 
    this.sinks = [];
    this.firingInterval = -1; // a process can have 0 data inputs and a firing interval ==> its 
                              // function will be invoked regularly according to this interval
    this.firingSigs = [];    // sigs required to fire the process
    this.firingLimit = -1;   // max number of times the process can fire (-1 = unlimited)
    this.sigValues = null;
    this.firingId = 0;       // which firing of the process is this?
    this.runningCount = 0;   // how many firings are currently running in parallel (max = parlevel)?

    this.ready = false; // is the proc ready to read input signals?

    this.init = function(engine, appId, procId, session, fullInfo) {
        this.engine = engine;
        this.wflib = engine.wflib;
	this.procs = engine.tasks;
	this.appId = appId;
	this.procId = procId;
	this.ins = engine.ins[procId];
	this.outs = engine.outs[procId];
	this.sources = engine.sources;
	this.sinks = engine.sinks;
        this.nDataIns = engine.ins[procId].length;
        this.firstInvocation = true;
        this.fullInfo = fullInfo;
	this.name = fullInfo.name;
	this.parlevel = fullInfo.parlevel ? fullInfo.parlevel : 1; // maximum level of parallelism
        this.session = session;

	this.firingLimit = this.fullInfo.firingLimit ? this.fullInfo.firingLimit : -1;

	if (this.procId in engine.cPorts) {
            var procCPorts = engine.cPorts[this.procId];
            if ("ins" in procCPorts) {
                for (var i in procCPorts.ins) {
                    // this should be correct: #(data_ins) = #(all_ins) - #(control_ins)
                    // (not an efficient way to compute but there should be max ~2 control ins)
                    this.nDataIns--;
                }
                this.ctrIns = procCPorts.ins;
            }
            if ("outs" in procCPorts) {
                this.ctrOuts = procCPorts.outs;
            }
            //onsole.log("Cports: "+this.ctrIns.next, this.ctrIns.next, this.ctrOuts.next, this.ctrOuts.next); // DEBUG
	}

        if (this.nDataIns == 0) { // special case with no data inputs (a 'source' pocess)
            // FIXME: add assertion/validation that firing interval is defined!
            // TODO:  change semantics of firingInterval to *minimal* firing interval regardless of # of inputs
            this.firingInterval = this.fullInfo.firingInterval;
	}

        session.addListener({
            contextCreated      : function( obj ) {    },
            contextDestroyed    : function( obj ) {    },
            finalStateReached   : function( obj ) {    },
            stateChanged        : function( obj ) {    },
            customEvent         : fireInput
        });

        // process-specific initialization
        if (this.init2) {
            this.init2(session);
        }
    }

    this.tryTransition = function() {
        var proc = this;
        if (proc.ready && proc.done) {
            proc.ready = false;
            proc.makeTransition("ReFi");
        }

        if (proc.nDataIns == 0 && proc.ready) { 
            // a "source" process: to be fired regularly according to a firing interval
            proc.ready = false;
            if (proc.firstInvocation) {
                proc.firstInvocation = false;
                proc.makeTransition("ReRu");
            } else {
                setTimeout(function() {
                    proc.makeTransition("ReRu");
                }, proc.firingInterval);
            }
        } else if (proc.ready) {
            proc.ready = false;
            proc.fetchInputs(proc, function(arrived, sigValues) {
                if (arrived) {
                    proc.makeTransition("ReRu");
                } else {
                    proc.ready = true;
                }
            });
        }
    }

    this.fetchInputs = function(proc, cb) {
        var sigs = proc.firingSigs;
        proc.wflib.fetchInputs(proc.appId, proc.procId, sigs, true, function(arrived, sigValues) {
            if (arrived) {
                //onsole.log("FETCHED", sigs, proc.procId);
                if (sigs[sigs.length-1][0] == proc.ctrIns.next) {
                    sigValues.pop(); // remove 'next' signal (should not be passed to the function)
                }
                proc.sigValues = sigValues; // set input signal values to be passed to the function
            } else {
                proc.ready = true;
            }
            cb(arrived, sigValues);
        });
    }

    this.preInvoke = function(cb) {
        var proc = this;
        proc.runningCount += 1;
        if (proc.firingLimit != -1) {
            proc.firingLimit -= 1;
            if (proc.firingLimit == 0) {
                proc.done = true;
            }
        }
        //onsole.log("runningCount (" + proc.fullInfo.name + "):", proc.runningCount);
        proc.wflib.setTaskState(proc.appId, proc.procId, { "status": "running" }, function(err, rep) {
            err ? cb(err): cb(null); 
        });
    }

    this.invokeFunction = function(cb) {
        var proc = this, emul = proc.engine.emulate;
        var asyncInvocation = false;
        var funcIns = [], funcOuts = [];

        //onsole.log(proc);
        // create arrays of data ins and outs ids
        for (var i=0; i<proc.firingSigs.length; ++i) {
            var sigId = proc.firingSigs[i][0];
            if (!(sigId in proc.fullInfo.cinset)) { 
                funcIns.push(proc.sigId);
            }
        }
        for (var i=0; i<proc.outs.length; ++i) {
            outId = proc.outs[i];
            if (!(outId in proc.fullInfo.coutset)) { 
                funcOuts.push(outId);
            }
        }

        //logger.debug(funcIns, funcOuts);
        
        var isSticky = function(sigId) { 
            return proc.fullInfo.sticky && (sigId in proc.fullInfo.stickySigs);
        }
        // update - 'cnt': number of inputs with signals waiting
        //        - 'dataIns': signal counts on input queues
        proc.cnt = 0;
        for (var i=0; i<proc.firingSigs.length; ++i) {
            var sigId = proc.firingSigs[i][0],
                sigCount = proc.firingSigs[i][1];
            if (!isSticky(sigId)) {
                proc.dataIns[sigId] -= sigCount;
            }
            if (proc.dataIns[sigId]) {
                proc.cnt++;
            }
        }
        //onsole.log("RESET CNT Proc", proc.procId, proc.cnt, proc.dataIns);

        if (!proc.done && (proc.runningCount < proc.parlevel || proc.parlevel == 0)) {
            asyncInvocation = true;
            // we return to the ready state BEFORE invoking the function, i.e. the firing
            // is ASYCHRONOUS; as a result, another firing can happen in parallel
            proc.makeTransition("RuRe");
        }

        /*proc.cnt -= proc.firingSigs.length; // subtract cnt by the number of consumed signals
        if (proc.fullInfo.sticky) 
            proc.cnt += proc.fullInfo.sticky; // sticky signals weren't actually consumed!
            */

        proc.wflib.invokeTaskFunction2(
                proc.appId,
                proc.procId,
                funcIns,
                proc.sigValues,
                funcOuts, emul,
                proc.engine.eventServer,
                function(err, outs) {
                    err ? cb(err): cb(null, outs, asyncInvocation, funcIns, funcOuts);
                }
        );
    }

    this.postInvoke = function(outs, asyncInvocation, funcIns, funcOuts, firingId, firingSigs, cb) {
        var proc = this;

        var outValues = outs;
        for (var i=0; i<funcOuts.length; ++i) {
            outValues[i]["_id"] = funcOuts[i];
            outValues[i]["source"] = proc.procId;
            outValues[i]["firingId"] = firingId;
        }
        if (proc.ctrOuts.next) { // emit "next" signal if there is such an output port
            outValues.push({"_id": proc.ctrOuts.next });
        }

        proc.engine.emitSignals(outValues, function(err) {
            proc.runningCount -= 1;
            //onsole.log("runningCount (" + proc.fullInfo.name + ")/2:", proc.runningCount);
            err ? cb(err): cb(null);
        });
    }

    this.postInvokeTransition = function(asyncInvocation, cb) {
        if (!asyncInvocation) {
            this.makeTransition("RuRe"); // proc goes back to ready state
        }
        cb(null);
    }

    return this;
}

ProcLogic.prototype.makeTransition = function(tr) {
    this.session.dispatch( { msgId: tr } );
}


function extend(subc, superc) {
    var subcp = subc.prototype;
    var method;

    // Class pattern.
    var F = function() {
    };
    F.prototype = superc.prototype;

    subc.prototype = new F();       // chain prototypes.
    subc.superclass = superc.prototype;
    subc.prototype.constructor = subc;

    // Reset constructor. See Object Oriented Javascript for an in-depth explanation of this.
    if (superc.prototype.constructor === Object.prototype.constructor) {
        superc.prototype.constructor = superc;
    }

    for ( method in subcp ) {
        if (subcp.hasOwnProperty(method)) {
            subc.prototype[method] = subcp[method];
        }
    }
}

exports.ProcLogic = ProcLogic;
exports.fireInput = fireInput;
exports.extend = extend;
