var request = require('request'); // http client
var rest_config = require('./LMonFunctions.config.js');
var logger = require('winston').loggers.get('workflow');

var EmergLevel = {
    NONE: "none",
    HEIGHTENED: "heightened",
    SEVERE: "severe"
};

var ThreatLevel = {
    NONE: "none",
    HEIGHTENED: "heightened",
    SEVERE: "severe"
};

// Step 1: periodically reads the Levee state from DAP.
// The main parameter of interest is `emergencyLevel':
// - If 'none', no action taken
// - If 'heightened', triggers computation of the current threat level
// - If 'severe', triggers appropriate actions
function getLeveeState(ins, outs, config, cb) {
    // var leveeURI = config.leveeUri;  // URI could be passed through config
    // TODO: invoke DAP's REST API to retrieve levee state

    request(
        {
            "timeout": 1000,
            "url": rest_config.DAP_URL + rest_config.LEVEE_SERVICE + config.leveeId,
            "strictSSL": false,
            "headers": {
                "PRIVATE-TOKEN": rest_config.AUTH_TOKEN
            }
        },
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var result = JSON.parse(body);
                var emergencyLevel = EmergLevel[result.levee.emergency_level.toUpperCase()];
                var threatLevel = ThreatLevel[result.levee.threat_level.toUpperCase()];

                //TODO; check for emergencyLevel == undefined, if so fail
                logger.info("getLeveeState: emergencyLevel= %s, threatLevel: %s", emergencyLevel, threatLevel);

//                if (emergencyLevel == EmergLevel.HEIGHTENED && threatLevel == ThreatLevel.NONE) {
                if (emergencyLevel == EmergLevel.HEIGHTENED) {
                    logger.info("Setting heightened emergency level");
                    outs[0].condition = "true"; // emit "ELHeightened" signal
                    outs[0].data = [
                        { }
                    ];
                }

                if (emergencyLevel == EmergLevel.SEVERE) {
                    logger.info("Setting severe emergency level");
                    outs[1].condition = "true"; // emit "ELSevere" signal
                    outs[1].data = [
                        { }
                    ];
                }

                cb(null, outs);
            } else {
                logger.info("Error reading response from getLeveeState!");
                logger.info("error: %s, response: %s", error, response);
                cb(new Error("Error reading response from getLeveeState!"), outs);
            }
        });
}

function storeThreatLevel(leveeId, threatLevel, cb) {
    var levee = { "levee": { "id": leveeId,
        "threat_level": threatLevel
    }};

    request.put(
        {
            "timeout": 1000,
            "url": rest_config.DAP_URL + rest_config.LEVEE_SERVICE + leveeId,
//            "form": { "levee": { "id": config.leveeId, "threat_level": threatLevel }},
            "body": JSON.stringify(levee),
            "strictSSL": false,
            "headers": {
                "PRIVATE-TOKEN": rest_config.AUTH_TOKEN,
                "Content-Type": "application/json"
            }
        },
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var parsedResponse = JSON.parse(body);
                if (parsedResponse.levee.threat_level == threatLevel) {
                    logger.info("computeThreatLevel: threat level= %s", threatLevel);
                    cb(null);
                } else {
                    logger.error("Error storing threatLevel!");
                    cb(new Error("Error storing threatLevel!"));
                }
            } else {
                logger.error("Error reading response from storeThreatLevel!");
                logger.error("error:", error, ", response:", response);
                cb(new Error("Error reading response from storeThreatLevel!"));
            }
        }
    );
}

// Step 2a: run estimation of the threat level (here will be the Map/Reduce jobs!)
function computeThreatLevel(ins, outs, config, cb) {
    var threatLevel;

    var rand = Math.random();
    if (rand > 0.95) {
        threatLevel = ThreatLevel.SEVERE;
    } else if (rand > 0.7) {
        threatLevel = ThreatLevel.HEIGHTENED;
    } else {
        threatLevel = ThreatLevel.NONE;
    }

    storeThreatLevel(config.leveeId, threatLevel, function (err) {
        cb(err, outs);
    });
}

// Step 2b: perform actions in the severe emergency level
function severeEmergencyActions(ins, outs, config, cb) {
    logger.info("severeEmergencyActions: firing!");
    cb(null, outs);
}

exports.getLeveeState = getLeveeState;
exports.computeThreatLevel = computeThreatLevel;
exports.severeEmergencyActions = severeEmergencyActions;
