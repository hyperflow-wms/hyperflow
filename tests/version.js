/**
 * Tests for the version that the engine image reports with `hflow --version`.
 *
 * The git tag is the only place a version is set. `make image` takes the
 * nearest version tag (a tag matching v[0-9]*.[0-9]*.[0-9]*) as
 * `git describe --tags --dirty` reports it, tags the image with it, and
 * passes it without its leading "v" to `docker build` as the VERSION build
 * argument. On a release, CI runs `make push RELEASE_TAG=<tag>`, and the
 * image tag and the version come from RELEASE_TAG instead. The Dockerfile
 * writes VERSION into package.json with `npm version` before `npm install`.
 * The repository's package.json holds 0.0.0-dev.
 *
 * The Dockerfile part runs the Dockerfile's own `npm version` RUN command
 * under sh, on copies of package.json and package-lock.json in a directory
 * without .git, as `docker build` would. The Makefile part runs
 * `make -n image` and `make -n push` in scratch git repositories holding a
 * copy of the Makefile, so the result does not depend on the tags or the
 * uncommitted changes of this checkout.
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

// Environment for git and make in a scratch repository, built from parent
// (process.env by default) and isolated from the user's and the system's git
// configuration. Inherited GIT_* variables are dropped: GIT_DIR or
// GIT_WORK_TREE, as set inside a git hook, would point the scratch commits
// and tags at another repository. MAKEFLAGS, MAKEOVERRIDES and GNUMAKEFLAGS
// are dropped: a make that runs this test passes its command-line variables,
// such as VERSION=..., and its options to the scratch make through MAKEFLAGS
// (which may refer to MAKEOVERRIDES), and GNUMAKEFLAGS set in the user's
// shell is read like MAKEFLAGS. Variables passed that way would override the
// Makefile's own values. RELEASE_TAG is dropped too: the Makefile reads it
// from the environment when it is not given on the command line.
function gitEnv(parent) {
    const inherited = Object.assign({}, parent || process.env);
    for (const key of Object.keys(inherited)) {
        if (key.startsWith('GIT_')) delete inherited[key];
    }
    for (const key of ['MAKEFLAGS', 'MAKEOVERRIDES', 'GNUMAKEFLAGS']) {
        delete inherited[key];
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
    delete env.RELEASE_TAG;
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

// A scratch git repository with one commit, holding a copy of the Makefile
// and tracked.txt, a file that tests modify to leave uncommitted changes.
function scratchRepo() {
    const dir = mkTmp('hf-make-');
    fs.copyFileSync(path.join(root, 'Makefile'), path.join(dir, 'Makefile'));
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'first\n');
    git(dir, 'init', '-q');
    git(dir, 'add', 'Makefile', 'tracked.txt');
    git(dir, 'commit', '-q', '-m', 'first');
    return dir;
}

// The docker commands that `make -n <target>` prints, for target image or
// push: the `docker build` line, the VERSION build argument, the tag that
// `docker tag` adds, and the images that `docker push` pushes. parent is the
// environment the test would inherit, process.env by default.
function makeDryRun(dir, target, extraArgs, parent) {
    const out = run('make', ['-n', target].concat(extraArgs || []), dir, gitEnv(parent));
    const lines = out.split('\n');
    const build = lines.find((l) => l.startsWith('docker build'));
    const tag = lines.find((l) => l.startsWith('docker tag'));
    assert.ok(build, 'no docker build line in make -n ' + target + ' output:\n' + out);
    assert.ok(tag, 'no docker tag line in make -n ' + target + ' output:\n' + out);
    const buildArg = build.match(/--build-arg\s+VERSION=(\S+)/);
    const imageTag = tag.match(/^docker tag \S+ \S+:(\S+)/);
    assert.ok(imageTag, 'unexpected docker tag line: ' + tag);
    return {
        out,
        build,
        version: buildArg ? buildArg[1] : null,
        hasBuildArg: /--build-arg/.test(build),
        imageTag: imageTag[1],
        pushes: lines.filter((l) => l.startsWith('docker push')).map((l) => l.split(/\s+/)[2]),
    };
}

function makeImageDryRun(dir, extraArgs, parent) {
    return makeDryRun(dir, 'image', extraArgs, parent);
}

// Runs `make -n <args>` in a scratch repository that is expected to refuse
// to run, and returns its exit status and output.
function makeRefused(dir, args) {
    const r = spawnSync('make', ['-n'].concat(args), { cwd: dir, env: gitEnv(), encoding: 'utf8' });
    if (r.error) throw r.error;
    assert.notStrictEqual(r.status, 0, 'make -n ' + args.join(' ') + ' ran:\n' + r.stdout + r.stderr);
    assert.ok(!/^docker /m.test(r.stdout), 'make -n ' + args.join(' ') + ' printed docker commands:\n' + r.stdout);
    return { status: r.status, stderr: r.stderr };
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

    // Makefile, in scratch git repositories.
    const repo = scratchRepo();
    const firstCommit = git(repo, 'rev-parse', '--short', 'HEAD');

    {
        const m = makeImageDryRun(repo);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with no tag: ' + m.build);
        assert.strictEqual(m.imageTag, firstCommit);
        ok('no tag: no --build-arg, image tagged with the commit hash');
    }

    // The environment variables through which VERSION=... could reach the
    // scratch make: MAKEFLAGS (with MAKEOVERRIDES) from a make that runs this
    // test, and GNUMAKEFLAGS from the user's shell.
    for (const parent of [
        { MAKEFLAGS: ' -- VERSION=6.6.6 TAG=parent' },
        { MAKEFLAGS: ' -- $(MAKEOVERRIDES)', MAKEOVERRIDES: 'VERSION=6.6.6 TAG=parent' },
        { GNUMAKEFLAGS: 'VERSION=6.6.6 TAG=parent' },
    ]) {
        const m = makeImageDryRun(repo, [], Object.assign({}, process.env, parent));
        const names = Object.keys(parent).join(' and ');
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with ' + names + ' inherited: ' + m.build);
        assert.strictEqual(m.imageTag, firstCommit, 'image tag with ' + names + ' inherited');
        ok('VERSION and TAG set through an inherited ' + names + ' do not reach the scratch make');
    }

    git(repo, 'tag', 'v9.8.7');
    {
        const m = makeImageDryRun(repo);
        assert.strictEqual(m.version, '9.8.7');
        assert.strictEqual(m.imageTag, 'v9.8.7');
        ok('on tag v9.8.7: --build-arg VERSION=9.8.7, image tagged v9.8.7');
    }

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'second');
    const described = git(repo, 'describe', '--tags');
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

    // Only version tags count. This repository has tags without the "v",
    // such as 1.7.1, and tags of other names, such as prePersistence.
    {
        const r = scratchRepo();
        const commit = git(r, 'rev-parse', '--short', 'HEAD');
        git(r, 'tag', '1.7.1');
        const m = makeImageDryRun(r);
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
        let m = makeImageDryRun(r);
        assert.strictEqual(m.version, expected.replace(/^v/, ''));
        assert.strictEqual(m.imageTag, expected);
        ok('nearer lightweight tag prePersistence is skipped: --build-arg VERSION=' + m.version +
            ', image tagged ' + m.imageTag);

        git(r, 'commit', '-q', '--allow-empty', '-m', 'third');
        git(r, 'tag', '-a', '-m', 'annotated tag that is not a version tag', 'v9.9');
        expected = 'v9.8.7-2-g' + git(r, 'rev-parse', '--short', 'HEAD');
        m = makeImageDryRun(r);
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
        let m = makeImageDryRun(r);
        assert.strictEqual(m.imageTag, first, 'an untracked file made the tree dirty: ' + m.imageTag);
        ok('untracked file only: image tagged ' + m.imageTag + ', no -dirty');

        fs.appendFileSync(tracked, 'changed\n');
        m = makeImageDryRun(r);
        assert.strictEqual(m.hasBuildArg, false, 'build argument passed with no tag: ' + m.build);
        assert.strictEqual(m.imageTag, first + '-dirty');
        ok('no tag, tracked file modified: no --build-arg, image tagged ' + m.imageTag);

        git(r, 'tag', 'v9.8.7');
        m = makeImageDryRun(r);
        assert.strictEqual(m.version, '9.8.7-dirty');
        assert.strictEqual(m.imageTag, 'v9.8.7-dirty');
        dirtyVersions.push(m.version);
        ok('on tag v9.8.7, tracked file modified: --build-arg VERSION=9.8.7-dirty, image tagged v9.8.7-dirty');

        git(r, 'commit', '-q', '-a', '-m', 'second');
        const expected = 'v9.8.7-1-g' + git(r, 'rev-parse', '--short', 'HEAD') + '-dirty';
        fs.appendFileSync(tracked, 'changed again\n');
        m = makeImageDryRun(r);
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
        let m = makeImageDryRun(r);
        assert.strictEqual(m.version, '1.12.0-rc1');
        assert.strictEqual(m.imageTag, 'v1.12.0-rc1');
        ok('annotated v1.12.0-rc1 and lightweight v1.12.0 on one commit, no RELEASE_TAG: ' +
            '--build-arg VERSION=1.12.0-rc1, image tagged v1.12.0-rc1');

        m = makeImageDryRun(r, ['RELEASE_TAG=v1.12.0']);
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
        const expectedPushes = ['hyperflowwms/hyperflow', 'hyperflowwms/hyperflow:v1.11.2'];
        let m = makeDryRun(r, 'push', ['RELEASE_TAG=v1.11.2']);
        assert.strictEqual(m.version, '1.11.2');
        assert.deepStrictEqual(m.pushes, expectedPushes);
        ok('make push RELEASE_TAG=v1.11.2: --build-arg VERSION=1.11.2, pushes ' + m.pushes.join(' and '));

        fs.appendFileSync(path.join(r, 'tracked.txt'), 'changed\n');
        m = makeDryRun(r, 'push', ['RELEASE_TAG=v1.11.2']);
        assert.ok(!/dirty/.test(m.out), 'make -n push printed -dirty with RELEASE_TAG set:\n' + m.out);
        assert.strictEqual(m.version, '1.11.2');
        assert.strictEqual(m.imageTag, 'v1.11.2');
        assert.deepStrictEqual(m.pushes, expectedPushes);
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

        git(r, 'commit', '-q', '-a', '-m', 'second');
        f = makeRefused(r, ['push', 'RELEASE_TAG=v1.11.2']);
        assert.ok(/RELEASE_TAG=v1\.11\.2 is not a tag on the checked-out commit/.test(f.stderr), f.stderr);
        ok('make push RELEASE_TAG=v1.11.2 one commit after the tag: make refuses to run (exit ' + f.status + ')');
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
