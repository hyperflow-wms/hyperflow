var neo4j = require('neo4j');
var async = require('async');

var db = new neo4j.GraphDatabase('http://localhost:7474');
var queue = async.queue(store_provenance_info, 1); //max concurrency

db.query("MATCH (n) OPTIONAL MATCH (n)-[r]-() DELETE n,r", function () {
});

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
            //create relationships
            if (op == "read") {
                //connect writing and reading a signal with relationship
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
                            related_node.createRelationshipTo(node, 'produces signal for', {}, function (err, rel) {
                                if (err) {
                                    console.log("Error creating relation!", err);
                                } else {
                                    console.log("Created relationship for: ", node["data"]["procId"]);
                                }
                            });
                        }
                    }
                });
            }
            if (op == "write") {
                //connect signals dependant according to being "in state"
                
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