/**
 * Tests for the version that the engine image reports with `hflow --version`.
 *
 * The git tag is the only place a version is set. `make image` passes the
 * nearest tag, without its leading "v", to `docker build` as the VERSION
 * build argument, and the Dockerfile writes it into package.json with
 * `npm version` before `npm install`. The repository's package.json holds
 * 0.0.0-dev.
 *
 * The Dockerfile part runs the Dockerfile's own `npm version` RUN command
 * under sh, on copies of package.json and package-lock.json in a directory
 * without .git, as `docker build` would. The Makefile part runs
 * `make -n image` in a scratch git repository holding a copy of the
 * Makefile, so the result does not depend on the tags of this checkout.
 *
 * Needs sh, npm, make and git; no Docker and no network.
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

// Run the Dockerfile's `npm version` command the way a RUN instruction in
// shell form runs: `/bin/sh -c <command>`, with the build argument in the
// environment. `version === undefined` leaves VERSION unset.
function runVersionStep(command, version) {
    const dir = mkTmp('hf-version-');
    for (const f of ['package.json', 'package-lock.json']) {
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

// Environment for git and make in the scratch repository, isolated from the
// user's and the system's git configuration. Inherited GIT_* variables are
// dropped: GIT_DIR or GIT_WORK_TREE, as set inside a git hook, would point
// the scratch commits and tags at another repository.
function gitEnv() {
    const inherited = Object.assign({}, process.env);
    for (const key of Object.keys(inherited)) {
        if (key.startsWith('GIT_')) delete inherited[key];
    }
    const env = Object.assign(inherited, {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
    });
    delete env.VERSION;
    return env;
}

function run(cmd, args, cwd, env) {
    const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
    if (r.error) throw r.error;
    assert.strictEqual(r.status, 0, cmd + ' ' + args.join(' ') + ' failed:\n' + r.stdout + r.stderr);
    return r.stdout.trim();
}

// The `docker build` and `docker tag` lines that `make -n image` prints.
function makeImageDryRun(dir, extraArgs) {
    const out = run('make', ['-n', 'image'].concat(extraArgs || []), dir, gitEnv());
    const lines = out.split('\n');
    const build = lines.find((l) => l.startsWith('docker build'));
    const tag = lines.find((l) => l.startsWith('docker tag'));
    assert.ok(build, 'no docker build line in make -n image output:\n' + out);
    assert.ok(tag, 'no docker tag line in make -n image output:\n' + out);
    const buildArg = build.match(/--build-arg\s+VERSION=(\S+)/);
    const imageTag = tag.match(/^docker tag \S+ \S+:(\S+)/);
    assert.ok(imageTag, 'unexpected docker tag line: ' + tag);
    return {
        build,
        version: buildArg ? buildArg[1] : null,
        hasBuildArg: /--build-arg/.test(build),
        imageTag: imageTag[1],
    };
}

function main() {
    let n = 0;
    const ok = (msg) => console.log('ok ' + (++n) + ' - ' + msg);

    // The repository does not carry a released version.
    assert.deepStrictEqual(versionsIn(root), ['0.0.0-dev', '0.0.0-dev', '0.0.0-dev']);
    ok('package.json and package-lock.json hold 0.0.0-dev');

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

    for (const v of ['1.11.1', '1.11.1-1-g53bdb6f']) {
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

    // Makefile, in a scratch git repository.
    const repo = mkTmp('hf-make-');
    fs.copyFileSync(path.join(root, 'Makefile'), path.join(repo, 'Makefile'));
    const env = gitEnv();
    run('git', ['init', '-q'], repo, env);
    run('git', ['add', 'Makefile'], repo, env);
    run('git', ['commit', '-q', '-m', 'first'], repo, env);
    const firstCommit = run('git', ['rev-parse', '--short', 'HEAD'], repo, env);

    {
        const m = makeImageDryRun(repo);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with no tag: ' + m.build);
        assert.strictEqual(m.imageTag, firstCommit);
        ok('no tag: no --build-arg, image tagged with the commit hash');
    }

    run('git', ['tag', 'v9.8.7'], repo, env);
    {
        const m = makeImageDryRun(repo);
        assert.strictEqual(m.version, '9.8.7');
        assert.strictEqual(m.imageTag, 'v9.8.7');
        ok('on tag v9.8.7: --build-arg VERSION=9.8.7, image tagged v9.8.7');
    }

    run('git', ['commit', '-q', '--allow-empty', '-m', 'second'], repo, env);
    const described = run('git', ['describe', '--tags'], repo, env);
    assert.ok(/^v9\.8\.7-1-g[0-9a-f]+$/.test(described), 'unexpected git describe output: ' + described);
    {
        const m = makeImageDryRun(repo);
        assert.strictEqual(m.version, described.replace(/^v/, ''));
        assert.strictEqual(m.imageTag, described);
        ok('one commit after the tag: --build-arg VERSION=' + m.version + ', image tagged ' + m.imageTag);
    }

    {
        const m = makeImageDryRun(repo, ['VERSION=']);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed for an empty VERSION: ' + m.build);
        ok('make image VERSION= passes no --build-arg');
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
