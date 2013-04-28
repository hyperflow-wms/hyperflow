var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine'),
    async = require('async'),
    argv = require('optimist').argv,
    engine;

function init(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
	    wflib.createInstanceFromFile('../workflows/Wf_splitter.json', '', 
                function(err, id) {
                    cb(err, id);
                }
	    );
	});
    });
}


if (!argv._[0]) {
    console.log("Usage: node splitter.test.js <path/to/text/file>");
    process.exit();
}


init(function(err, wfId) {
    if (err) { throw err; }
    engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
            var spec = [{'id': '1', 'value': argv._[0]}];
	    engine.fireSignals(spec);
        });
    });
});
