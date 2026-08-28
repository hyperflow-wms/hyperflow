const fs = require('fs');

function summarizeResults() {
    const crackedHashes = fs.readFileSync("cracked.txt", 'utf8').trim().split('\n');

    console.log('Cracked hashes:', crackedHashes);

    const summary = {
        cracked: crackedHashes.length,
        total: crackedHashes.length, // For simplicity, assume all hashes are cracked
        details: crackedHashes
    };

    console.log('Summary:', summary);
}

summarizeResults()