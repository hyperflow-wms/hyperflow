var cmd = require('./command.js'),
    amqpCmd = require('./amqpCommand.js'),
    RESTCmd = require('./RESTServiceCommand.js'),
    fargateCmd = require('./awsFargateCommand.js'),
    lambdaCmd = require('./awsLambdaCommand.js'),
    commandLocalMock = require('./commandLocalMock.js'),
    redisCommand = require('./redisCommand.js').redisCommand,
    k8sCommand = require('./kubernetes/k8sCommand.js').k8sCommand,
    bojK8sCommand = require('./kubernetes/bojK8sCommand.js').bojK8sCommand;

function print(ins, outs, config, cb) {
    //console.log("PRINT", JSON.stringify(ins));
        ins.forEach(function(input) {
                //console.log("sigId=", input.sigId + ":", input.data[0])
		//console.log(JSON.stringify(input, null, 2));
		if (input.data && input.data[0].value) {
                    console.log(input.data[0].value);
		} else {
                    console.log(JSON.stringify(input, null, 2));
                }
        });
        cb(null, outs);
}

function print2(ins, outs, config, cb) {
    console.log("PRINT2");
    ins.forEach(function(input) {
        if (input.data.length == 1) {
            console.log(input.data[0]);
        } else {
            console.log(input.data);
        }
    });
    console.log("CONFIG");
    console.log(config);
    cb(null, outs);
}

function echo(ins, outs, config, cb) {
    var data = JSON.stringify(ins[0].data);
    //console.log(data);
    outs[0].data = [ins[0].data];
    //onsole.log("ECHO", JSON.stringify(ins, null, 2));

    //if (typeof data == "object" || typeof data == "array")
     //   data = JSON.stringify(data);

    //process.stdout.write(data[2]);
    //console.log(data);
    cb(null, outs);
}

function echoWithDelay(ins, outs, config, cb) {
    //console.log(ins, outs);
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
    //console.log(regex, str, s);
    if (str.search(regex) != -1) {
        outs[0].condition = "true";
        outs[0].data = [ str ];
    }
    cb(null, outs);
}

function chooseEvenOdd(ins, outs, config, cb) {
    var sum=0;
    //console.log("choose INS=", ins);
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


//var cnt = 0;
function count(ins, outs, config, cb) {
    //console.log("COUNT  INS:", JSON.stringify(ins));
    //onsole.log(ins.length);
    //onsole.log("COUNT INS:", ins.length);
    /*ins.forEach(function(input) {
      console.log(input); 
    });*/
    /*console.log("COUNT OUTS:", outs.length);
    outs.forEach(function(output) {
      console.log(output); 
    });*/
 
    outs[0].data = [];
    ins[0].data.forEach(function(cnt) {
        outs[0].data.push(cnt+1);
        if (cnt % 1000 == 0) { 
            console.log("count:", cnt);
        }
        if (cnt == 5000) {
            process.exit();
        }
    });
    cb(null, outs);
}

function exit(ins, outs, config, cb) {
  console.log("Exiting\n\n");
  process.exit(0);
}

function genCollection(ins, outs, config, cb) {
    var len = ins[0].data[0];
    outs[0].data = [];

    for (var i=0; i<len; i++) {
        //outs[0].data.push(Math.floor(Math.random() * 5) + 1); 
        outs[0].data.push(i+1);
    }

    console.log("GEN COLLECTION", outs[0].data);

    cb(null, outs);
}

function noop(ins, outs, config, cb) {
    cb(null, outs);
}


exports.print = print;
exports.print2 = print2;
exports.add = add;
exports.sqr = sqr;
exports.length = length;
exports.command = cmd.command;
exports.amqpCommand = amqpCmd.amqpCommand;
exports.RESTServiceCommand = RESTCmd.RESTServiceCommand;
exports.awsFargateCommand = fargateCmd.awsFargateCommand;
exports.awsLambdaCommand = lambdaCmd.awsLambdaCommand;
exports.exit = exit;
exports.command_print = cmd.command_print;
exports.command_notifyevents = cmd.command_notifyevents;
exports.chooseEvenOdd = chooseEvenOdd;
exports.echo = echo;
exports.echoWithDelay = echoWithDelay;
exports.count = count;
exports.match = match;
exports.noop = noop;
exports.genCollection = genCollection;
exports.commandLocalMock = commandLocalMock.commandLocalMock;
exports.redisCommand = redisCommand;
exports.k8sCommand = k8sCommand;
exports.bojK8sCommand = bojK8sCommand;
