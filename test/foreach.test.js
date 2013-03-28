
var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine');

function init(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
            rcl.hset("wf:functions:add", "module", "functions", function(err, rep) {
                wflib.createInstanceFromFile('../workflows/Wf_foreach_test.json', '', function(err, id) {
                    cb(err, id);
                });
	    });
	});
    });
}

function init2(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
	    wflib.createInstanceFromFile('../workflows/Wf_func_test.json', '', function(err, id1) {
		    wflib.createInstanceFromFile('../workflows/Montage_143.json', '', function(err, id2) {
		cb(err, id1, id2);
		});
	    });
	});
    });
}

init(function(err, wfId) {
    var engine = new Engine({"emulate": "true"}, wflib, wfId, function(err) {
        engine.runInstance(function(err) {
        });
    });       

        /*wflib.getTaskInfoFull(1, 1, function(err, task, ins, outs) {
          console.log(task, ins, outs);
          });*/
});

//engine.markDataReady(1, 1, function() { });
//engine.markDataReady(1, [1,2], function() { });


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
