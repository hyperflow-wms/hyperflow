var redis = require('redis'),
    rcl = redis.createClient(),
    wflib = require('../wflib').init(rcl),
    engine = require('../engine');

function init(cb) {
    rcl.select(1, function(err, rep) {
	rcl.flushdb(function(err, rep) {
	    wflib.createInstanceFromFile('Montage_143.json', '', function(err, id) {
		cb(err, id);
	    });
	});
    });
}

init(function(err, id) {
    engine.runInstance(id, true, function(err) {
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
