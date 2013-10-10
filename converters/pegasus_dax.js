/* Hypermedia workflow. 
 ** Converts from pegasus dax file to hyperflow workflow representation (json)
 ** Author: Bartosz Balis (2013)
 */

/*
 * Any converter should provide an object constructor with the following API:
 * convert(wf, cb) 
 *   - @wf  - native workflow representation
 *   - @cb  - callback function (err, wfJson)
 * convertFromFile(filename, cb)
 *   - @filename  - file path from which the native wf representation should be read
 *   - @cb        - callback function (err, wfJson)
 */
var fs = require('fs'),
    xml2js = require('xml2js');

// Pegasus DAX converter constructor
var PegasusConverter = function() {
}

PegasusConverter.prototype.convertFromFile = function(filename, cb) {
    parseDax(filename, function(err, dax) {
        if (err) { 
            throw err; 
        } else {
            createWorkflow(dax, function(err, wfJson) {
                cb(null, wfJson);
            });
        }
    });
}


var wfOut = { 
    functions: [ {"name": "amqpCommand", "module": "functions"} ],
    tasks: [],
    data: [],
    ins: [],
    outs: []
};

var sources = {}, sinks = {};

var nextTaskId = -1, nextDataId = -1, dataNames = {};

function parseDax(filename, cb) {
    var parser = new xml2js.Parser({normalize: true});
    fs.readFile(filename, function(err, data) {
        if (err) { 
            cb(new Error("File read error. Doesn't exist?"));
        } else {
            var dag = data.toString();
            dag = dag.replace(/<file name="(.*)".*>/g, "$1");
            dag = dag.replace(/<filename file="(.*)".*>/g, "$1");
            parser.parseString(dag, function(err, result) {
                if (err) {
                    cb(new Error("File parse error."));
                } else {
			//console.log(JSON.stringify(result, null, 2));
                    cb(null, result);
                }
            });
        }
    });
}


function createWorkflow(dax, cb) {
    dax.adag.job.forEach(function(job) {
        ++nextTaskId;
	var args = job.argument[0];
        wfOut.tasks.push({ 
            "name": job['$'].name, 
            "function": "amqpCommand", 
            "executor": "syscommand",
            "config": {
                "executor": {
                    "executable": job['$'].name, 
                    "args": args
                }
            },
            "ins": [],
            "outs": []
        });

        if (job['$'].runtime) { // synthetic workflow dax
            wfOut.tasks[nextTaskId].runtime = job['$'].runtime;
        }

        //var 
        //if (config

        var dataId, dataName;
        job.uses.forEach(function(job_data) {
	    if (job_data['$'].name) {
                dataName = job_data['$'].name; // dax v3.3
	    } else {
                dataName = job_data['$'].file; // dax v2.1
	    }
            if (!dataNames[dataName]) {
                ++nextDataId;
                wfOut.data.push({
                    "name": dataName,
                    "sources": [],
                    "sinks": []
                });
                dataId = nextDataId;
                dataNames[dataName] = dataId;
            } else {
                dataId = dataNames[dataName];
            }
            if (job_data['$'].size) { // synthetic workflow dax
                wfOut.data[dataId].size = job_data['$'].size;
            }
            if (job_data['$'].link == 'input') {
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

    for (var i=0; i<wfOut.data.length; ++i) {
        if (wfOut.data[i].sources.length > 1) {
            console.error("WARNING multiple sources for:" + wfOut.data[i].name, "sinks:", wfOut.data[i].sinks);
        }
        delete wfOut.data[i].sources;
        delete wfOut.data[i].sinks;
    }

    cb(null, wfOut);
}
                
function zeroPad(num, size) {
    var s = num+"";
    while (s.length < size) s = "0" + s;
    return s;
}

module.exports = PegasusConverter;
