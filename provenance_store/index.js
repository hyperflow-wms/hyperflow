var neo4j = require('neo4j');
var db = new neo4j.GraphDatabase('http://localhost:7474');

function handle_data(data, args) {
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
    });
}

exports.handle_data = handle_data;