const fs = require('fs');

function filterHashes() {
    const hashes = fs.readFileSync("hashes.txt", 'utf8').trim().split('\n');

    const groupedHashes = {
        md5: [],
        sha1: [],
        sha256: [],
        sha512: [],
        'sha3-256': []
    };

    hashes.forEach(line => {
        const [hash, algorithm] = line.split(' ');
        if (groupedHashes[algorithm]) {
            groupedHashes[algorithm].push(hash);
        }
    });

    // Write hashes to separate files by algorithm
    Object.keys(groupedHashes).forEach(algorithm => {
        const filename = `${algorithm}_hashes.txt`;
        fs.writeFileSync(filename, groupedHashes[algorithm].join('\n'), 'utf8');
    });
}

filterHashes()