var neo4j = require('neo4j');
var async = require('async');

var db = new neo4j.GraphDatabase('http://localhost:7474');
var queue = async.queue(store_provenance_info, 1); //max concurrency

function store_provenance_info(args, callback) {
    var op = args[0],
        appId = args[1],
        procId = args[2],
        firingId = args[3],
        sigId = args[4],
        sigIdx = args[5];

    console.log("o:", op, appId, "p:", procId, "f:", firingId, "sid:", sigId, "sidx:", sigIdx);

    params = {
        'op': op,
        'appId': appId,
        'procId': procId,
        'firingId': firingId
    };

    if (sigId) {
        params['sigId'] = sigId;
    }
    if (sigIdx) {
        params['sigIdx'] = sigIdx;
    }

    var node = db.createNode(params);
    node.save(function (err, node) {
        if (err) {
            console.log("error saving to db!", err);
        } else {
            console.log('successful save:', node.id);
        }
        callback();
    });
}

function handle_data(data, args) {
    queue.push([ args ], function (err) {
        if(err) {
            console.log("Error saving:", data, "err:", err);
        }
    });
}

exports.handle_data = handle_data;