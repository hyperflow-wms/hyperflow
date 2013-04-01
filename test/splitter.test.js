var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine'),
    async = require('async'),
    engine;

function register_funs(cb) {
    var multi = rcl.multi();
    multi.hset("wf:functions:fileSplitter", "module", "functions", function(err, rep) { });
    multi.hset("wf:functions:length", "module", "functions", function(err, rep) { });
    multi.exec(function(err, reps) {
        cb(err);
    });
}

function init(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
            register_funs(function(err) {
                wflib.createInstanceFromFile('../workflows/Wf_splitter.json', '', 
                function(err, id) {
                    cb(err, id);
                });
            });
	});
    });
}

init(function(err, wfId) {
    if (err) { throw err; }
    engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
            var spec = [{'id': '1', 'value': 'test.txt'}];
	    engine.fireSignals(spec);
         });
     });
});
