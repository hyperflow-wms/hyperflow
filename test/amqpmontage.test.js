var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine'),
    async = require('async'),
    engine;

function init(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
	    wflib.createInstanceFromFile('../workflows/amqpMontage_143.json', '', 
                function(err, id) {
                    cb(err, id);
                }
	    );
	});
    });
}

init(function(err, wfId) {
    engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
//            var spec = [{'id': '1', 'value': argv._[0]}];
//	    	engine.fireSignals(spec);
            wflib.getWfIns(wfId, false, function(err, wfIns) {
                engine.markDataReady(wfIns, function(err) { });
            });

        });
    });
});
