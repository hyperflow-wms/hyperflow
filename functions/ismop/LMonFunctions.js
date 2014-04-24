var request = require('request'); // http client
var rest_config = require('./LMonFunctions.config.js');


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
            "url": rest_config.dap_url + rest_config.levee_service + config.levee_id,
            "strictSSL": false,
            "headers": {
                "PRIVATE-TOKEN": rest_config.auth_token
            }
        },
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var result = JSON.parse(body);
                var emergencyLevel = EmergLevel[result.levee.emergency_level.toUpperCase()];
                var threatLevel = ThreatLevel[result.levee.threat_level.toUpperCase()];

                //TODO; check for emergencyLevel == undefined, if so fail
//                console.log("emergencyLevel=" + emergencyLevel);
//                console.log("threatLevel=" + threatLevel);

                if (emergencyLevel == EmergLevel.HEIGHTENED && threatLevel == ThreatLevel.NONE) {
                    console.log("Setting heightened emergency level");
                    outs[0].condition = "true"; // emit "ELHeightened" signal
                    outs[0].data = [
                        { }
                    ];
                }

                if (emergencyLevel == EmergLevel.SEVERE) {
                    console.log("Setting severe emergency level");
                    outs[1].condition = "true"; // emit "ELSevere" signal
                    outs[1].data = [
                        { }
                    ];
                }

                cb(null, outs);
            } else {
                cb(new Error("Error reading response from getLeveeState!"), outs);
            }
        });
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

    request.put(
        {
            "timeout": 1000,
            "url": rest_config.dap_url + rest_config.levee_service + config.levee_id,
            "form": { "levee": { "id": config.levee_id, "threat_level": threatLevel }},
            "strictSSL": false,
            "headers": {
                "PRIVATE-TOKEN": rest_config.auth_token
            }
        },
        function(error, response, body) {
            if(!error && response.statusCode == 200) {
                parsedResponse = JSON.parse(body);
                if (parsedResponse.levee.threat_level == threatLevel) {
                    cb(null, outs);
                } else {
                    cb(new Error("Error storing threatLevel!"), outs);
                }
            } else {
                cb(new Error("Error reading response from storeThreatLevel!"), outs);
            }
        }
    );
}

// Step 2b: perform actions in the severe emergency level
function severeEmergencyActions(ins, outs, config, cb) {
    console.log("Severe Emergency Actions!");
    cb(null, outs);
}

exports.getLeveeState = getLeveeState;
exports.computeThreatLevel = computeThreatLevel;
exports.severeEmergencyActions = severeEmergencyActions;
