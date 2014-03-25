var request = require('request');
var http = require('http');

var functions = require('../workflows/ismop/LMonFunctions.js');

exports.setUp = function (callback) {
    this.server = createServer();
    this.server.listen(8080);
    callback();
};

exports.tearDown = function (callback) {
    this.server.close();
    callback();
};

exports.call_get_levee_levels = function (test) {
    var ins = [],
        outs = [],
        config = {
            "url": "http://localhost:8080/levee_state/1"
        };

    functions.getLeveeState(ins, outs, config, function (err, outs) {
        if (!err) {
            //TODO: add more assertions?
            test.done();
        } else {
            test.fail("getLeveeState response is invalid!");
        }
    });
};

exports.call_store_threat_level = function (test) {
    var ins = [],
        outs = [],
        config = {
            "url": "http://localhost:8080/levee_threatLevel/1"
        };

    functions.computeThreatLevel(ins, outs, config, function (err, outs) {
        if (!err) {
            test.done();
        } else {
            test.fail("computeThreatLevel response is invalid!");
        }
    });
};


function createServer() {
    //mock of services exposed by AIR
    return http.createServer(function (req, resp) {
        if (req.method === "GET" && req.url === "/levee_state/1") {
            //response for call_get_levee_levels
            resp.writeHead(200, {"Content-Type": "text/plain"});
            resp.write(JSON.stringify(
                {
                    "emergencyLevel": "hightened",
                    "threatLevel": "none"
                }
            ));
            resp.end();
        } else if (req.method === "POST" && req.url === "/levee_threatLevel/1") {
            //response for call_store_threat_level
            var body = "";
            req.on("data", function (data) {
                body += data;
            });
            req.on("end", function () {
                resp.writeHead(201, {"Content-Type": "text/plain"});
                resp.write(JSON.stringify({"result": "ok"})); //report ok
                resp.end();
            });
        } else {
            resp.writeHead(404, {"Content-Type": "text/plain"});
            resp.write("ERROR! Unknown operation or URL.");
            resp.end();
        }
    });
}