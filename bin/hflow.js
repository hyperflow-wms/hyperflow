#!/usr/bin/env node

var docopt = require('docopt').docopt;

var doc = "\
Usage:\n\
    hflow run <workflow_dir_or_file> [-s] [--submit=<hyperflow_server_url] [--persist] [--with-server] [--log-provenance] [--provenance-output=<provenance_file>] [-p <plugin_module_name> ...] [--var=<name=value> ...]\n\
    hflow recover <persistence-log> [-p <plugin_module_name> ...] [--var=<name=value> ...]\n\
    hflow start-server [--host <hyperflow_server_host>] [--port <hyperflow_server_port>] [-p <plugin_module_name> ...]\n\
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

var hflowRun = require('../common/wfRun.js').hflowRun,
    hflowStartServer = require('../common/wfRun.js').hflowStartServer;


// Workflow variables TODO: add support for config files

if (opts.run) {
    if (opts['--with-server']) {
        hflowStartServer();
    }
    hflowRun(opts, function(err, engine, wfId, wfName) { });
} else if (opts.send) {
    hflowSend(opts);
} else if (opts['start-server']) {
    hflowStartServer(opts);
} else if (opts.recover) {
    hflowRun(opts, function(err, engine, wfId, wfName) { });
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

function hflowSend(opts) {
    console.log("send signal to a workflow: not implemented");
}