var fsm = require('automata');

var nFSMs = 100000,
    trace = "",
    start = (new Date()).getTime(), 
    finish;

var TestFSM = {
    name: "test",
    logic: TestLogic,

    state : [ 
        {
	    name: "ready",
            onEnter: "ready_onEnter",
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


function TestLogic() {
    this.ready_onEnter = function(session, state, transition, msg) {
	    session.dispatch( {msgId: "ReRu"} );
    };

    this.running_onEnter = function(session, state, transition, msg) {
	    session.dispatch( {msgId: "RuFi"} );
    
    };

    this.running_onExit = function(session, state, transition, msg) {
        //console.log("Exit state running");
    };

    this.finished_onEnter = function(session, state, transition, msg) {
        trace += session.logic.id;
        --nFSMs;
        if (!nFSMs) {
            //console.log(trace+'.');
            finish = (new Date()).getTime(); 
            console.log("time="+(finish-start)+'ms');
        } else {
            trace += ',';
        }
    };

    this.trReRe = function(session, state, transition, msg) {

    };

    this.trReRu = function(session, state, transition, msg) {
    };

    this.trRuFi = function(session, state, transition, msg) {

    };

    return this;
}

fsm.registerFSM(TestFSM); 

var fsms = [];

for (var i=0; i<nFSMs; ++i) {
    fsms[i] = fsm.createSession("test");
    fsms[i].logic.id = i+1;
    //fsms[i].dispatch({ msgId: "ReRe"});
}

