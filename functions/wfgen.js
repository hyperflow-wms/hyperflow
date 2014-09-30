function computeScenarioRanks(ins, outs, config, cb) {
    var realDataURI = ins[0].data[0];

    console.log("Computing ranks...");
    console.log(ins[0].data);

    outs.Ranks.data = [ [ ins[0].name, "rank1", "rank2", "rank3" ] ];
    cb(null, outs);
}

function computeThreatLevel(ins, outs, config, cb) {
    console.log("Computing threat level...");
    console.log("   ranks:", ins.Ranks);
    console.log("   jobscount:", ins.JobsCount.data[0]);

    var countLeft = ins.JobsCount.data[0];

    if (countLeft == 1) {
        console.log("Finishing!");
        process.exit();
    }

    outs.JobsCount.data = [ countLeft-1 ];

    cb(null, outs);
}

exports.computeScenarioRanks = computeScenarioRanks;
exports.computeThreatLevel = computeThreatLevel;