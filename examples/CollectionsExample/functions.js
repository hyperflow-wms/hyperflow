//var cnt = 0;
function genCollection(ins, outs, config, cb) {
    var files = [];
    ["file1", "file2", "file3"].forEach(function(out) {
        if (Math.random()<=0.5) {
            files.push(out);
        }
    });
    console.log("Producing collection:", files);
    outs.file.data = files;
    cb(null, outs);
}

function procElement(ins, outs, config, cb) {
    console.log("Processing", ins.file.data[0], "...");
    var fileout = ins.file.data[0] + ".OUT";
    outs.fileout.data = [ fileout ];
    cb(null, outs);
}

function consumeCollection(ins, outs, config, cb) {
    console.log("Consuming collection:", ins[0].data);
    cb(null, outs);
}


exports.genCollection = genCollection;
exports.procElement = procElement;
exports.consumeCollection = consumeCollection;
