/**
 * Checks the docker commands that `make push TAG=<tag>` runs: the image is
 * built with the tag's version, pushed as the tag first, and pushed as latest
 * only when the tag has no "-". The recipe that `make -n` prints runs in sh
 * with docker replaced by a function that echoes its arguments, so the test
 * needs make and sh but no Docker and no git repository.
 * Run with:  node tests/makePush.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const env = Object.assign({}, process.env);
delete env.MAKEFLAGS;
delete env.MAKEOVERRIDES;
delete env.GNUMAKEFLAGS;

function dockerCommands(tag) {
    const script = execFileSync('make', ['-n', 'push', 'TAG=' + tag],
        { cwd: path.join(__dirname, '..'), env: env, encoding: 'utf8' });
    const out = execFileSync('sh', ['-ec', 'docker() { echo "docker $*"; }\n' + script],
        { env: env, encoding: 'utf8' });
    return out.trim().split('\n');
}

const image = 'hyperflowwms/hyperflow';
const cases = [
    ['v1.11.2', ['docker build --no-cache --build-arg VERSION=1.11.2 -t ' + image + ' .',
        'docker tag ' + image + ' ' + image + ':v1.11.2',
        'docker push ' + image + ':v1.11.2',
        'docker push ' + image]],
    ['v1.11.2-rc.1', ['docker build --no-cache --build-arg VERSION=1.11.2-rc.1 -t ' + image + ' .',
        'docker tag ' + image + ' ' + image + ':v1.11.2-rc.1',
        'docker push ' + image + ':v1.11.2-rc.1']],
];

let failed = 0;
cases.forEach(([tag, expected], i) => {
    const actual = dockerCommands(tag);
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log('ok ' + (i + 1) + ' - make push TAG=' + tag);
    } else {
        failed++;
        console.log('not ok ' + (i + 1) + ' - make push TAG=' + tag);
        console.log('# expected:\n#   ' + expected.join('\n#   ') + '\n# actual:\n#   ' + actual.join('\n#   '));
    }
});
process.exit(failed ? 1 : 0);
