const { execSync } = require('child_process');

function runHashcat(algorithm) {
    const hashesFile = algorithm + '_hashes.txt'; // Hashes file     // Algorithm name (e.g., 'md5', 'sha1')
    const crackedFile = 'cracked.txt';            // Output file for cracked hashes

    // Map algorithms to Hashcat mode IDs
    const algorithmModeMap = {
        md5: 0,
        sha1: 100,
        sha256: 1400,
        sha512: 1700
    };

    const hashcatMode = algorithmModeMap[algorithm];
    if (hashcatMode === undefined) {
        const error = new Error(`Unsupported algorithm: ${algorithm}`);
        console.error(error.message);
        return;
    }

    const mask = '?a?a?a?a?a';
    console.log(`Running Hashcat for ${algorithm}...`);

    // Construct the Hashcat command
    const command = `hashcat --potfile-disable -m ${hashcatMode} -a 3 -o ${crackedFile} ${hashesFile} ${mask}`;

    // Execute the Hashcat command
    execSync(command, (error, stdout, stderr) => {

        if (error) {
            console.error(`Hashcat Error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Hashcat Stderr: ${stderr}`);
        }

        console.log(`Hashcat Output:\n${stdout}`);
    });
}

const args = process.argv.slice(2);
runHashcat(args[0]);