function handle_data(data, args) {
    var op = args[0],
        appId = args[1],
        procId = args[2],
        firingId = args[3],
        sigId = args[4],
        sigIdx = args[5];

    console.log("o:", op, appId, "p:", procId, "f:", firingId, "sid:", sigId, "sidx:", sigIdx);
}

exports.handle_data = handle_data;