/* Hypermedia workflow
 * Bartosz Balis, 2013
 * runwf: 
 *   - creates a Hyperflow engine instance for workflow identified by Redis id
 *   - runs this workflow: at this point the engine is awaiting signals (unless -s flag is given)
**/

var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine'),
    async = require('async'),
    argv = require('optimist').argv,
    dbId = 0, 
    engine;

function createWf(cb) {
    rcl.select(dbId, function(err, rep) {
	rcl.flushdb(function(err, rep) {
            wflib.createInstanceFromFile(argv.f, '', 
                function(err, id) {
                    cb(err, id); 
		}
	    );
	});
    });
}


if (!argv.id && !argv.f) {
    console.log("runwf: runs a workflow instance\n");
    console.log("Usage: node runwf.js [--f </path/to/wf.json>] [-i WFID] [--db=DBID]");
    console.log("   -f <file> : create a new wf instance from a file and run it");
    console.log("   -i WFID   : use already created wf instance with WFID as its Redis id");
    console.log("   -s        : send input signals to the workflow (starts execution)");
    console.log("   -d DBID   : Redis db number to be used (default=0)");
    process.exit();
}

if (argv.d) {
    dbId = argv.db;
}

var runWf = function(wfId) { 
    engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
            console.log("Wf id="+wfId);
            if (argv.s) {
                // Flag -s is present: send all input signals to the workflow -> start execution
                wflib.getWfIns(wfId, false, function(err, wfIns) {
                    engine.wflib.getSignalInfo(wfId, wfIns, function(err, sigs) { 
                        engine.emitSignals(sigs);
                        console.log(sigs);
                    });
                });
            }
        });
    });
};

if (argv.f) {
    createWf(function(err, wfId) {
        runWf(wfId);
    });
} else if (argv.i) {
    runWf(argv.i);
}
    
