/**
 * Tests for the version that the engine image reports with `hflow --version`.
 *
 * The git tag is the only place a version is set. `make image` takes the
 * nearest version tag (a tag matching v[0-9]*.[0-9]*.[0-9]*) as
 * `git describe --tags --dirty` reports it, tags the image with it, and
 * passes it without its leading "v" to `docker build` as the VERSION build
 * argument. On a release, CI runs `make push RELEASE_TAG=<tag>`, and the
 * image tag and the version come from RELEASE_TAG instead. CI also passes
 * PRERELEASE, "true" for a GitHub pre-release and "false" otherwise. With
 * PRERELEASE=true, `make push` pushes only the version tag and not latest;
 * with PRERELEASE=false or without PRERELEASE it pushes latest too; it
 * refuses any other value of PRERELEASE while make reads the Makefile. The
 * Dockerfile writes VERSION into package.json with `npm version` before
 * `npm install`.
 * The repository's package.json holds 0.0.0-dev. scripts/check-version.sh
 * rejects anything but a strict semver 2.0.0 version without build metadata;
 * `make image` runs it before any docker command, and the Dockerfile before
 * `npm version`. `make push` refuses to run, while make reads the Makefile,
 * when the version is empty, and when RELEASE_TAG is set and VERSION or TAG
 * differs from what it gives; `make image` and `make push` refuse to run when
 * the image tag is empty, as outside a git checkout.
 *
 * The script part runs scripts/check-version.sh on valid and invalid
 * versions. The Dockerfile part runs the Dockerfile's own `npm version` RUN
 * command under sh, on copies of the files of the build context it uses, in
 * a directory without .git, as `docker build` would. The Makefile part runs
 * `make image` and `make push` in scratch git repositories holding copies of
 * the Makefile and the script, so the result does not depend on the tags or
 * the uncommitted changes of this checkout. A fake `docker`, first on PATH,
 * records the arguments of each docker command instead of running it, and
 * the tests check those arguments, and that a tag with shell characters runs
 * nothing. Refusals that make decides while it reads the Makefile are checked
 * with `make -n`.
 *
 * Needs sh, grep, npm, make and git; no Docker and no network.
 * Run with:  node tests/version.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmpDirs = [];

function mkTmp(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Versions in package.json and in both version fields of package-lock.json.
function versionsIn(dir) {
    const pkg = readJson(path.join(dir, 'package.json'));
    const lock = readJson(path.join(dir, 'package-lock.json'));
    return [pkg.version, lock.version, lock.packages[''].version];
}

// Dockerfile instructions with line continuations joined.
function dockerInstructions() {
    const text = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const out = [];
    let current = '';
    for (const line of text.split('\n')) {
        if (current === '' && (/^\s*#/.test(line) || line.trim() === '')) continue;
        if (/\\\s*$/.test(line)) {
            current += line.replace(/\\\s*$/, '') + ' ';
            continue;
        }
        out.push((current + line).trim());
        current = '';
    }
    return out;
}

const checkScript = 'scripts/check-version.sh';

// Whether .dockerignore lets a file into the build context. The file uses
// "*" to exclude everything and "!<path>" lines to let paths back in; the
// last line that matches the file decides.
function inBuildContext(file) {
    let included = true;
    for (const raw of fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n')) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) continue;
        const negated = line.startsWith('!');
        const pattern = line.replace(/^!/, '').replace(/\/$/, '');
        if (pattern === '*' || file === pattern || file.startsWith(pattern + '/')) included = negated;
    }
    return included;
}

// Run the Dockerfile's `npm version` command the way a RUN instruction in
// shell form runs: `/bin/sh -c <command>`, with the build argument in the
// environment, in a directory holding copies of the files of the build
// context that the command uses. `version === undefined` leaves VERSION
// unset.
function runVersionStep(command, version) {
    const dir = mkTmp('hf-version-');
    for (const f of ['package.json', 'package-lock.json', checkScript]) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.copyFileSync(path.join(root, f), path.join(dir, f));
    }
    const env = Object.assign({}, process.env, {
        npm_config_update_notifier: 'false',
        npm_config_fund: 'false',
        npm_config_audit: 'false',
    });
    delete env.VERSION;
    if (version !== undefined) env.VERSION = version;
    const r = spawnSync('sh', ['-c', command], { cwd: dir, env, encoding: 'utf8' });
    if (r.error) throw r.error;
    return { status: r.status, output: r.stdout + r.stderr, dir };
}

// Environment for git and make in a scratch repository, built from parent
// (process.env by default) and isolated from the user's and the system's git
// configuration. Inherited GIT_* variables are dropped: GIT_DIR or
// GIT_WORK_TREE, as set inside a git hook, would point the scratch commits
// and tags at another repository. GIT_CEILING_DIRECTORIES stops git's search
// for a repository at the temporary directory, so a scratch directory without
// .git is outside any repository, also when the temporary directory lies
// inside one. MAKEFLAGS, MAKEOVERRIDES and GNUMAKEFLAGS are dropped: a make
// that runs this test passes its command-line variables, such as
// VERSION=..., and its options to the scratch make through MAKEFLAGS (which
// may refer to MAKEOVERRIDES), and GNUMAKEFLAGS set in the user's shell is
// read like MAKEFLAGS. Variables passed that way would override the
// Makefile's own values. MAKECMDGOALS is dropped: from the environment it
// would replace the goals that the scratch make reports, and the Makefile
// would then apply the checks of `make push` to every goal. RELEASE_TAG and
// PRERELEASE are dropped too: the Makefile reads them from the environment
// when they are not given on the command line.
function gitEnv(parent) {
    const inherited = Object.assign({}, parent || process.env);
    for (const key of Object.keys(inherited)) {
        if (key.startsWith('GIT_')) delete inherited[key];
    }
    for (const key of ['MAKEFLAGS', 'MAKEOVERRIDES', 'GNUMAKEFLAGS', 'MAKECMDGOALS']) {
        delete inherited[key];
    }
    const env = Object.assign(inherited, {
        GIT_CEILING_DIRECTORIES: os.tmpdir(),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
    });
    delete env.VERSION;
    delete env.RELEASE_TAG;
    delete env.PRERELEASE;
    return env;
}

function run(cmd, args, cwd, env) {
    const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
    if (r.error) throw r.error;
    assert.strictEqual(r.status, 0, cmd + ' ' + args.join(' ') + ' failed:\n' + r.stdout + r.stderr);
    return r.stdout.trim();
}

// Runs git in a scratch repository and returns its trimmed output.
function git(dir, ...args) {
    return run('git', args, dir, gitEnv());
}

// A scratch git repository with one commit, holding copies of the Makefile
// and the version check script, and tracked.txt, a file that tests modify to
// leave uncommitted changes.
function scratchRepo() {
    const dir = mkTmp('hf-make-');
    fs.copyFileSync(path.join(root, 'Makefile'), path.join(dir, 'Makefile'));
    fs.mkdirSync(path.join(dir, path.dirname(checkScript)));
    fs.copyFileSync(path.join(root, checkScript), path.join(dir, checkScript));
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'first\n');
    git(dir, 'init', '-q');
    git(dir, 'add', 'Makefile', checkScript, 'tracked.txt');
    git(dir, 'commit', '-q', '-m', 'first');
    return dir;
}

// A directory holding a fake `docker`: it appends its arguments, as a JSON
// array, to the file named by FAKE_DOCKER_LOG, and exits 0.
let fakeDockerDir = null;
function fakeDocker() {
    if (!fakeDockerDir) {
        fakeDockerDir = mkTmp('hf-docker-');
        fs.writeFileSync(path.join(fakeDockerDir, 'docker'),
            '#!' + process.execPath + '\n' +
            "require('fs').appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n",
            { mode: 0o755 });
    }
    return fakeDockerDir;
}

// The arguments of `make <target> <extraArgs>`; a null target runs make
// without a goal.
function makeArgs(target, extraArgs) {
    return (target === null ? [] : [target]).concat(extraArgs || []);
}

// Runs `make <target> <extraArgs>` for real in a scratch repository, with the
// fake docker first on PATH, and returns make's exit status and output and
// the arguments of each docker command, in order. parent is the environment
// the test would inherit, process.env by default.
function runMake(dir, target, extraArgs, parent) {
    const log = path.join(mkTmp('hf-docker-log-'), 'calls');
    fs.writeFileSync(log, '');
    const env = gitEnv(parent);
    env.PATH = fakeDocker() + path.delimiter + env.PATH;
    env.FAKE_DOCKER_LOG = log;
    const r = spawnSync('make', makeArgs(target, extraArgs), { cwd: dir, env, encoding: 'utf8' });
    if (r.error) throw r.error;
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
    return { status: r.status, output: r.stdout + r.stderr, calls };
}

// The docker commands that `make <target>` runs, for target image or push,
// after checking that make succeeded: the `docker build` arguments, the
// VERSION build argument, the tag that `docker tag` adds, and the images that
// `docker push` pushes.
const image = 'hyperflowwms/hyperflow';
function dockerCommands(dir, target, extraArgs, parent) {
    const r = runMake(dir, target, extraArgs, parent);
    assert.strictEqual(r.status, 0, 'make ' + target + ' failed:\n' + r.output);
    const build = r.calls.find((c) => c[0] === 'build');
    const tag = r.calls.find((c) => c[0] === 'tag');
    assert.ok(build, 'make ' + target + ' ran no docker build: ' + JSON.stringify(r.calls));
    assert.ok(tag, 'make ' + target + ' ran no docker tag: ' + JSON.stringify(r.calls));
    const i = build.indexOf('--build-arg');
    if (i >= 0) assert.ok(/^VERSION=/.test(build[i + 1]), 'unexpected build argument: ' + build[i + 1]);
    assert.strictEqual(tag[1], image, 'unexpected docker tag source: ' + JSON.stringify(tag));
    assert.ok(tag[2].startsWith(image + ':'), 'unexpected docker tag target: ' + JSON.stringify(tag));
    return {
        calls: r.calls,
        build: JSON.stringify(build),
        version: i >= 0 ? build[i + 1].replace(/^VERSION=/, '') : null,
        hasBuildArg: i >= 0,
        imageTag: tag[2].slice(image.length + 1),
        pushes: r.calls.filter((c) => c[0] === 'push').map((c) => c[1]),
    };
}

function makeImage(dir, extraArgs, parent) {
    return dockerCommands(dir, 'image', extraArgs, parent);
}

// Runs `make <target> <extraArgs>` for real in a scratch repository where it
// is expected to fail before any docker command, and returns its exit status
// and output.
function makeFails(dir, target, extraArgs) {
    const r = runMake(dir, target, extraArgs);
    const cmd = ['make'].concat(makeArgs(target, extraArgs)).join(' ');
    assert.notStrictEqual(r.status, 0, cmd + ' succeeded:\n' + r.output);
    assert.deepStrictEqual(r.calls, [], cmd + ' ran docker commands');
    return r;
}

// Runs `make -n <args>` in a scratch repository that is expected to refuse
// to run, and returns its exit status and output.
function makeRefused(dir, args) {
    const r = spawnSync('make', ['-n'].concat(args), { cwd: dir, env: gitEnv(), encoding: 'utf8' });
    if (r.error) throw r.error;
    const cmd = ['make', '-n'].concat(args).join(' ');
    assert.notStrictEqual(r.status, 0, cmd + ' ran:\n' + r.stdout + r.stderr);
    assert.ok(!/^docker /m.test(r.stdout), cmd + ' printed docker commands:\n' + r.stdout);
    return { status: r.status, stderr: r.stderr };
}

function main() {
    let n = 0;
    const ok = (msg) => console.log('ok ' + (++n) + ' - ' + msg);

    // The repository does not carry a released version.
    assert.deepStrictEqual(versionsIn(root), ['0.0.0-dev', '0.0.0-dev', '0.0.0-dev']);
    ok('package.json and package-lock.json hold 0.0.0-dev');

    // The version check: strict semver 2.0.0 without build metadata.
    {
        const check = (v) => spawnSync('sh', [checkScript, v], { cwd: root, encoding: 'utf8' });
        const valid = ['0.0.0', '1.11.2', '1.12.0-rc.1', '1.11.2-3-gabc1234', '1.11.2-3-gabc1234-dirty',
            '1.0.0-alpha.0', '1.0.0-0a', '1.0.0--'];
        for (const v of valid) {
            const r = check(v);
            assert.strictEqual(r.status, 0, checkScript + ' rejected ' + JSON.stringify(v) + ':\n' + r.stderr);
        }
        ok(checkScript + ' accepts ' + valid.join(', '));

        const invalid = ['', '1.12', '1.2.3.4', '1.12.03', '01.2.3', '1.02.3', '1.2.3-01', '1.2.3-a.01',
            'patch', 'major', 'minor', 'prerelease', 'from-git', '--help', '-h', '1.2.3+build',
            '1.2.3-', '1.2.3-a..b', '1.2.3.', 'v1.2.3', ' 1.2.3', '1.2.3 ', '1.2.3\njunk', 'junk\n1.2.3',
            '1.2.3\n', '1.2.3;x', '1.2.3$(x)', '1.2.3`x`', "1.2.3'", '1.2.3"'];
        for (const v of invalid) {
            const r = check(v);
            assert.strictEqual(r.status, 1, checkScript + ' accepted ' + JSON.stringify(v) + ' (exit ' + r.status + ')');
            assert.ok(/is not a valid version/.test(r.stderr), 'no message for ' + JSON.stringify(v) + ': ' + r.stderr);
        }
        ok(checkScript + ' rejects ' + invalid.map((v) => JSON.stringify(v)).join(', '));
    }

    // Dockerfile: ARG VERSION, then the npm version step, then npm install.
    const instr = dockerInstructions();
    const argIdx = instr.findIndex((i) => /^ARG\s+VERSION\s*$/.test(i));
    const stepIdx = instr.findIndex((i) => /^RUN\s/.test(i) && /npm version/.test(i));
    const installIdx = instr.findIndex((i) => /^RUN\s+npm install\s*$/.test(i));
    assert.ok(argIdx >= 0, 'Dockerfile declares no ARG VERSION');
    assert.ok(stepIdx >= 0, 'Dockerfile has no RUN instruction with npm version');
    assert.ok(installIdx >= 0, 'Dockerfile has no RUN npm install');
    assert.ok(argIdx < stepIdx && stepIdx < installIdx,
        'Dockerfile order must be ARG VERSION, npm version step, npm install');
    // An ARG above the FROM of its stage is not visible to that stage's RUN
    // instructions, and the image would silently report 0.0.0-dev.
    const fromIdx = instr.reduce((last, i, idx) => (idx < stepIdx && /^FROM\s/i.test(i)) ? idx : last, -1);
    assert.ok(fromIdx >= 0 && fromIdx < argIdx,
        'ARG VERSION must come after the FROM of the stage that runs npm version');
    const step = instr[stepIdx].replace(/^RUN\s+/, '');
    ok('Dockerfile declares ARG VERSION in its stage and runs npm version before npm install');

    assert.ok(inBuildContext(checkScript), '.dockerignore leaves ' + checkScript + ' out of the build context');
    ok('.dockerignore lets ' + checkScript + ' into the build context');

    for (const v of ['1.11.1', '1.11.1-1-g53bdb6f', '1.12.0-rc.1']) {
        const r = runVersionStep(step, v);
        assert.strictEqual(r.status, 0, 'npm version step failed for VERSION=' + v + ':\n' + r.output);
        assert.deepStrictEqual(versionsIn(r.dir), [v, v, v]);
        ok('VERSION=' + v + ' is written into package.json and package-lock.json');
    }

    for (const v of ['', undefined]) {
        const r = runVersionStep(step, v);
        const label = v === undefined ? 'unset' : 'empty';
        assert.strictEqual(r.status, 0, 'npm version step failed with VERSION ' + label + ':\n' + r.output);
        assert.deepStrictEqual(versionsIn(r.dir), ['0.0.0-dev', '0.0.0-dev', '0.0.0-dev']);
        ok('VERSION ' + label + ' keeps 0.0.0-dev');
    }

    {
        const r = runVersionStep(step, 'not-a-version');
        assert.notStrictEqual(r.status, 0, 'npm version step accepted an invalid VERSION:\n' + r.output);
        assert.deepStrictEqual(versionsIn(r.dir), ['0.0.0-dev', '0.0.0-dev', '0.0.0-dev']);
        ok('an invalid VERSION fails the step (exit ' + r.status + ')');
    }

    // Values that `npm version` alone would accept or act on, or that a
    // check matching line by line would let through: the version check
    // rejects each before npm version runs.
    for (const v of ['patch', '--help', '1.2.3+build', '01.2.3', '1.2.3-01', '1.12', '1.2.3\njunk']) {
        const r = runVersionStep(step, v);
        assert.notStrictEqual(r.status, 0, 'npm version step accepted VERSION=' + JSON.stringify(v) + ':\n' + r.output);
        assert.ok(/is not a valid version/.test(r.output),
            'the version check did not reject VERSION=' + JSON.stringify(v) + ':\n' + r.output);
        assert.deepStrictEqual(versionsIn(r.dir), ['0.0.0-dev', '0.0.0-dev', '0.0.0-dev']);
        ok('VERSION=' + JSON.stringify(v) + ' fails the step before npm version, 0.0.0-dev kept (exit ' + r.status + ')');
    }

    // Makefile, in scratch git repositories.
    const repo = scratchRepo();
    const firstCommit = git(repo, 'rev-parse', '--short', 'HEAD');

    {
        const m = makeImage(repo);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with no tag: ' + m.build);
        assert.strictEqual(m.imageTag, firstCommit);
        ok('no tag: no --build-arg, image tagged with the commit hash');
    }

    // `make push` publishes only an image with a version. Without a version
    // tag, make refuses to run it while it reads the Makefile, before any
    // docker command, also under `make -n` and `make -i`. It refuses `make`
    // and `make all` too, since the default goal, all, pushes. `make image`,
    // above, builds the image.
    for (const [target, extra] of [['push', []], [null, []], ['all', []], [null, ['-i', 'push']], ['image', ['push']]]) {
        const f = makeFails(repo, target, extra);
        assert.ok(/make push needs a version, and VERSION is empty/.test(f.output), f.output);
        ok('no tag: ' + ['make'].concat(makeArgs(target, extra)).join(' ') +
            ' refuses to run, before any docker command (exit ' + f.status + ')');
    }
    for (const args of [['push'], [], ['push', 'MAKECMDGOALS=image']]) {
        const f = makeRefused(repo, args);
        assert.ok(/make push needs a version, and VERSION is empty/.test(f.stderr), f.stderr);
        ok('no tag: ' + ['make', '-n'].concat(args).join(' ') + ' refuses to run (exit ' + f.status + ')');
    }

    // The environment variables through which VERSION=... could reach the
    // scratch make: MAKEFLAGS (with MAKEOVERRIDES) from a make that runs this
    // test, and GNUMAKEFLAGS from the user's shell.
    for (const parent of [
        { MAKEFLAGS: ' -- VERSION=6.6.6 TAG=parent' },
        { MAKEFLAGS: ' -- $(MAKEOVERRIDES)', MAKEOVERRIDES: 'VERSION=6.6.6 TAG=parent' },
        { GNUMAKEFLAGS: 'VERSION=6.6.6 TAG=parent' },
    ]) {
        const m = makeImage(repo, [], Object.assign({}, process.env, parent));
        const names = Object.keys(parent).join(' and ');
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with ' + names + ' inherited: ' + m.build);
        assert.strictEqual(m.imageTag, firstCommit, 'image tag with ' + names + ' inherited');
        ok('VERSION and TAG set through an inherited ' + names + ' do not reach the scratch make');
    }

    git(repo, 'tag', 'v9.8.7');
    {
        const m = makeImage(repo);
        assert.strictEqual(m.version, '9.8.7');
        assert.strictEqual(m.imageTag, 'v9.8.7');
        ok('on tag v9.8.7: --build-arg VERSION=9.8.7, image tagged v9.8.7');
    }

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    const described = git(repo, 'describe', '--tags');
    assert.ok(/^v9\.8\.7-1-g[0-9a-f]+$/.test(described), 'unexpected git describe output: ' + described);
    {
        const m = makeImage(repo);
        assert.strictEqual(m.version, described.replace(/^v/, ''));
        assert.strictEqual(m.imageTag, described);
        ok('one commit after the tag: --build-arg VERSION=' + m.version + ', image tagged ' + m.imageTag);
    }

    {
        const m = makeImage(repo, ['VERSION=']);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed for an empty VERSION: ' + m.build);
        ok('make image VERSION= passes no --build-arg');
    }

    // Only version tags count. This repository has tags without the "v",
    // such as 1.7.1, and tags of other names, such as prePersistence.
    {
        const r = scratchRepo();
        const commit = git(r, 'rev-parse', '--short', 'HEAD');
        git(r, 'tag', '1.7.1');
        const m = makeImage(r);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed for tag 1.7.1: ' + m.build);
        assert.strictEqual(m.imageTag, commit);
        ok('tag 1.7.1 without the v prefix is skipped: no --build-arg, image tagged with the commit hash');
    }

    {
        // Each nearer tag on a commit of its own, so that git describe would
        // pick it if it were not skipped: a lightweight prePersistence, then
        // an annotated v9.9 on a later commit.
        const r = scratchRepo();
        git(r, 'tag', 'v9.8.7');
        git(r, 'commit', '-q', '--allow-empty', '-m', 'second');
        git(r, 'tag', 'prePersistence');
        let expected = 'v9.8.7-1-g' + git(r, 'rev-parse', '--short', 'HEAD');
        let m = makeImage(r);
        assert.strictEqual(m.version, expected.replace(/^v/, ''));
        assert.strictEqual(m.imageTag, expected);
        ok('nearer lightweight tag prePersistence is skipped: --build-arg VERSION=' + m.version +
            ', image tagged ' + m.imageTag);

        git(r, 'commit', '-q', '--allow-empty', '-m', 'third');
        git(r, 'tag', '-a', '-m', 'annotated tag that is not a version tag', 'v9.9');
        expected = 'v9.8.7-2-g' + git(r, 'rev-parse', '--short', 'HEAD');
        m = makeImage(r);
        assert.strictEqual(m.version, expected.replace(/^v/, ''));
        assert.strictEqual(m.imageTag, expected);
        ok('nearer annotated tag v9.9 is skipped: --build-arg VERSION=' + m.version +
            ', image tagged ' + m.imageTag);
    }

    // Uncommitted changes to a tracked file add -dirty to the image tag and
    // to the version, and the Dockerfile's npm version step accepts that
    // version.
    {
        const r = scratchRepo();
        const tracked = path.join(r, 'tracked.txt');
        const first = git(r, 'rev-parse', '--short', 'HEAD');
        const dirtyVersions = [];
        fs.writeFileSync(path.join(r, 'untracked.txt'), 'untracked\n');
        let m = makeImage(r);
        assert.strictEqual(m.imageTag, first, 'an untracked file made the tree dirty: ' + m.imageTag);
        ok('untracked file only: image tagged ' + m.imageTag + ', no -dirty');

        fs.appendFileSync(tracked, 'changed\n');
        m = makeImage(r);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with no tag: ' + m.build);
        assert.strictEqual(m.imageTag, first + '-dirty');
        ok('no tag, tracked file modified: no --build-arg, image tagged ' + m.imageTag);

        git(r, 'tag', 'v9.8.7');
        m = makeImage(r);
        assert.strictEqual(m.version, '9.8.7-dirty');
        assert.strictEqual(m.imageTag, 'v9.8.7-dirty');
        dirtyVersions.push(m.version);
        ok('on tag v9.8.7, tracked file modified: --build-arg VERSION=9.8.7-dirty, image tagged v9.8.7-dirty');

        git(r, 'commit', '-q', '-a', '-m', 'second');
        const expected = 'v9.8.7-1-g' + git(r, 'rev-parse', '--short', 'HEAD') + '-dirty';
        fs.appendFileSync(tracked, 'changed again\n');
        m = makeImage(r);
        assert.strictEqual(m.version, expected.replace(/^v/, ''));
        assert.strictEqual(m.imageTag, expected);
        dirtyVersions.push(m.version);
        ok('one commit after the tag, tracked file modified: --build-arg VERSION=' + m.version +
            ', image tagged ' + m.imageTag);

        for (const v of dirtyVersions) {
            const s = runVersionStep(step, v);
            assert.strictEqual(s.status, 0, 'npm version step failed for VERSION=' + v + ':\n' + s.output);
            assert.deepStrictEqual(versionsIn(s.dir), [v, v, v]);
            ok('VERSION=' + v + ' from make is written into package.json and package-lock.json');
        }
    }

    // On a release, CI runs `make push RELEASE_TAG=<the release's tag>`, and
    // the release tag wins over another tag on the same commit: here an
    // annotated release candidate next to the lightweight tag that
    // `gh release create` makes, of which git describe picks the annotated.
    {
        const r = scratchRepo();
        git(r, 'tag', '-a', '-m', 'release candidate', 'v1.12.0-rc1');
        git(r, 'tag', 'v1.12.0');
        let m = makeImage(r);
        assert.strictEqual(m.version, '1.12.0-rc1');
        assert.strictEqual(m.imageTag, 'v1.12.0-rc1');
        ok('annotated v1.12.0-rc1 and lightweight v1.12.0 on one commit, no RELEASE_TAG: ' +
            '--build-arg VERSION=1.12.0-rc1, image tagged v1.12.0-rc1');

        m = makeImage(r, ['RELEASE_TAG=v1.12.0']);
        assert.strictEqual(m.version, '1.12.0');
        assert.strictEqual(m.imageTag, 'v1.12.0');
        ok('the same commit with RELEASE_TAG=v1.12.0: --build-arg VERSION=1.12.0, image tagged v1.12.0');
    }

    // The released image is pushed as latest and as exactly the release tag:
    // other repositories find new engine images with the pattern
    // hyperflowwms/hyperflow:v<major>.<minor>.<patch>, without a suffix.
    {
        const r = scratchRepo();
        git(r, 'tag', 'v1.11.2');
        // A reference without a tag, the first push, is :latest.
        const expectedCalls = [
            ['build', '--no-cache', '--build-arg', 'VERSION=1.11.2', '-t', 'hyperflowwms/hyperflow', '.'],
            ['tag', 'hyperflowwms/hyperflow', 'hyperflowwms/hyperflow:v1.11.2'],
            ['push', 'hyperflowwms/hyperflow'],
            ['push', 'hyperflowwms/hyperflow:v1.11.2'],
        ];
        let m = dockerCommands(r, 'push', ['RELEASE_TAG=v1.11.2']);
        assert.deepStrictEqual(m.calls, expectedCalls);
        ok('make push RELEASE_TAG=v1.11.2: --build-arg VERSION=1.11.2, pushes ' + m.pushes.join(' and '));

        // As CI runs it for a release that is not a pre-release.
        m = dockerCommands(r, 'push', ['RELEASE_TAG=v1.11.2', 'PRERELEASE=false']);
        assert.deepStrictEqual(m.calls, expectedCalls);
        ok('make push RELEASE_TAG=v1.11.2 PRERELEASE=false: the same four docker commands');

        m = dockerCommands(r, 'push');
        assert.deepStrictEqual(m.calls, expectedCalls);
        ok('make push on tag v1.11.2 without RELEASE_TAG: the same four docker commands');

        // The recipes refer to "$VERSION" and "$TAG"; make prints the values
        // themselves, so that a dry run shows them.
        const dry = run('make', ['-n', 'push', 'RELEASE_TAG=v1.11.2'], r, gitEnv());
        assert.ok(dry.split('\n').includes('Image tag: v1.11.2; version: 1.11.2'), 'make -n push printed:\n' + dry);
        ok('make -n push RELEASE_TAG=v1.11.2 prints "Image tag: v1.11.2; version: 1.11.2"');

        fs.appendFileSync(path.join(r, 'tracked.txt'), 'changed\n');
        m = dockerCommands(r, 'push', ['RELEASE_TAG=v1.11.2']);
        assert.ok(!/dirty/.test(JSON.stringify(m.calls)), 'make push passed -dirty with RELEASE_TAG set: ' +
            JSON.stringify(m.calls));
        assert.deepStrictEqual(m.calls, expectedCalls);
        ok('make push RELEASE_TAG=v1.11.2, tracked file modified: no -dirty anywhere');

        // RELEASE_TAG must be one of the tags on the checked-out commit.
        let f = makeRefused(r, ['push', 'RELEASE_TAG=v1.11.3']);
        assert.ok(/RELEASE_TAG=v1\.11\.3 is not a tag on the checked-out commit/.test(f.stderr), f.stderr);
        ok('make push RELEASE_TAG=v1.11.3, no such tag: make refuses to run (exit ' + f.status + ')');

        f = makeRefused(r, ['push', 'RELEASE_TAG=v1.11.3', 'HEAD_TAGS=v1.11.3', 'RELEASE_TAG_AT_HEAD=v1.11.3']);
        assert.ok(/RELEASE_TAG=v1\.11\.3 is not a tag on the checked-out commit/.test(f.stderr), f.stderr);
        ok('make push RELEASE_TAG=v1.11.3 with the check\'s variables set on the command line: make still refuses (exit ' +
            f.status + ')');

        f = makeRefused(r, ['push', 'RELEASE_TAG=v1.11']);
        assert.ok(/RELEASE_TAG=v1\.11 is not a tag on the checked-out commit/.test(f.stderr), f.stderr);
        ok('make push RELEASE_TAG=v1.11, a prefix of the tag on HEAD: make refuses to run (exit ' + f.status + ')');

        // With RELEASE_TAG set, make push refuses a VERSION or TAG given on
        // the command line that differs from what RELEASE_TAG gives, before
        // any docker command, also under make -n.
        for (const [extra, message] of [
            ['VERSION=1.2.3', /VERSION=1\.2\.3 does not match RELEASE_TAG=v1\.11\.2/],
            ['TAG=other', /TAG=other does not match RELEASE_TAG=v1\.11\.2/],
        ]) {
            f = makeFails(r, 'push', ['RELEASE_TAG=v1.11.2', extra]);
            assert.ok(message.test(f.output), f.output);
            const dry = makeRefused(r, ['push', 'RELEASE_TAG=v1.11.2', extra]);
            assert.ok(message.test(dry.stderr), dry.stderr);
            ok('make push RELEASE_TAG=v1.11.2 ' + extra + ': make refuses to run, also under make -n (exit ' +
                f.status + ')');
        }

        git(r, 'commit', '-q', '-a', '-m', 'second');
        f = makeRefused(r, ['push', 'RELEASE_TAG=v1.11.2']);
        assert.ok(/RELEASE_TAG=v1\.11\.2 is not a tag on the checked-out commit/.test(f.stderr), f.stderr);
        ok('make push RELEASE_TAG=v1.11.2 one commit after the tag: make refuses to run (exit ' + f.status + ')');
    }

    // A GitHub pre-release pushes only its own tag and does not move latest.
    // CI runs `make push RELEASE_TAG=<tag> PRERELEASE=true` for a pre-release
    // and PRERELEASE=false for any other release. With PRERELEASE=false, or
    // without PRERELEASE, make push pushes latest too. Any other value of
    // PRERELEASE is refused while make reads the Makefile.
    {
        const r = scratchRepo();
        git(r, 'tag', 'v1.11.2-rc.1');
        const rcImage = image + ':v1.11.2-rc.1';
        const build = ['build', '--no-cache', '--build-arg', 'VERSION=1.11.2-rc.1', '-t', image, '.'];
        const tag = ['tag', image, rcImage];
        // A reference without a tag, the image name alone, is :latest.
        const latestPushes = (pushes) => pushes.filter((p) => p === image || p === image + ':latest');

        let m = dockerCommands(r, 'push', ['RELEASE_TAG=v1.11.2-rc.1', 'PRERELEASE=true']);
        assert.deepStrictEqual(latestPushes(m.pushes), [], 'a pre-release pushed latest: ' + JSON.stringify(m.calls));
        assert.deepStrictEqual(m.calls, [build, tag, ['push', rcImage]]);
        ok('make push RELEASE_TAG=v1.11.2-rc.1 PRERELEASE=true: --build-arg VERSION=1.11.2-rc.1, image tagged ' +
            'v1.11.2-rc.1, pushes only ' + rcImage);

        // PUSH_LATEST=yes on the command line does not override the decision
        // that the Makefile takes from PRERELEASE.
        m = dockerCommands(r, 'push', ['RELEASE_TAG=v1.11.2-rc.1', 'PRERELEASE=true', 'PUSH_LATEST=yes']);
        assert.deepStrictEqual(m.calls, [build, tag, ['push', rcImage]]);
        ok('make push RELEASE_TAG=v1.11.2-rc.1 PRERELEASE=true PUSH_LATEST=yes: still pushes only ' + rcImage);

        const fourCalls = [build, tag, ['push', image], ['push', rcImage]];
        for (const extra of [['PRERELEASE=false'], []]) {
            m = dockerCommands(r, 'push', ['RELEASE_TAG=v1.11.2-rc.1'].concat(extra));
            assert.deepStrictEqual(m.calls, fourCalls);
            ok('make push RELEASE_TAG=v1.11.2-rc.1' + (extra.length ? ' ' + extra.join(' ') : ', no PRERELEASE') +
                ': pushes ' + m.pushes.join(' and '));
        }

        // make -n push shows whether the image is pushed as latest.
        for (const [extra, line] of [
            [['PRERELEASE=true'], 'Push latest: no (PRERELEASE=true)'],
            [['PRERELEASE=false'], 'Push latest: yes'],
            [[], 'Push latest: yes'],
        ]) {
            const args = ['-n', 'push', 'RELEASE_TAG=v1.11.2-rc.1'].concat(extra);
            const dry = run('make', args, r, gitEnv()).split('\n');
            assert.ok(dry.includes('Image tag: v1.11.2-rc.1; version: 1.11.2-rc.1'), 'make ' + args.join(' ') +
                ' printed:\n' + dry.join('\n'));
            assert.ok(dry.includes(line), 'make ' + args.join(' ') + ' printed:\n' + dry.join('\n'));
            const latestLine = dry.some((l) => /^docker push hyperflowwms\/hyperflow(\s|$)/.test(l));
            assert.strictEqual(latestLine, line === 'Push latest: yes', 'make ' + args.join(' ') + ' printed:\n' +
                dry.join('\n'));
            ok('make ' + args.join(' ') + ' prints "' + line + '"');
        }

        // Values other than "true" and "false", an empty one and one with
        // trailing whitespace included, are refused before any docker
        // command, also under make -n. "$(shell ...)" would create a file
        // named pwned-prerelease if make expanded the value.
        for (const value of ['yes', 'no', 'True', 'TRUE', 'FALSE', '1', '0', 'ture', '', 'false ', 'true false',
            '$(shell touch pwned-prerelease)']) {
            const args = ['RELEASE_TAG=v1.11.2-rc.1', 'PRERELEASE=' + value];
            const message = 'PRERELEASE=' + value + ' is neither "true" nor "false"';
            const f = makeFails(r, 'push', args);
            assert.ok(f.output.includes(message), f.output);
            const dry = makeRefused(r, ['push'].concat(args));
            assert.ok(dry.stderr.includes(message), dry.stderr);
            assert.deepStrictEqual(fs.readdirSync(r).filter((name) => name.startsWith('pwned')), []);
            ok('make push RELEASE_TAG=v1.11.2-rc.1 PRERELEASE=' + JSON.stringify(value) +
                ': make refuses to run, before any docker command, also under make -n (exit ' + f.status + ')');
        }
        for (const [target, extra] of [[null, ['-i', 'push']], [null, []], ['push', []]]) {
            const f = makeFails(r, target, extra.concat(['PRERELEASE=yes']));
            assert.ok(/PRERELEASE=yes is neither "true" nor "false"/.test(f.output), f.output);
            ok(['make'].concat(makeArgs(target, extra), ['PRERELEASE=yes']).join(' ') +
                ', no RELEASE_TAG: make refuses to run, before any docker command (exit ' + f.status + ')');
        }

        // make image pushes nothing and does not read PRERELEASE.
        m = makeImage(r, ['PRERELEASE=yes']);
        assert.deepStrictEqual(m.calls, [build, tag]);
        ok('make image PRERELEASE=yes: builds and tags, pushes nothing');

        // The version alone does not make a pre-release: between releases,
        // git describe gives a version such as 1.11.2-rc.1-1-gabc1234, a
        // semver pre-release, and a make push without PRERELEASE there still
        // pushes latest.
        git(r, 'commit', '-q', '--allow-empty', '-m', 'second');
        const described = git(r, 'describe', '--tags');
        assert.ok(/^v1\.11\.2-rc\.1-1-g[0-9a-f]+$/.test(described), 'unexpected git describe output: ' + described);
        m = dockerCommands(r, 'push');
        assert.strictEqual(m.version, described.slice(1));
        assert.deepStrictEqual(m.pushes, [image, image + ':' + described]);
        ok('make push one commit after v1.11.2-rc.1, no PRERELEASE: --build-arg VERSION=' + m.version +
            ', pushes ' + m.pushes.join(' and '));
    }

    // A malformed version fails `make image` at the version check, before any
    // docker command, whether git describe or RELEASE_TAG supplies it. git
    // describe skips vpatch, which does not match v[0-9]*.[0-9]*.[0-9]*.
    {
        const r = scratchRepo();
        const commit = git(r, 'rev-parse', '--short', 'HEAD');
        git(r, 'tag', 'vpatch');
        const m = makeImage(r);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed for tag vpatch: ' + m.build);
        assert.strictEqual(m.imageTag, commit);
        ok('tag vpatch on HEAD, no RELEASE_TAG: git describe skips it, no --build-arg, image tagged with the commit hash');

        let f = makeFails(r, 'push', ['RELEASE_TAG=vpatch']);
        assert.ok(/"patch" is not a valid version/.test(f.output), f.output);
        ok('make push RELEASE_TAG=vpatch fails at the version check, before any docker command (exit ' + f.status + ')');

        git(r, 'tag', 'v1.12.03');
        f = makeFails(r, 'image');
        assert.ok(/"1\.12\.03" is not a valid version/.test(f.output), f.output);
        ok('tag v1.12.03 on HEAD, no RELEASE_TAG: make image fails at the version check, before any docker command (exit ' +
            f.status + ')');

        f = makeFails(r, 'push', ['RELEASE_TAG=v1.12.03']);
        assert.ok(/"1\.12\.03" is not a valid version/.test(f.output), f.output);
        ok('make push RELEASE_TAG=v1.12.03 fails at the version check, before any docker command (exit ' + f.status + ')');

        // The release image must be tagged v<version>.
        git(r, 'tag', '1.7.1');
        f = makeRefused(r, ['push', 'RELEASE_TAG=1.7.1']);
        assert.ok(/RELEASE_TAG=1\.7\.1 does not start with "v"/.test(f.stderr), f.stderr);
        ok('make push RELEASE_TAG=1.7.1, a tag on HEAD without the v: make refuses to run (exit ' + f.status + ')');

        // With RELEASE_TAG set, an empty version, from a tag named "v" or from
        // VERSION= on the command line, is refused: by make while it reads
        // the Makefile for make push, also under make -n and make -i, and by
        // the version check for make image.
        git(r, 'tag', 'v');
        for (const args of [['push', 'RELEASE_TAG=v'], ['-i', 'push', 'RELEASE_TAG=v']]) {
            f = makeFails(r, null, args);
            assert.ok(/RELEASE_TAG=v has an empty version/.test(f.output), f.output);
            ok(['make'].concat(args).join(' ') +
                ', a tag on HEAD with an empty version: make refuses to run, before any docker command (exit ' +
                f.status + ')');
        }
        f = makeRefused(r, ['push', 'RELEASE_TAG=v']);
        assert.ok(/RELEASE_TAG=v has an empty version/.test(f.stderr), f.stderr);
        ok('make -n push RELEASE_TAG=v: make refuses to run (exit ' + f.status + ')');

        f = makeFails(r, 'image', ['RELEASE_TAG=v']);
        assert.ok(/"" is not a valid version/.test(f.output), f.output);
        ok('make image RELEASE_TAG=v: fails at the version check, before any docker command (exit ' + f.status + ')');

        git(r, 'tag', 'v1.11.2');
        f = makeFails(r, 'push', ['RELEASE_TAG=v1.11.2', 'VERSION=']);
        assert.ok(/VERSION= does not match RELEASE_TAG=v1\.11\.2/.test(f.output), f.output);
        ok('make push RELEASE_TAG=v1.11.2 VERSION=: make refuses to run, before any docker command (exit ' +
            f.status + ')');

        f = makeFails(r, 'image', ['RELEASE_TAG=v1.11.2', 'VERSION=']);
        assert.ok(/"" is not a valid version/.test(f.output), f.output);
        ok('make image RELEASE_TAG=v1.11.2 VERSION=: fails at the version check, before any docker command (exit ' +
            f.status + ')');

        // A VERSION given on the command line would otherwise pass the
        // version check in place of the tag's own, as for a tag vfoo.
        git(r, 'tag', 'vfoo');
        f = makeFails(r, 'push', ['RELEASE_TAG=vfoo', 'VERSION=1.2.3']);
        assert.ok(/VERSION=1\.2\.3 does not match RELEASE_TAG=vfoo/.test(f.output), f.output);
        ok('make push RELEASE_TAG=vfoo VERSION=1.2.3: make refuses to run, before any docker command (exit ' +
            f.status + ')');
    }

    // Outside a git checkout, as in a source archive, git describe finds no
    // commit, and the image tag would be empty: make refuses to build the
    // image, before any docker command, unless TAG is given.
    {
        const dir = mkTmp('hf-archive-');
        fs.copyFileSync(path.join(root, 'Makefile'), path.join(dir, 'Makefile'));
        fs.mkdirSync(path.join(dir, path.dirname(checkScript)));
        fs.copyFileSync(path.join(root, checkScript), path.join(dir, checkScript));
        const g = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: dir, env: gitEnv(), encoding: 'utf8' });
        assert.notStrictEqual(g.status, 0, dir + ' is inside a git repository: ' + g.stdout);
        for (const target of ['image', 'push']) {
            const f = makeFails(dir, target);
            assert.ok(/The image tag is empty/.test(f.output), f.output);
            ok('outside a git checkout: make ' + target + ' refuses to run, before any docker command (exit ' +
                f.status + ')');
        }
        const f = makeRefused(dir, ['image']);
        assert.ok(/The image tag is empty/.test(f.stderr), f.stderr);
        ok('outside a git checkout: make -n image refuses to run (exit ' + f.status + ')');

        const m = makeImage(dir, ['TAG=local']);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed outside a git checkout: ' + m.build);
        assert.strictEqual(m.imageTag, 'local');
        ok('outside a git checkout: make image TAG=local passes no --build-arg, image tagged local');
    }

    // Tag names with characters that a shell interprets. Each payload would
    // create a file named pwned-* in the repository if a shell ran it, and
    // "$(oops" would stop make with an unterminated variable reference if make
    // expanded it. make fails at the version check, which reports the version
    // exactly as the tag has it, before any docker command, and nothing in the
    // tag runs, whether git describe or RELEASE_TAG supplies it.
    for (const tag of [
        'v1.2.3;>pwned-semicolon',
        'v1.2.3$(>pwned-dollar)',
        'v1.2.3`>pwned-backquote`',
        "v1.2.3';>pwned-quote;'",
        'v1.2.3";>pwned-dquote;"',
        'v1.2.3$(oops',
    ]) {
        const r = scratchRepo();
        git(r, 'tag', tag);
        for (const args of [[], ['RELEASE_TAG=' + tag]]) {
            const f = makeFails(r, 'push', args);
            assert.ok(f.output.includes('"' + tag.slice(1) + '" is not a valid version'),
                'make push ' + args.join(' ') + ' did not fail at the version check:\n' + f.output);
            const created = fs.readdirSync(r).filter((name) => name.startsWith('pwned'));
            assert.deepStrictEqual(created, [], 'the tag ' + tag + ' ran: ' + created.join(', '));
        }
        ok('tag ' + tag + ': make push fails at the version check and runs nothing, from git describe and as RELEASE_TAG');
    }

    console.log('all version tests passed');
}

let failed = false;
try {
    main();
} catch (err) {
    console.error(err);
    failed = true;
} finally {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
