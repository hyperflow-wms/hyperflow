/* Hypermedia workflow. 
 ** Creates a new wf instance file based on a real pegasus dax file
 ** Author: Bartosz Balis (2013)
 */
var fs = require('fs'),
    xml2js = require('xml2js');

var wfOut = { 
    functions: [],
    tasks: [],
    data: [],
    ins: [],
    outs: []
};

var nextTaskId = -1, nextDataId = -1, dataNames = {};

function parseDax(filename, cb) {
    var parser = new xml2js.Parser();
    fs.readFile(filename, function(err, data) {
        if (err) { 
            cb(new Error("File read error. Doesn't exist?"));
        } else {
            parser.parseString(data, function(err, result) {
                if (err) {
                    cb(new Error("File parse error."));
                } else {
                    cb(null, result);
                }
            });
        }
    });
}

function public_createWorklowFromFile(filename, cb) {
    parseDax(filename, function(err, dax) {
        if (err) { 
            throw err; 
        } else {
            createWorkflow(dax, function(err, wf) {
                cb(null, wf);
            });
        }
    });
}


function createWorkflow(dax, cb) {
    dax.job.forEach(function(job) {
        ++nextTaskId;
        wfOut.tasks.push({ 
            "name": job['@'].name, 
            "execName": job['@'].name, 
            "execArgs": job.argument,
            "ins": [],
            "outs": []
        });

        var dataId;
        job.uses.forEach(function(job_data) {
            if (!dataNames[job_data['@'].name]) {
                ++nextDataId;
                wfOut.data.push({
                    "name": job_data['@'].name,
                    "sources": [],
                    "sinks": []
                });
                dataId = nextDataId;
                dataNames[job_data['@'].name] = dataId;
            } else {
                dataId = dataNames[job_data['@'].name];
            }
            if (job_data['@'].link == 'input') {
                wfOut.tasks[nextTaskId].ins.push(dataId);
                wfOut.data[dataId].sinks.push(nextTaskId);
            } else {
                wfOut.tasks[nextTaskId].outs.push(dataId);
                wfOut.data[dataId].sources.push(nextTaskId);
            }
        });
    });

    for (var i=0; i<wfOut.data.length; ++i) {
        if (wfOut.data[i].sources.length == 0) {
            wfOut.ins.push(i);
        }
        if (wfOut.data[i].sinks.length == 0) {
            wfOut.outs.push(i);
        }
    }
    cb(null, wfOut);
}
                
exports.createWorkflowFromFile = public_createWorklowFromFile;
