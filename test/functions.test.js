var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    engine = require('../engine'),
    async = require('async');

function init(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
            rcl.hset("wf:functions:add", "module", "functions", function(err, rep) {
                wflib.createInstanceFromFile('Wf_func_test.json', '', function(err, id) {
                    cb(err, id);
                });
            })
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

init(function(err, id) {
    engine.runInstance(id, false, function(err) {
	    var dataIds = [1,2,3,4];
	    var spec = {'1': {'value':'1'},'2': {'value':'2'},'3': {'value':'3'},'4': {'value':'4'}};
	    wflib.setDataState(id, spec, function(err, rep) {
                    //console.log(spec);
                    engine.markDataReady(id, dataIds, function(err) {
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
