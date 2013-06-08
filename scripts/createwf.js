/* Hypermedia workflow
 * Bartosz Balis, 2013
 * createwf: creates workflow state in Redis db from a json file
**/

var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    async = require('async'),
    argv = require('optimist').argv,
    dbId = 0;

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
    console.log();
    console.log("createwf: create workflow instance from a json file\n");
    console.log("Usage: node createwf.js <path/to/wf.json> [--db <dbId>]\n");
    console.log("  --dbId    Redis db number where the wf should be created (default=0)");
    process.exit();
}

if (argv.db) {
    dbId = argv.db;
}

console.log('dbId='+dbId);

init(function(err, wfId) {
    console.log("wfId="+wfId);
});
