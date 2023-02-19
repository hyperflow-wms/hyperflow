#!/usr/bin/env node

const redisURL = process.env.REDIS_URL;

var fs = require('fs'),
    pathtool = require('path'),
    redis = require('redis'),
    rcl = redisURL ? redis.createClient({url: redisURL}): redis.createClient();

rcl.on('error', err => console.log('Redis Client Error', err));
async function wait_for_redis() {
    await rcl.connect();
    //wflib = await require('../wflib').init(rcl);
}
wait_for_redis();

var wflib = require('../wflib').init(rcl),
    Engine = require('../engine2'),
    async = require('async'),
    readVars = require('../utils/readvars.js'),
    glob = require('glob');

function load_plugin(plugins, plugin_name) {
    try {
        var Plugin = require(plugin_name);
        plugins.push(new Plugin());
    } catch (err) {
        console.log("Plugin module:", plugin_name, "not found!");
        console.log(err);
        process.exit(1);
    }
}

function append_file(filename, contents, cb) {
    fs.appendFile(filename, contents, function (err) {
        if (err) {
            console.log("Error appending to file! " + err);
            cb(err);
        }
        cb();
    });
}

function handle_writes(entries, cb) {
    var data = {};
    var writes = [];

    entries.forEach(function (entry) {
        var filename = entry["filename"];
        var contents = entry["args"];

        if (filename in data) {
            data[filename] += contents + '\n';
        } else {
            data[filename] = contents + '\n';
        }
    });

    for (var filename in data) {
        if (data.hasOwnProperty(filename)) {
            writes.push(function (cb) {
                    append_file(filename, data[filename], cb);
                }
            );
        }
    }

    async.parallel(writes, function (err) {
        if (err) {
            cb(err);
            return;
        }
        cb();
    });
}


/*
** Function hflowStartServer: start HyperFlow server
** TODO: support external IP address and configurable port number
** 
*/
function hflowStartServer() {
    var server = require('../server/hyperflow-server.js')(rcl, wflib);
    let hostname = '127.0.0.1', port = process.env.PORT;
    server.listen(port, hostname, () => { 
        console.log("HyperFlow server started at: http://%s:%d", server.address().address, server.address().port);
    });
}


/*
** Function hflowRun: run a workflow
** 
** Parameters are passed as 'opts' -- docopt JSON object from 'hflow' command:
**  '<workflow_dir_or_file>': (string/null) -- path to 'workflow'json' or directory that contains it
**  '--log-provenance': (true/false) -- if true, provenance will be logged
**  '--persist': (true/false) -- if true, workflow state will be persisted
**  '--provenance-output': (string/null) -- path to file where provenance should be saved (defaults to 'provenance_log.txt')
**  '--var': (array of strings) -- some {{vars}} can be passed using this array
**  '-p': (true/false) -- if true, load plugin modules
**  '-s': (true/false) -- if true, initial signals to all workflow inputs will be sent (obsolete)
**  recover: (true/false) -- if true, this is a recovery mode (workflow is replayed from a recovery file)
**  '<persistence-log>': (string/null) -- name/path to the recovery file (must be set if 'recover' is true)
**  '<plugin_module_name>': (array of strings) -- array of plugin modules to be loaded
**
** Returns runCb(engine, wfId, wfName):
** - engine: Engine object that represents the execution of the worklfow
** - wfId: unique workflow identifier
** - wfName: workflow name (from workflow.json)
*/   
function hflowRun(opts, runCb) {
    var dbId = 0, 
        plugins = [],
        recoveryMode = false, 
        recoveryData, 
        wfDirFull; // logged in the persistence journal

    var wfVars = readVars([], opts['--var']);

    // for writing writes provenance logs etc.
    var cargo = async.cargo(handle_writes, 5000);

    if (opts['-p']) {
        opts['<plugin_module_name>'].forEach((plugin_name) => load_plugin(plugins, plugin_name));
    }

    if (opts.recover) {
        [ recoveryData, opts ] = readRecoveryData(opts['<persistence-log>']);
        console.log(recoveryData, opts);
        recoveryMode = true;
    }

    // Find path to 'workflow.json'. If this is recovery, full wf dir path was already read from the journal
    var wfpath = recoveryMode ? recoveryData.wfDirFull: opts['<workflow_dir_or_file>'], 
        wfstats = fs.lstatSync(wfpath),
        wffile;

    if (wfstats.isDirectory()) {
        wffile = pathtool.join(wfpath, "workflow.json");
    } else if (wfstats.isFile()) {
        wffile = wfpath;
        wfpath = pathtool.dirname(wfpath);
    }

    wfDirFull = pathtool.resolve(wfpath);

    // Read workflow configuration files if exist
    // all files matching pattern `workflow.config[.name].json` will be matched
    // all config will be passed to workflow functions via `context.appConfig[.name]`
    var wfConfig = {};
    // 1. Look for main config file -- workflow.config.json
    var wfConfigFilePath = pathtool.join(wfDirFull, "workflow.config.json");
    if (fs.existsSync(wfConfigFilePath)) {
        try {
            let rawdata = fs.readFileSync(wfConfigFilePath);
            wfConfig = JSON.parse(rawdata);
        } catch(e) {
            console.log("Error reading/parsing workflow config file:", e);
        }
    }
    // 2. Look for secondary config files -- workflow.config.{name}.json
    let globOpts = {"cwd": wfDirFull, "absolute": true};
    var configFiles = glob.sync("workflow.config.*.json", globOpts);
    configFiles.forEach(function(file) {
        try {
            let rawdata = fs.readFileSync(file);
            let secondaryConfig = JSON.parse(rawdata);
            let match = file.match(/workflow\.config\.(.*).json/);
            let name = match[1];
            wfConfig[name] = secondaryConfig;
        } catch (e) {
            console.log("Error reading/parsing workflow config file ", file, e);
        }
    });

    var runWf = function(wfId, wfName, wfJson, cb) {
        var config = wfConfig;
        config["emulate"] = "false";
        config["workdir"] = wfDirFull;
        
        if (recoveryMode) {
            config.recoveryData = recoveryData;
            config.recovery = true;
        }

        //console.log(JSON.stringify(recoveryData, null, 2));
        //process.exit(1);

        var engine = new Engine(config, wflib, wfId, async function(err) {
            // This represent custom plugin listening on event from available eventServer
            // engine.eventServer.on('trace.*', function(exec, args) {
            //   console.log('Event captured: ' + exec + ' ' + args + ' job done');
            // });

            await Promise.all(
                plugins.map(function(plugin) {
                    let config = {};
                    if (plugin.pgType == "scheduler") {
                        config.wfJson = wfJson;
                        config.wfId = wfId;
                    }
                    return plugin.init(rcl, wflib, engine, config);
                }
            ));

            engine.syncCb = function () {
                process.exit();
            }

            if (opts['--log-provenance']) {
                engine.logProvenance = true;
                var provenance_output = opts['--provenance-output'] || 'provenance_log.txt';
                if (!pathtool.isAbsolute(provenance_output)) {
                    provenance_output = pathtool.join(process.cwd(), provenance_output);
                }
                engine.eventServer.on('prov', function() {
                    cargo.push( { "filename": provenance_output, "args": JSON.stringify(arguments)}, function(err) {
                        if (err) {
                            console.log("cargo errror! " + err);
                        }
                    });
                });
            }

            if (opts['--persist']) { // enable persistence of workflow execution state
                // TODO: implement a plugin for different persistence backends
                // FIXME: generate unique persist-log file name
                var date = new Date().toISOString().replace(new RegExp('[T:.]', 'g'), '-').replace('Z', '');
                var logFileName = (wfName ? wfName: 'wf').concat('.' + date + ".log");
                console.log("Persistence log:", logFileName);
                var persistlog=pathtool.join(wfDirFull, logFileName);
                engine.eventServer.on('persist', function() {
                    cargo.push( { "filename": persistlog, "args": JSON.stringify(arguments) }, function(err) {
                        if (err) {
                            console.log("cargo errror! " + err);
                        }
                    });
                });
            }

            // we persist the full workflow directory path and execution options used to run the workflow
            engine.eventServer.emit('persist', ["info", wfDirFull, JSON.stringify(opts)]);

            engine.runInstance(function(err) {
                console.log("Wf id="+wfId);
                if (opts['-s']) {
                    // Flag -s is present: send all input signals to the workflow -> start execution
                    wflib.getWfIns(wfId, false, function(err, wfIns) {
                        engine.wflib.getSignalInfo(wfId, wfIns, function(err, sigs) {
                            engine.emitSignals(sigs);
                        });
                    });
                }
                cb(engine);
            });
        });
    }

    var createWf = async function(cb) {
        let x = await rcl.select(dbId);
        //await rcl.FLUSDHB();  // flushing db here deletes the global 'hfid' entry (created earlier)
        wflib.createInstanceFromFile(wffile, '', { vars: wfVars }, function (err, id, wfJson) {
            cb(err, id, wfJson.name, wfJson);
        });
    }

    var startWf = function() {
        createWf(function (err, wfId, wfName, wfJson) {
            runWf(wfId, wfName, wfJson, function(engine) {
                if (runCb) {
                    runCb(null, engine, wfId, wfName);
                }
            });
        });
    }

    startWf();
}

function readRecoveryData(recoveryFile) {
    var recoveryData = { 'input': [], 'outputs': {}, 'settings': {} };
    var persistLog = fs.readFileSync(recoveryFile, 'utf8').toString().trim().split('\n');
    var opts;

    persistLog.forEach((entry, index) => persistLog[index] = JSON.parse(entry));
    persistLog.forEach(function(plogentry) {
        let entry = plogentry['1'];
        let settings = plogentry['2'];
        if (entry[0] == 'info') { // full wf dir path and command line options
            recoveryData.wfDirFull = entry[1]; 
            opts = JSON.parse(entry[2]); // we recover command line options used to run the workflow
            opts.s = false; // option 's' shold never be true when recovering (to be removed altogether)
        } else if (entry[0] == 'input') {
            var sigData = entry[2];
            delete sigData.sigIdx;
            recoveryData['input'].push(sigData);
        } else if (entry[0] == 'fired') {
            var procId = entry[2], 
            firingId = entry[3], 
            outs = entry[4],
            key = procId + '_' + firingId;
            recoveryData.outputs[key] = outs;
            if (settings) { // additional annotations, flags, e.g. 'forceRecompute'
                recoveryData.settings[key] = settings;
            }
        }
    });

    return  [ recoveryData, opts ];
}

function hflowSend() {
    console.log("send signal to a workflow: not implemented");
}

exports.hflowRun = hflowRun;
exports.hflowStartServer = hflowStartServer;