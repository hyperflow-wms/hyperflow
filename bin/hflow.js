#!/usr/bin/env node

var redisURL = process.env.REDIS_URL ? {url: process.env.REDIS_URL} : undefined

var docopt = require('docopt').docopt;

var doc = "\
Usage:\n\
    hflow run <workflow_dir_or_file> [-s] [--submit=<hyperflow_server_url] [--persist] [--with-server] [--log-provenance] [--provenance-output=<provenance_file>] [-p <plugin_module_name> ...] [--var=<name=value> ...]\n\
    hflow recover <persistence-log> [-p <plugin_module_name> ...] [--var=<name=value> ...]\n\
    hflow start-server [-p <plugin_module_name> ...]\n\
    hflow send <wf_id> ( <signal_file> | -d <signal_data> ) [-p <plugin_module_name> ...]\n\
    hflow -h | --help | --version";

var opts = docopt(doc);
const axios = require('axios');

if (opts['--version']) {
    console.log(require('../package.json').version);
    process.exit(0);
}

if (opts['--submit']) {
    hflowSubmit(opts);
    return;
}

var fs = require('fs'),
    pathtool = require('path'),
    redis = require('redis'),
    rcl = redisURL ? redis.createClient(redisURL): redis.createClient(),
    wflib = require('../wflib').init(rcl),
    Engine = require('../engine2'),
    async = require('async'),
    AdmZip = require('adm-zip'),
    dbId = 0,
    plugins = [],
    recoveryMode = false, recoveryData = { 'input': [], 'outputs': {}, 'settings': {} },
    glob = require('glob'),
    wfDirFull,
    hflowRun = require('../common/wfRun.js').hflowRun;

var hfroot = pathtool.join(require('path').dirname(require.main.filename), "..");

// Workflow variables TODO: add support for config files

if (opts.run) {
    if (opts['--with-server']) {
        hflowStartServer();
    }
    hflowRun(opts, function(err, engine) { });
} else if (opts.send) {
    hflowSend(opts);
} else if (opts['start-server']) {
    hflowStartServer();
} else if (opts.recover) {
    hflowRun(opts, function(err, engine) { });
} /*else if (opts.submit) {
    hflowSubmit(opts);
}*/

function hflowSubmit(opts) {
    let hfserver = opts['--submit'],
        url = hfserver + '/apps';

    axios({
        method: 'post',
        url: url,
        headers: { 'content-type': 'application/json' },
        data: opts
    }).
    then(function(response) {
    });
}

function hflowStartServer() {
    var server = require('../server/hyperflow-server.js')(rcl, wflib, plugins);
    let hostname = '127.0.0.1', port = process.env.PORT;
    server.listen(port,  () => { 
        console.log("HyperFlow server started, app factory URI: http://%s:%d/apps", server.address().address, server.address().port);
    });
}

function hflowSend(opts) {
    console.log("send signal to a workflow: not implemented");
}