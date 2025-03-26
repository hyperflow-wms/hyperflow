const { exec } = require('child_process');

function runSpeedTestForDuration(durationSeconds = 10) {
    console.log(`Running speed tests for ${durationSeconds} seconds...`);

    const endTime = Date.now() + durationSeconds * 1000;

    function runOnce() {
        if (Date.now() >= endTime) {
            console.log('Finished speed tests.');
            return;
        }

        console.log(`Running speedtest-cli...`);
        exec('speedtest-cli --bytes', (error, stdout, stderr) => {
            if (error) {
                console.error(`Speedtest error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`Speedtest stderr: ${stderr}`);
            }

            console.log(`Speedtest output:\n${stdout}`);

            // Chain the next test
            runOnce();
        });
    }

    runOnce();
}

runSpeedTestForDuration(60);