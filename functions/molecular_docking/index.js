var spawn = require('child_process').spawn;
var logger = require('winston').loggers.get('workflow');

function md_preprocess(ins, outs, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    var dir_uuid = createUUID();  // create a new UUID before invoking preprocessing program
    args += " --dir " + dir_uuid; // add dir uuid as another parameter to program arguments

    logger.info("Executing: %s %s", exec, args);

    var proc = spawn(exec, [ args ]);

    proc.stdout.on('data', function(data) {
        logger.info("%s stdout: %s", exec, data);
    });

    proc.stderr.on('data', function(data) {
        logger.info("%s stderr: %s", exec, data);
    });

    proc.on('exit', function(code) {
        logger.info("%s exiting with code: %s", exec, code);
	outs[1].data = [ { "dir_uuid": dir_uuid } ] // emit uuid as a signal
        cb(null, outs);
    });

    proc.on('close', function (code, signal) {
        logger.info("%s terminated due to receipt of signal %s", exec, signal);
    });
}

function md_run(ins, outs, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    var dir_uuid = ins[1].data[0].dir_uuid; // read the uuid passed from preprocessing
    args += " --dir " + dir_uuid; // add dir uuid as another parameter to program arguments

    logger.info("Executing: %s %s", exec, args);

    var proc = spawn(exec, [ args ]);

    proc.stdout.on('data', function(data) {
        logger.info("%s stdout: %s", exec, data);
    });

    proc.stderr.on('data', function(data) {
        logger.info("%s stderr: %s", exec, data);
    });

    proc.on('exit', function(code) {
        logger.info("%s exiting with code: %s", exec, code);
        cb(null, outs);
    });

    proc.on('close', function (code, signal) {
        logger.info("%s terminated due to receipt of signal %s", exec, signal);
    });
}

function md_postprocess(ins, outs, config, cb) {
    var exec = config.executor.executable,
        args = config.executor.args;

    var dir_uuid = ins[1].data[0].dir_uuid; // read the uuid passed from preprocessing
    args += " --dir " + dir_uuid; // add dir uuid as another parameter to program arguments

    logger.info("Executing: %s %s", exec, args);

    var proc = spawn(exec, [ args ]);

    proc.stdout.on('data', function(data) {
        logger.info("%s stdout: %s", exec, data);
    });

    proc.stderr.on('data', function(data) {
        logger.info("%s stderr: %s", exec, data);
    });

    proc.on('exit', function(code) {
        logger.info("%s exiting with code: %s", exec, code);
        cb(null, outs);
    });

    proc.on('close', function (code, signal) {
        logger.info("%s terminated due to receipt of signal %s", exec, signal);
    });
}


// copied from http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
function createUUID() {
    // http://www.ietf.org/rfc/rfc4122.txt
    var s = new Array(36);
    var hexDigits = "0123456789abcdef";
    for (var i = 0; i < 36; i++) {
        s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
    }
    s[14] = "4";  // bits 12-15 of the time_hi_and_version field to 0010
    s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);  // bits 6-7 of the clock_seq_hi_and_reserved to 01
    s[8] = s[13] = s[18] = s[23] = "-";

    var uuid = s.join("");
    return uuid;
}

exports.md_preprocess = md_preprocess;
exports.md_run = md_run;
exports.md_postprocess = md_postprocess;
