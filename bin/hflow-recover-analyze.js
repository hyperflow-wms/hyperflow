#!/usr/bin/env node

var fs = require('fs');
var Graph = require("graphlib").Graph;

const recoveryFile = process.argv[2];

var procNameIdx = {}, sigNameIdx = {};

var lines = [], inputs = [], tasks = [], info;
fs.readFileSync(recoveryFile, 'utf8')
    .trim()
    .split("\n")
    .forEach(lineStr => { 
        var line = JSON.parse(lineStr);
        var type = line[1][0];
        if (type == "info") {
            info = line;
        } else if (type == "input") {
            inputs.push(line);
        } else if (type == "fired") {
            tasks.push(line);
        }
    });

var wfJson = JSON.parse(fs.readFileSync("workflow.json", 'utf8'));

var wfgraph = new Graph();
inputs.forEach(input => {
    let nodeName = "s:" + input[1][2]._id; // sigIdx should also be added
    wfgraph.setNode(nodeName)
});

tasks.forEach(task => {
    let procId = task[1][2];
    let nodeName = "p:" + procId; // firingId should also be added
    let procName = wfJson.processes[procId-1].name;
    procNameIdx[procName] ? procNameIdx[procName].push(procId): procNameIdx[procName]=[procId];
    wfgraph.setNode(nodeName, procName)
});

tasks.forEach(task => {
    procIns = task[1][4];
    procOuts = task[1][5];
    procIns.forEach(procIn => {
        let nodeName = "s:" + procIn._id;
        let nodeLabel = procIn.name;
        wfgraph.setNode(nodeName, nodeLabel)
        let sourceNodeName = "p:" + procIn.source;
        wfgraph.setEdge(sourceNodeName, nodeName)
    });
    procOuts.forEach(procOut => {
        let nodeName = "s:" + procOut._id;
        let nodeLabel = procOut.name;
        wfgraph.setNode(nodeName, nodeLabel)
        let sinkNodeName = "p:" + task[1][2]; // firindId should also be added
        wfgraph.setEdge(nodeName, sinkNodeName)
    });
});

function recSuccessors(graph, nodes) {
    let succList = {};
    let recSuccAux = (v) => {
        let succ = graph.successors(v);
        succ.forEach(s => succList[s]="1");
        succ.forEach(s => recSuccAux(s));
    }
    [].concat(nodes).forEach(node => recSuccAux(node));
    let result = [];
    for (k in succList) {
        result.push(k);
    }
    return result;
}

function recPredecessors(graph, nodes) {
    let predList = {};
    let recPredAux = (v) => {
        let pred = graph.predecessors(v);
        pred.forEach(s => predList[s]="1");
        pred.forEach(s => recPredAux(s));
    }
    [].concat(nodes).forEach(node => recPredAux(node));
    let result = [];
    for (k in predList) {
        result.push(k);
    }
    return result;
}

try {
    var recoveryCfg = JSON.parse(fs.readFileSync("recovery.cfg"));
} catch(err) {
    console.error(err);
    process.exit(1);
}

function updateRecoveryModifiedProcess(procName) {
    if (!(procName in procNameIdx)) throw("Unknown process name", procName);
    procIds = procNameIdx[procName];
    successorIds = recSuccessors(wfgraph, procIds.map(x => "p:" + x));
    dependentProcIds = successorIds.filter(x => x.split(':')[0]=="p").map(x => parseInt(x.split(':')[1]));
    procIdsToRecompute = procIds.concat(dependentProcIds);
    tasks.forEach(task => {
        procId = task[1][2];
        // mark process to be re-computed
        if (procIdsToRecompute.includes(procId)) {
            task[2] = { "flags": ["forceRecompute"] };
        }
    });
}

if (recoveryCfg.modified) {
    recoveryCfg.modified.forEach(entry => {
        entryObject = entry.selector.split('.');
        // currently only selector 'process.name' supported
        if (entryObject[0] == "process" && entryObject[1] == "name") { 
            updateRecoveryModifiedProcess(entry.value);
        }
    });
}

console.log(JSON.stringify(info));
inputs.map(x => console.log(JSON.stringify(x)));
tasks.map(x => console.log(JSON.stringify(x)));
