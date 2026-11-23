const fs = require('fs');
const crypto = require('crypto');

function randomString(maxLength) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < maxLength; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function generateHashes() {
    const algorithms = ['md5', 'sha1', 'sha256', 'sha512', 'sha3-256'];
    const proportions = [35, 25, 15, 15, 10]; // Percentages for each algorithm

    const totalHashes = 100;
    const hashCounts = proportions.map(p => Math.floor((p / 100) * totalHashes));

    const hashes = [];

    for (let i = 0; i < algorithms.length; i++) {
        for (let j = 0; j < hashCounts[i]; j++) {
            const randomStr = randomString(5);
            const hash = crypto.createHash(algorithms[i]).update(randomStr).digest('hex');
            hashes.push({ hash, algorithm: algorithms[i] });
        }
    }

    // Write all hashes to a single file
    const allHashes = hashes.map(h => `${h.hash} ${h.algorithm}`).join('\n');
    fs.writeFileSync('hashes.txt', allHashes, 'utf8');
}

generateHashes()