var neo4j = require('neo4j');
var async = require('async');
var _ = require('underscore');

var db = new neo4j.GraphDatabase('http://localhost:7474');
var queue = async.queue(store_provenance_info, 1); //max concurrency

var in_state_store = {};

db.query("MATCH (n) OPTIONAL MATCH (n)-[r]-() DELETE n,r", function () {
});

function store_provenance_info(args, callback) {
    var op = args[0],
        appId = +args[1],
        procId = +args[2],
        firingId = +args[3],
        sigId = +args[4],
        sigIdx = +args[5];

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
//            console.log('successful save:', node.id);
            //create relationships
            if (op == "read") {
                //connect writing and reading a signal with a relationship
                var reverse_op = "write";
                var query = [
                    "MATCH (n {",
                        "op:\"" + reverse_op + "\",",
                        "firingId:" + firingId + ",",
                        "sigId:" + sigId + ",",
                        "sigIdx:" + sigIdx,
                    "}) return n"
                ].join(" ");
                db.query(query, function (err, results) {
                    if (err) {
                        console.log("Query error!", err);
                    } else {
                        //should return at most one!
                        for (var i = 0; i < results.length; i++) {
//                            console.log(">>>>>>>>>>>>>", JSON.stringify(results[i]["n"].id));
                            var related_node = results[i]["n"];
                            //if there are any, create relation
                            related_node.createRelationshipTo(node, 'signal read/write', {}, function (err, rel) {
                                if (err) {
                                    console.log("Error creating relation!", err);
                                } else {
                                }
                            });
                        }
                    }
                });

                //register read as signal in state of proc
                var state = { "firingId": firingId, "sigId": sigId, "sigIdx": sigIdx };
                if (procId in in_state_store) {
                    in_state_store[procId].push(state);
                } else {
                    in_state_store[procId] = [ state ];
                }

            } else if (op == "write") {
                //connect writing signal events with dependant signals reads according to being "in state"
//                console.log("p:", procId, in_state_store);

                //find all in state read events (signals)
                var in_states = in_state_store[procId];
                for (var i = 0; i < in_states.length; i++) {
                    var state = in_states[i];
                    var query = [
                        "MATCH (n {",
                        "op:\"read\",",
                            "procId:" + procId + ",",
                            "firingId:" + state.firingId + ",",
                            "sigId:" + state.sigId + ",",
                            "sigIdx:" + state.sigIdx,
                        "}) return n"
                    ].join(" ");

                    db.query(query, function (err, results) {
                        if (err) {
                            console.log("Query error!", err);
                        } else {
                            if(results.length == 1) {
                                var related_node = results[0]["n"];
    //                            console.log("found:", result.data);
                                //make relationship
                                node.createRelationshipTo(related_node, 'depends on', {}, function(err, rel) {
                                    if (err) {
                                        console.log("Error creating relation!", err);
                                    } else {
    //                                    console.log("created dependency for:", node.id, " and ", related_node.id);
                                    }
                                });
                            } else {
                                console.log("Related node not found: p:", procId, state);
                            }

                        }
                    });
                }


            } else if (op == "state-reset") {
                delete in_state_store[procId];
            }
        }
        callback();
    });


}

function handle_data(data, args) {
    queue.push([ args ], function (err) {
        if (err) {
            console.log("Error saving:", data, "err:", err);
        }
    });
}

exports.handle_data = handle_data;