function writeRandOuts(ins, outs, config, cb) {
    var count=0;
    ["file1", "file2", "file3"].forEach(function(out) {
        if (Math.random()<=0.5) {
            outs[out].data = [ out + " trigerred" ];
            outs[out].condition = "true";
            count += 1;
        }
    });
    console.log("Activated", count, "files");
    cb(null, outs);
}

function readRandIns(ins, outs, config, cb) {
    ins.forEach(function(i) {
        console.log(i.data[0]);    
    });
    console.log();
    cb(null, outs);
}

exports.writeRandOuts = writeRandOuts;
exports.readRandIns = readRandIns;
