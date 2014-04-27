var request = require('request');
var http = require('http');
var traverse = require('traverse');

var functions = require('../functions/ismop/LMonFunctions.js');

exports.setUp = function (callback) {
    this.server = createServer();
    this.server.listen(8080);
    callback();
};

exports.tearDown = function (callback) {
    this.server.close();
    callback();
};

exports.call_getLeveeState = function (test) {
    var ins = [],
        outs = [],
        config = { "levee_id": 1};

    functions.getLeveeState(ins, outs, config, function (err, outs) {
        if (!err) {
            //TODO: add more assertions?
//            console.log(JSON.stringify(outs));
        } else {
            test.fail("getLeveeState failed!");
        }
        test.done();
    });
};

exports.call_storeThreatLevels = function (test) {
    var ins = [],
        outs = [],
        config = { "levee_id": 1};

    functions.computeThreatLevel(ins, outs, config, function (err, outs) {
        if (!err) {
        } else {
            test.fail("computeThreatLevel failed!");
        }
        test.done();
    });
};

exports.call_severeEmergencyActions = function (test) {
    var ins = [],
        outs = [],
        config = {};

    functions.severeEmergencyActions(ins, outs, config, function (err, outs) {
        test.ok(!err);
        test.done();
    });
};

//Helper functions

function parseParamString(paramString, paramName) {
    var parts = paramString.split("&");
    for (i = 0; i < parts.length; i++) {
        var pair = parts[i].split("=");
        if (pair[0] == paramName) {
            return pair[1];
        }
    }
}

function createServer() {

    var getLeveeState_response = {
        "levee": {
            "emergency_level": "none",
            "id": 1,
            "name": "Real section",
            "shape": {
                "coordinates": [
                    [
                        49.981348,
                        19.678777,
                        211.21
                    ],
                    [
                        49.98191,
                        19.678662,
                        211.14
                    ],
                    [
                        49.981919,
                        19.678856,
                        215.7
                    ],
                    [
                        49.981928,
                        19.679069,
                        211.1
                    ],
                    [
                        49.981371,
                        19.679169,
                        210.84
                    ],
                    [
                        49.981357,
                        19.678973,
                        215.84
                    ]
                ],
                "type": "MultiPoint"
            },
            "threat_level": "none",
            "threat_level_updated_at": "2014-04-02T14:37:37.276Z"
        }
    };
    //copy response with changed value for threat_level
    var storeThreatLevels_response = traverse.clone(getLeveeState_response);

    var threat_level = "none";
    var emergency_level = "none";

    //mock of services exposed by DAP
    return http.createServer(function (req, resp) {
        if (req.method === "GET" && req.url === "/api/v1/levees/1") {
            //response for call_getLeveeState
            resp.writeHead(200, {"Content-Type": "application/json"});
            resp.write(JSON.stringify(getLeveeState_response));
            resp.end();
        } else if (req.method === "PUT" && req.url === "/api/v1/levees/1") {
            //response for call_storeThreatLevels
            var body = "";
            req.on("data", function (data) {
                body += data;
            });
            req.on("end", function () {
                threat_level = parseParamString(body, "threat_level");
                storeThreatLevels_response.levee["threat_level"] = threat_level;
                resp.writeHead(201, {"Content-Type": "application/json"});
                resp.write(JSON.stringify(storeThreatLevels_response)); //respond with ok
                resp.end();
            });
        } else {
            resp.writeHead(404, {"Content-Type": "text/plain"});
            resp.write("ERROR! Unknown operation or URL.");
            resp.end();
        }
    });
}