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
            wflib.createInstanceFromFile(argv._[0], '', 
                function(err, id) {
                    cb(err, id);
            });
	});
    });
}


init(function(err, wfId) {
    engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
            wflib.getWfIns(wfId, false, function(err, wfIns) {
                engine.markDataReady(wfIns, function(err) { });
            });
         });
     });
    /*wflib.getTaskInfoFull(1, 1, function(err, task, ins, outs) {
	    console.log(task, ins, outs);
    });*/
});
