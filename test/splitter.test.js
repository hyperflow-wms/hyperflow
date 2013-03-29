
var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine'),
    engine,
    async = require('async');

function register_funs(cb) {
    var multi = rcl.multi();
    rcl.hset("wf:functions:fileSplitter", "module", "functions", function(err, rep) { });
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

/*function setInputs() {
    var asyncTasks = [];
    for (var i=1; i<=4; ++i) {
        asyncTasks.push(function(callback) {
            wflib.setDataState
        }
    }
}*/

init(function(err, wfId) {
    if (err) { throw err; }
    engine = new Engine({"emulate":"false"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
            var dataIds = [1];
            var spec = {'1': {'value':'test.txt'},
                       };
            wflib.setDataState(wfId, spec, function(err, rep) {
                //console.log(spec);
                engine.markDataReady(dataIds, function(err) {
                });
            });
         });
     });
    /*wflib.getTaskInfoFull(1, 1, function(err, task, ins, outs) {
	    console.log(task, ins, outs);
    });*/
});



/*wflib.getWfMap(20, function(err, ins, outs, sources, sinks) {
	console.log(ins[1]);
	console.log(outs[1]);
	console.log(sinks[4]);
	console.log(sources[1]);
	console.log("finished.");
});*/

/*wflib.getTaskMap(27, 1, function(err, ins, outs, sources, sinks) {
    console.log(ins);
    console.log(outs);
    console.log(sources);
    console.log(sinks);
});*/

/*wflib.getDataSinks(21, 4, function(err, rep) {

});*/

/*wflib.getDataInfo(21, 4, function(err, rep) {
	console.log(rep);
});*/
