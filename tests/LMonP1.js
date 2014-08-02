var http = require('http');
var assert = require('assert');
var rewire = require('rewire');
var _ = require('underscore');

var functions = rewire('../functions/ismop/LMonFunctions.js');

exports.setUp = function (callback) {

    var response_body = {
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

    //local var is needed for function closures to work
    this.response_body = response_body;

    var fake_request = function (params, callback) {
        called = true;
        var response =
        {
            statusCode: 200
        };
        var body = JSON.stringify(response_body);
        callback(false, response, body);
    };

    fake_request.put = function (params, callback) {
        var response =
        {
            statusCode: 200
        };
        var parsed_request = JSON.parse(params["body"]);
        var requested_thretaLevel = parsed_request.levee["threat_level"];
        response_body.levee["threat_level"] = requested_thretaLevel;
        var body = JSON.stringify(response_body);
        callback(false, response, body);

    };

    functions.__set__("request", fake_request);
    callback();
};

//getLeveeState tests

exports.call_getLeveeState_clear_states = function (test) {
    var outs_ok = function (outs) {
        if (_.isEmpty(outs[0]) && _.isEmpty(outs[1])) {
            return true;
        } else {
            return false;
        }
    };

    call_getLeveeState(test, outs_ok);
};

exports.call_getLeveeState_heightened_emergency = function (test) {
    this.response_body.levee["emergency_level"] = "heightened";
    var outs_ok = function (outs) {
        if (outs[0].condition == "true" && _.isEmpty(outs[1])) {
            return true;
        } else {
            return false;
        }
    };

    call_getLeveeState(test, outs_ok);
};

exports.call_getLeveeState_severe_emergency = function (test) {
    this.response_body.levee["emergency_level"] = "severe";
    var outs_ok = function (outs) {
        if (_.isEmpty(outs[0]) && outs[1].condition == "true") {
            return true;
        } else {
            return false;
        }
    };

    call_getLeveeState(test, outs_ok);
};

function call_getLeveeState(test, outs_ok) {
    var ins = [],
        outs = [
            {},
            {}
        ],
        config = { "leveeId": 1};

    functions.getLeveeState(ins, outs, config, function (err, outs) {
        if (!err) {
            if (outs_ok(outs)) {
                //seems ok
            } else {
                test.fail("outs are in unexpected state!");
            }
        } else {
            test.fail("getLeveeState failed!");
        }
        test.done();
    });
}

//computeThreatLevel tests

exports.call_computeThreatLevels_none = function (test) {
    call_computeThreatLevels(test, 0.1);
};

exports.call_computeThreatLevels_heightened = function (test) {
    call_computeThreatLevels(test, 0.8);
};

exports.call_computeThreatLevels_severe = function (test) {
    call_computeThreatLevels(test, 0.99);
};

function call_computeThreatLevels(test, random_value) {

    //TODO: add expectation of fake server to be called
    var fake_Math = Math;
    var org_random = Math.random;
    fake_Math.random = function () {
        return random_value;
    };

    functions.__set__("Math", fake_Math);

    var ins = [],
        outs = [],
        config = { "leveeId": 1 };

    functions.computeThreatLevel(ins, outs, config, function (err, outs) {
        if (!err) {
            //no exception was thrown
        } else {
            test.fail("computeThreatLevel failed!");
        }

        //revert changes done to Math.random
        Math.random = org_random;
        test.done();
    });
}

//severeEmergencyActions tests

exports.call_severeEmergencyActions = function (test) {
    var ins = [],
        outs = [],
        config = {};

    functions.severeEmergencyActions(ins, outs, config, function (err, outs) {
        test.ok(!err);
        test.done();
    });
};