var request = require('request')

var ThreatLevel = {
    NONE: "none",
    HEIGHTENED: "heightened",
    SEVERE: "severe"
};

function computeScenarioRanks(ins, outs, config, cb) {
    var realDataURI = ins[0].data[0];

    console.log("Computing ranks...");
    console.log(ins[0].data);

    outs.Ranks.data = [
        [ ins[0].name, "rank1", "rank2", "rank3" ]
    ];
    cb(null, outs);
}

function calculateThreatLevel(ranksData) {
    console.log("I got this:");
    ranks = [];
    ranksData.forEach(function (entry) {
        ranks.push(JSON.parse(entry));
    });
    console.log(ranks);

    threatLevel = ThreatLevel.NONE;
    ranks.forEach(function (entry) {
        //let's assume that scenarios below 55 represent threatening situations
        if (parseInt(entry.scenario_id) < 55) {
            threatLevel = ThreatLevel.HEIGHTENED;
        }
    });
    return threatLevel;
}

function completeExperiment(experimentId, dapToken, cb) {
    var payload = {
        "id": experimentId,
        "status": "finished"
    };
    request(
        {
            "url": "https://dap.moc.ismop.edu.pl/experiments/" + experimentId, //point this at proper experiment
            "strictSSL": false,
            "timeout": 1000,
            "body": JSON.stringify(payload), //put completion state struct here
            "headers": {
                "PRIVATE-TOKEN": dapToken,
                "Content-Type": "application/json"
            }
        },
        function (error, response, body) {
            if(!error) {
                cb();
            } else {
                console.log("Error!");
                console.log(error);
                cb();
            }
        }
    );
}

function computeThreatLevel(ins, outs, config, cb) {
    console.log("Computing threat level...");
    console.log("   ranks:", ins.Ranks.data);
    console.log("   jobscount:", ins.JobsCount.data[0]);

    ranks = ins.Ranks.data[0].stdout.replace(/=>/g, ":").trim().split("\n");
    var threatLevel = calculateThreatLevel(ranks);

    //TODO: update threat level for this

    var countLeft = ins.JobsCount.data[0];

    if (countLeft == 1) {
        completeExperiment(config.experiment.id, config.experiment.dap_token, function () {
            console.log("Finishing!");
            process.exit();
        });
    }

    outs.JobsCount.data = [ countLeft - 1 ];

    cb(null, outs);
}

exports.computeScenarioRanks = computeScenarioRanks;
exports.computeThreatLevel = computeThreatLevel;
