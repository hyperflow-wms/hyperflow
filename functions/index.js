var fsp = require('./fileSplitter.js'), 
    cmd = require('./command.js'),
    amqpCmd = require('./amqpCommand.js'),
    scanDir = require('./DirScanner').scanDir,
    logger = require('winston').loggers.get('workflow');

function print(ins, outs, config, cb) {
    //logger.info("PRINT %s", JSON.stringify(ins));
        ins.forEach(function(input) {
                //logger.info("sigId= %d:%s", input.sigId input.data[0])
		//logger.debug(JSON.stringify(input, null, 2));
		if (input.data && input.data[0].value) {
                    logger.info(input.data[0].value);
		} else {
                    logger.info(JSON.stringify(input, null, 2));
                }
        });
        cb(null, outs);
}

function print2(ins, outs, config, cb) {
    logger.info("PRINT2");
    ins.forEach(function(input) {
        if (input.data.length == 1) {
            logger.info(input.data[0]);
        } else {
            logger.info(input.data);
        }
    });
    logger.info("CONFIG");
    logger.info(config);
    cb(null, outs);
}

function echo(ins, outs, config, cb) {
    var data = JSON.stringify(ins[0].data);
    //logger.info(data);
    outs[0].data = [ins[0].data];
    //onsole.log("ECHO", JSON.stringify(ins, null, 2));

    //if (typeof data == "object" || typeof data == "array")
     //   data = JSON.stringify(data);

    //process.stdout.write(data[2]);
    //logger.info(data);
    cb(null, outs);
}

function echoWithDelay(ins, outs, config, cb) {
    //logger.info(ins, outs);
    outs[0].data = [ins[0].data];
    setTimeout(function() {
        cb(null, outs);
    }, Math.floor(Math.random()*1000+1));
}

function add(ins, outs, config, cb) {
    var sum=0.0;
    for (var i=0; i<ins.length; ++i) {
        if ("value" in ins[i].data[0]) {
            sum += parseFloat(ins[i].data[0].value);
        }
    }
    outs[0].data = { "value": sum };
    cb(null, outs);
}

function sqr(ins, outs, config, cb) {
    if (!("value" in ins[0].data[0])) {
        outs[0].data = [ new Error("functions:sqr : no input value provided") ];
    } else {
        var v = parseFloat(ins[0].data[0].value);
        outs[0].data[0] = { "value": v * v };
    }
    cb(null, outs);
}

function length(ins, outs, config, cb) {
    if (!("value" in ins[0])) {
        outs[0].value = new Error("functions:sqr : no input value provided");
    } else {
        outs[0].value = ins[0].value.length;
    }
    setTimeout(function() {
        cb(null, outs);
    }, 1000);
}

function match(ins, outs, config, cb) {
    var tmp = ins[0].data[0].value.match(new RegExp('^/(.*?)/(g?i?m?y?)$'));
    var regex = new RegExp(tmp[1], tmp[2]);
    var str = ins[1].data[0].value;
    var s = str.search(regex);
    //logger.debug(regex, str, s);
    if (str.search(regex) != -1) {
        outs[0].condition = "true";
        outs[0].data = [ str ];
    }
    cb(null, outs);
}

function chooseEvenOdd(ins, outs, config, cb) {
    var sum=0;
    //logger.debug("choose INS=", ins);
    for (var i=0; i<ins.length; ++i) {
        if ("data" in ins[i] && "value" in ins[i].data[0]) {
            sum += parseInt(ins[i].data[0].value);
        }
    }
	if (sum % 2 == 0) {
		outs[0].data = [ { "value": sum } ];
		outs[0].condition = "true";
	} else {
		outs[1].data = [ { "value": sum } ];
		outs[1].condition = "true";
	}
    cb(null, outs);
}

function scanDirForJs(ins, outs, config, cb) {
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
function grepFile(ins, outs, config, cb) {
    if (ins[0].path) {
        outs[0].value = ins[0].path;
    } else if (ins[0].value) {
        outs[0].value = ins[0].value;
    } else {
        cb(new Error("grepFile: input file path not provided."));
        return;
    }
    logger.info("grepFile: '"+ ins[1].value+"'", outs[0].value);
    cb(null, outs); 
}


//var cnt = 0;
function count(ins, outs, config, cb) {
    //logger.debug("COUNT  INS:", JSON.stringify(ins));
    //logger.debug(ins.length);
    //logger.debug("COUNT INS:", ins.length);
    /*ins.forEach(function(input) {
     logger.debug(input);
    });*/
    /*logger.debug("COUNT OUTS:", outs.length);
    outs.forEach(function(output) {
     logger.debug(output);
    });*/
 
    outs[0].data = [];
    ins[0].data.forEach(function(cnt) {
        outs[0].data.push(cnt+1);
        if (cnt % 1000 == 0) {
            logger.info("count:", cnt);
        }
        if (cnt == 5000) {
            process.exit();
        }
    });
    cb(null, outs);
}

function exit(ins, outs, config, cb) {
  logger.info("Exiting\n\n");
  process.exit(0);
}

function genCollection(ins, outs, config, cb) {
    var len = ins[0].data[0];
    outs[0].data = [];

    for (var i=0; i<len; i++) {
        //outs[0].data.push(Math.floor(Math.random() * 5) + 1); 
        outs[0].data.push(i+1);
    }

    logger.info("GEN COLLECTION %s", outs[0].data);

    cb(null, outs);
}

function noop(ins, outs, config, cb) {
    cb(null, outs);
}

/*
function montage_mProjectPP(ins, outs, config, cb) {
    var execName = "mProjectPP";
    var execArgs = "-X -x "+config.f.scale+" "+ins[0].name+" "+outs[0].name+" "+ins[1].name;
    // invoke executor(execName, exsecArgs)
}
*/

exports.print = print;
exports.print2 = print2;
exports.add = add;
exports.sqr = sqr;
exports.length = length;
exports.fileSplitter = fsp.fileSplitter;
exports.command = cmd.command;
exports.amqpCommand = amqpCmd.amqpCommand;
exports.exit = exit;
exports.command_print = cmd.command_print;
exports.command_notifyevents = cmd.command_notifyevents;
exports.scanDirForJs = scanDirForJs;
exports.grepFile = grepFile;
exports.chooseEvenOdd = chooseEvenOdd;
exports.echo = echo;
exports.echoWithDelay = echoWithDelay;
exports.count = count;
exports.match = match;
exports.noop = noop;
exports.genCollection = genCollection;
