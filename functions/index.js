var fsp = require('./fileSplitter.js'), 
    cmd = require('./command.js'),
    scanDir = require('./DirScanner').scanDir;

function add(ins, outs, executor, config, cb) {
    var sum=0.0;
    for (var i=0; i<ins.length; ++i) {
        if ("value" in ins[i]) {
            sum += parseFloat(ins[i].value);
        }
    }
    outs[0].value = sum;
    cb(null, outs);
}

function sqr(ins, outs, executor, config, cb) {
    if (!("value" in ins[0])) {
        outs[0].value = new Error("functions:sqr : no input value provided");
    } else {
        var v = parseFloat(ins[0].value);
        outs[0].value =  v * v;
    }
    cb(null, outs);
}

function length(ins, outs, executor, config, cb) {
    if (!("value" in ins[0])) {
        outs[0].value = new Error("functions:sqr : no input value provided");
    } else {
        outs[0].value = ins[0].value.length;
    }
    cb(null, outs);
}


function scanDirForJs(ins, outs, executor, config, cb) {
    var inPath = ins[0].value, outPath;
    if (outs[0].path) {
        outPath = outs[0].path;
    } else {
        outPath = inPath + "/" + "matchingFilesOut.txt";
        outs[0].path = outPath;
        //outs[0].value = outPath;
    }
    scanDir(inPath, /.*js$/, outPath, function(err, result) {
        err ? cb(err): cb(null, outs);
    });
}

// TODO. (Currently only returns the input file path)
function grepFile(ins, outs, executor, config, cb) {
    if (ins[0].path) {
        outs[0].value = ins[0].path;
    } else if (ins[0].value) {
        outs[0].value = ins[0].value;
    } else {
        cb(new Error("grepFile: input file path not provided."));
        return;
    }
    console.log("grepFile: '"+ ins[1].value+"'", outs[0].value);
    cb(null, outs); 
}

/*
function montage_mProjectPP(ins, outs, executor, config, cb) {
    var execName = "mProjectPP";
    var execArgs = "-X -x "+config.f.scale+" "+ins[0].name+" "+outs[0].name+" "+ins[1].name;
    // invoke executor(execName, exsecArgs)
}
*/

exports.add = add;
exports.sqr = sqr;
exports.length = length;
exports.fileSplitter = fsp.fileSplitter;
exports.command = cmd.command;
exports.scanDirForJs = scanDirForJs;
exports.grepFile = grepFile;
