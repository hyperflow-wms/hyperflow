var request = require('request'); // http client


var EmergLevel = {
    NONE: "none",
    HIGHTENED: "hightened",
    SEVERE: "severe"
};

var ThreatLevel = {
    NONE: "none",
    HIGHTENED: "hightened",
    SEVERE: "severe"
};

// emulates values written in DAP (to be removed)
var emLevelPersistent = EmergLevel.NONE, thrLevelPersistent = ThreatLevel.NONE; 

// Step 1: periodically reads the Levee state from DAP. 
// The main parameter of interest is `emergencyLevel':
// - If 'none', no action taken
// - If 'hightened', triggers computation of the current threat level
// - If 'severe', triggers appropriate actions
function getLeveeState(ins, outs, config, cb) {
    // var leveeURI = config.leveeUri;  // URI could be passed through config
    // TODO: invoke DAP's REST API to retrieve levee state
    
    var emergencyLevel, threatLevel; 
    
    var rand = Math.random(); // TODO: to be set by the result of REST invocation
    if (rand > 0.95) {
        emergencyLevel = EmergLevel.SEVERE; 
    } else if (rand > 0.7) {
        emergencyLevel = EmergLevel.HIGHTENED;
    } else {
        emergencyLevel = EmergLevel.NONE;
    }
    console.log("emergencyLevel="+emergencyLevel);

    if (emergencyLevel == EmergLevel.HIGHTENED && thrLevelPersistent == ThreatLevel.NONE) {
        console.log("Setting hightened emergency level");
        outs[0].condition = "true"; // emit "ELHightened" signal
        outs[0].data = [ { } ];
    }

    if (emergencyLevel == EmergLevel.SEVERE) { 
        console.log("Setting severe emergency level");
        outs[1].condition = "true"; // emit "ELSevere" signal
        outs[1].data = [ { } ];
    }

    cb(null, outs);
}

// Step 2a: run estimation of the threat level (here will be the Map/Reduce jobs!)
function computeThreatLevel(ins, outs, config, cb) {
    var threatLevel;

    var rand = Math.random(); 
    if (rand > 0.95) {
        threatLevel = ThreatLevel.SEVERE; 
    } else if (rand > 0.7) {
        threatLevel = ThreatLevel.HIGHTENED;
    } else {
        threatLevel = ThreatLevel.NONE;
    }
    console.log("Computing threat level...");

    setTimeout(function() {
        console.log("threatLevel="+threatLevel);
        thrLevelPersistent = threatLevel; // TODO: replace it with POST to DAP
        cb(null, outs);
    }, 5000);
}

// Step 2b: perform actions in the severe emergency level
function severeEmergencyActions(ins, outs, config, cb) {
    console.log("Severe Emergency Actions!");
    cb(null, outs);
}

exports.getLeveeState = getLeveeState;
exports.computeThreatLevel = computeThreatLevel;
exports.severeEmergencyActions = severeEmergencyActions;
