const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {installBundle} = require('../../scripts/install-mac-app');
const {computeSha256, generateBuildManifestText} = require('../../scripts/copy-ffmpeg-binaries');

async function assertNoBackupCreated(destinationDirectory, destinationName) {
    const entries = await fsPromises.readdir(destinationDirectory);
    const backups = entries.filter(name => name.startsWith(`${destinationName}.backup-`));
    assert.equal(backups.length, 0, `expected no backup directory created, found: ${backups.join(', ')}`);
}

async function createSyntheticBundle(bundlePath, options = {}) {
    const {
        sourceType = 'source-built',
        tamperFfmpeg = false,
        missingHost = false,
        missingSidecar = false,
        nonExecutableHost = false,
        nonExecutableFfmpeg = false,
        missingInfoPlist = false,
        emptyInfoPlist = false,
        missingFile = null,
        missingManifest = false,
        skipTools = false,
        flatLayout = false,
    } = options;

    await fsPromises.mkdir(path.join(bundlePath, 'Contents', 'MacOS'), {recursive: true});

    if (!missingInfoPlist) {
        const infoPlist = emptyInfoPlist
            ? ''
            : [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
                '<plist version="1.0">',
                '<dict>',
                '    <key>CFBundleExecutable</key>',
                '    <string>miofive-video-converter</string>',
                '</dict>',
                '</plist>',
            ].join('\n');
        await fsPromises.writeFile(path.join(bundlePath, 'Contents', 'Info.plist'), infoPlist);
    }

    if (!missingHost) {
        const mode = nonExecutableHost ? 0o644 : 0o755;
        await fsPromises.writeFile(
            path.join(bundlePath, 'Contents', 'MacOS', 'miofive-video-converter'),
            '#!/bin/sh\nexit 0\n',
            {mode}
        );
    }

    if (!missingSidecar) {
        await fsPromises.writeFile(
            path.join(bundlePath, 'Contents', 'MacOS', 'miofive-server'),
            '#!/bin/sh\nexit 0\n',
            {mode: 0o755}
        );
    }

    const resourcesDir = flatLayout
        ? path.join(bundlePath, 'Contents', 'Resources')
        : path.join(bundlePath, 'Contents', 'Resources', 'resources');
    const binDir = path.join(resourcesDir, 'bin');
    const licensesDir = path.join(resourcesDir, 'licenses');
    const publicDir = path.join(resourcesDir, 'public');

    await fsPromises.mkdir(binDir, {recursive: true});
    await fsPromises.mkdir(licensesDir, {recursive: true});
    await fsPromises.mkdir(publicDir, {recursive: true});

    let ffmpegPath;
    let ffprobePath;
    if (!skipTools) {
        ffmpegPath = path.join(binDir, 'ffmpeg');
        ffprobePath = path.join(binDir, 'ffprobe');
        const ffmpegMode = nonExecutableFfmpeg ? 0o644 : 0o755;
        await fsPromises.writeFile(ffmpegPath, 'synthetic ffmpeg binary', {mode: ffmpegMode});
        await fsPromises.writeFile(ffprobePath, 'synthetic ffprobe binary', {mode: 0o755});
    }

    await fsPromises.writeFile(path.join(licensesDir, 'PROJECT-LICENSE.txt'), 'MIT License\n');
    await fsPromises.writeFile(path.join(licensesDir, 'THIRD_PARTY_NOTICES.md'), '# Third Party Notices\n');

    const noticeLines = [
        'Bundled FFmpeg and FFprobe',
        '',
        `Source type: ${sourceType}`,
        sourceType === 'source-built'
            ? 'The binaries were built from the checksum-pinned repository configuration.'
            : 'The binaries were supplied explicitly by the release operator.',
        '',
        'FFmpeg identity: ffmpeg version 7.1.1',
        'FFprobe identity: ffprobe version 7.1.1',
    ];
    await fsPromises.writeFile(path.join(licensesDir, 'FFMPEG-GPL-NOTICE.txt'), noticeLines.join('\n'));

    if (sourceType === 'source-built' && !missingManifest && !skipTools) {
        const ffmpegSha256 = computeSha256(ffmpegPath);
        const ffprobeSha256 = computeSha256(ffprobePath);
        const manifestText = generateBuildManifestText({ffmpegSha256, ffprobeSha256});
        await fsPromises.writeFile(path.join(resourcesDir, 'BUILD-MANIFEST.txt'), manifestText);

        if (tamperFfmpeg) {
            await fsPromises.writeFile(ffmpegPath, 'tampered bytes', {mode: 0o755});
        }
    }

    const publicAssets = [
        ['index.html', '<!doctype html><html><body>Miofive</body></html>'],
        ['app.js', 'console.log("app");'],
        ['player.js', 'console.log("player");'],
        ['folder-browser.js', 'console.log("folder-browser");'],
        ['security.js', 'console.log("security");'],
        ['demo-api-mock.js', 'console.log("demo-api-mock");'],
        ['dialog.js', 'console.log("dialog");'],
        ['styles.css', 'body { margin: 0; }'],
        ['player-styles.css', '.player { display: block; }'],
    ];
    for (const [name, content] of publicAssets) {
        await fsPromises.writeFile(path.join(publicDir, name), content);
    }

    if (missingFile) {
        await fsPromises.unlink(path.join(resourcesDir, missingFile));
    }
}

// 1. Table-driven negative boundary and failure tests
const failureCases = [
    {name: 'missing host executable', option: {missingHost: true}, pattern: /Host executable not found/},
    {name: 'missing sidecar executable', option: {missingSidecar: true}, pattern: /Sidecar executable not found/},
    {name: 'non-executable host binary', option: {nonExecutableHost: true}, pattern: /Host executable is not executable/},
    {name: 'non-executable ffmpeg binary', option: {nonExecutableFfmpeg: true}, pattern: /FFmpeg binary is not executable/},
    {name: 'missing Info.plist', option: {missingInfoPlist: true}, pattern: /Info\.plist not found/},
    {name: 'empty Info.plist', option: {emptyInfoPlist: true}, pattern: /Info\.plist is empty/},
    {name: 'missing entrypoint public/index.html', option: {missingFile: 'public/index.html'}, pattern: /Public asset index\.html not found/},
    {name: 'missing imported public/player.js', option: {missingFile: 'public/player.js'}, pattern: /Public asset player\.js not found/},
    {name: 'missing public/styles.css', option: {missingFile: 'public/styles.css'}, pattern: /Public asset styles\.css not found/},
    {name: 'missing license notice', option: {missingFile: 'licenses/PROJECT-LICENSE.txt'}, pattern: /License notice PROJECT-LICENSE\.txt not found/},
    {name: 'tampered FFmpeg bytes', option: {tamperFfmpeg: true}, pattern: /ffmpeg binary digest mismatch/},
    {name: 'flat layout without nested resources directory', option: {flatLayout: true}, pattern: /Resources directory not found/},
    {name: 'missing build manifest for source-built bundle', option: {missingManifest: true}, pattern: /Missing build manifest for source-built bundle/},
    {name: 'deliberate MIOFIVE_SKIP_FFMPEG_BUNDLE build without tools', option: {skipTools: true}, pattern: /MIOFIVE_SKIP_FFMPEG_BUNDLE/},
];

for (const {name, option, pattern} of failureCases) {
    test(`${name} leaves old destination unchanged and no install backup`, async (t) => {
        const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-case-'));
        t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

        const sourcePath = path.join(directory, 'source.app');
        const appsDir = path.join(directory, 'Applications');
        const destinationPath = path.join(appsDir, 'Miofive.app');
        await createSyntheticBundle(sourcePath, option);

        await fsPromises.mkdir(destinationPath, {recursive: true});
        await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

        await assert.rejects(
            () => installBundle({sourcePath, destinationPath, uniqueSuffix: 'case-test'}),
            pattern
        );

        assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
        await assertNoBackupCreated(appsDir, 'Miofive.app');
    });
}

// 2. Lifecycle and installation mechanics tests
test('successful local unsigned synthetic bundle installs on clean destination', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-clean-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    const {backup} = await installBundle({
        sourcePath,
        destinationPath,
        uniqueSuffix: 'clean',
    });

    assert.equal(backup, undefined, 'expected no backup on clean installation');
    assert.ok(await fsPromises.stat(destinationPath).then(s => s.isDirectory(), () => false));
    assert.ok(await fsPromises.stat(path.join(destinationPath, 'Contents', 'Info.plist')).then(s => s.isFile(), () => false));
    await assertNoBackupCreated(appsDir, 'Miofive.app');
});

test('successful local unsigned synthetic bundle installs and retains prior backup on update', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-update-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'previous-marker.txt'), 'old-working-app');

    const {backup} = await installBundle({
        sourcePath,
        destinationPath,
        uniqueSuffix: 'update',
    });

    assert.ok(backup, 'expected backup path returned');
    assert.equal(await fsPromises.readFile(path.join(backup, 'previous-marker.txt'), 'utf8'), 'old-working-app');
    assert.ok(await fsPromises.stat(path.join(destinationPath, 'Contents', 'Info.plist')).then(s => s.isFile(), () => false));
    assert.equal(
        await fsPromises.access(path.join(destinationPath, 'previous-marker.txt')).then(() => true, () => false),
        false
    );
});

test('supports explicit-env-paths local bundle without BUILD-MANIFEST.txt', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-explicit-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath, {sourceType: 'explicit-env-paths'});

    const {backup} = await installBundle({
        sourcePath,
        destinationPath,
        uniqueSuffix: 'explicit',
    });

    assert.equal(backup, undefined);
    assert.ok(await fsPromises.stat(destinationPath).then(s => s.isDirectory(), () => false));
    await assertNoBackupCreated(appsDir, 'Miofive.app');
});

test('failed/partial staged copy leaves old app intact and cleans up staging', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-cp-fail-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const failingFileSystem = Object.create(fsPromises);
    failingFileSystem.cp = async (_source, staging) => {
        await fsPromises.writeFile(path.join(staging, 'partial.txt'), 'partial');
        throw new Error('simulated copy failure');
    };

    await assert.rejects(
        () => installBundle({
            sourcePath,
            destinationPath,
            fileSystem: failingFileSystem,
            uniqueSuffix: 'cp-fail',
        }),
        /simulated copy failure/
    );

    assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
    await assertNoBackupCreated(appsDir, 'Miofive.app');
    const stagingPath = path.join(appsDir, '.Miofive.app.install-cp-fail');
    assert.equal(await fsPromises.access(stagingPath).then(() => true, () => false), false);
});

test('incomplete staged copy failing validation leaves old app intact and cleans up staging', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-corrupt-stage-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const corruptingFileSystem = Object.create(fsPromises);
    corruptingFileSystem.cp = async (source, staging, options) => {
        await fsPromises.cp(source, staging, options);
        await fsPromises.writeFile(path.join(staging, 'Contents', 'Info.plist'), '');
    };

    await assert.rejects(
        () => installBundle({
            sourcePath,
            destinationPath,
            fileSystem: corruptingFileSystem,
            uniqueSuffix: 'corrupt-stage',
        }),
        /Info\.plist is empty/
    );

    assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
    await assertNoBackupCreated(appsDir, 'Miofive.app');
    const stagingPath = path.join(appsDir, '.Miofive.app.install-corrupt-stage');
    assert.equal(await fsPromises.access(stagingPath).then(() => true, () => false), false);
});

test('existing staging-name collision preserves foreign sentinel and leaves old app intact', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-collision-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const stagingPath = path.join(appsDir, '.Miofive.app.install-collision-test');
    await fsPromises.mkdir(appsDir, {recursive: true});
    await fsPromises.mkdir(stagingPath);
    await fsPromises.writeFile(path.join(stagingPath, 'foreign-sentinel.txt'), 'do-not-delete-me');

    await assert.rejects(
        () => installBundle({
            sourcePath,
            destinationPath,
            uniqueSuffix: 'collision-test',
        }),
        (err) => Boolean(err && (err.code === 'EEXIST' || err.code === 'ERR_FS_CP_EEXIST'))
    );

    assert.equal(await fsPromises.readFile(path.join(stagingPath, 'foreign-sentinel.txt'), 'utf8'), 'do-not-delete-me');
    assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
    await assertNoBackupCreated(appsDir, 'Miofive.app');
});

test('when rollback itself fails, rethrows aggregate error with cause and preserves prior backup', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-rollback-fail-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const failingFileSystem = Object.create(fsPromises);
    const promotionError = new Error('simulated final promotion rename failure');
    const rollbackError = new Error('simulated rollback rename failure');
    let renameCallCount = 0;
    failingFileSystem.rename = async (oldPath, newPath) => {
        renameCallCount++;
        if (renameCallCount === 1) {
            return fsPromises.rename(oldPath, newPath);
        }
        if (renameCallCount === 2) {
            throw promotionError;
        }
        if (renameCallCount === 3) {
            throw rollbackError;
        }
        return fsPromises.rename(oldPath, newPath);
    };

    await assert.rejects(
        () => installBundle({
            sourcePath,
            destinationPath,
            fileSystem: failingFileSystem,
            uniqueSuffix: 'rollback-fail',
        }),
        (err) => {
            assert.ok(err instanceof AggregateError, 'expected instance of AggregateError');
            assert.match(err.message, /Installation failed \(simulated final promotion rename failure\)/);
            assert.match(err.message, /restoration from backup failed: simulated rollback rename failure/);
            assert.equal(err.cause, rollbackError);
            assert.equal(err.errors.length, 2);
            assert.equal(err.errors[0], promotionError);
            assert.equal(err.errors[1], rollbackError);
            return true;
        }
    );

    const entries = await fsPromises.readdir(appsDir);
    const backups = entries.filter(name => name.startsWith('Miofive.app.backup-'));
    assert.equal(backups.length, 1, 'expected prior backup directory to remain');
    assert.equal(await fsPromises.readFile(path.join(appsDir, backups[0], 'current.txt'), 'utf8'), 'working');
    assert.equal(await fsPromises.access(destinationPath).then(() => true, () => false), false);
    const stagingPath = path.join(appsDir, '.Miofive.app.install-rollback-fail');
    assert.equal(await fsPromises.access(stagingPath).then(() => true, () => false), false);
});

test('failed final promotion restores old app from backup', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-promo-fail-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const failingFileSystem = Object.create(fsPromises);
    let renameCallCount = 0;
    failingFileSystem.rename = async (oldPath, newPath) => {
        renameCallCount++;
        if (renameCallCount === 2) {
            throw new Error('simulated final promotion rename failure');
        }
        return fsPromises.rename(oldPath, newPath);
    };

    await assert.rejects(
        () => installBundle({
            sourcePath,
            destinationPath,
            fileSystem: failingFileSystem,
            uniqueSuffix: 'promo-fail',
        }),
        /simulated final promotion rename failure/
    );

    assert.equal(renameCallCount, 3, 'expected rename for backup, failed rename for staging, and rollback rename');
    assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
    const stagingPath = path.join(appsDir, '.Miofive.app.install-promo-fail');
    assert.equal(await fsPromises.access(stagingPath).then(() => true, () => false), false);
});

test('surfaces filesystem access errors other than ENOENT rather than treating as absence', async (t) => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-access-err-'));
    t.after(() => fsPromises.rm(directory, {recursive: true, force: true}));

    const sourcePath = path.join(directory, 'source.app');
    const appsDir = path.join(directory, 'Applications');
    const destinationPath = path.join(appsDir, 'Miofive.app');
    await createSyntheticBundle(sourcePath);

    const permissionErrorFileSystem = Object.create(fsPromises);
    permissionErrorFileSystem.access = async (targetPath, mode) => {
        if (targetPath === destinationPath) {
            const err = new Error('simulated EACCES');
            err.code = 'EACCES';
            throw err;
        }
        return fsPromises.access(targetPath, mode);
    };

    await assert.rejects(
        () => installBundle({
            sourcePath,
            destinationPath,
            fileSystem: permissionErrorFileSystem,
            uniqueSuffix: 'access-err',
        }),
        (err) => err.code === 'EACCES'
    );
});

test('CLI entrypoint reports actionable failure message and exits nonzero when source is missing', async (t) => {
    const emptyCwd = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-cli-regression-'));
    t.after(() => fsPromises.rm(emptyCwd, {recursive: true, force: true}));

    const installScript = path.resolve(__dirname, '../../scripts/install-mac-app.js');
    const result = spawnSync(process.execPath, [installScript], {
        cwd: emptyCwd,
        encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unable to install the application bundle: /);
    assert.match(result.stderr, /The built application bundle was not found/);
});
