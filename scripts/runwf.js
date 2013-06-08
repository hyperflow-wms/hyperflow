/* Hypermedia workflow
 * Bartosz Balis, 2013
 * runwf: 
 *   - creates a Hyperflow engine instance for workflow identified by Redis id
 *   - runs this workflow: at this point the engine is awaiting signals
**/

var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine'),
    async = require('async'),
    argv = require('optimist').argv,
    dbId = 0, 
    wfId,
    engine;

function init(cb) {
    rcl.select(dbId, function(err, rep) {
	rcl.flushdb(function(err, rep) {
            wflib.createInstanceFromFile(argv._[0], '', 
                function(err, id) {
                    cb(err, id); 
		}
	    );
	});
    });
}


if (!argv._[0]) {
    console.log("runwf: runs a workflow instance\n");
    console.log("Usage: node runwf.js WFID [--db=DBID]");
    console.log("  WFID: Redis db id of the workflow instance");
    console.log("  --db: Redis db number where the wf state is stored (default=0)");
    process.exit();
}

wfId = argv._[0];

if (argv.db) {
    dbId = argv.db;
}

console.log('wfId='+wfId, 'dbId='+dbId);

engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
    engine.runInstance(function(err) {
         console.log("Wf id="+wfId);

	 // when the below is uncommented, all input signals will be sent to 
	 // the workflow (without setting any attributes (e.g. 'value'), 
	 // which may cause an error, depending on the workflow)
	 /*wflib.getWfIns(wfId, false, function(err, wfIns) {
             engine.markDataReady(wfIns, function(err) { });
         });*/

    });
});
