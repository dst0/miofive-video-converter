const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const buildConfig = require('../../scripts/ffmpeg-build-config');
const {
    assertPinnedBuildManifest,
    compareVersions,
    computeSha256,
    generateBuildManifestText,
    parseBuildManifest,
    parseMinimumMacosVersions,
    recordSourceBuildManifest,
    regenerateAndValidateManifest,
    validateBundledBuild,
    validateSourceBuild,
    verifySourceBuildArtifacts,
} = require('../../scripts/copy-ffmpeg-binaries');
const {resolveAndValidateBinaries} = require('../../scripts/check-ffmpeg');
const {installBundle} = require('../../scripts/install-mac-app');
const {copyResources} = require('../../scripts/copy-resources');
const {verifyExecution} = require('../../scripts/check-ffmpeg');

const repositoryRoot = path.resolve(__dirname, '..', '..');

test('clean checkout can validate operator-managed PATH tools without a generated bundle', {skip: process.platform === 'win32'}, async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-system-tools-'));
    try {
        const binaries = ['ffmpeg', 'ffprobe'].map((name) => path.join(directory, name));
        for (const binary of binaries) await fsPromises.writeFile(binary, '#!/bin/sh\nexit 0\n', {mode: 0o700});
        const resolved = resolveAndValidateBinaries({env: {PATH: directory}, platform: 'linux',
            sourceBuiltDir: path.join(directory, 'absent-source'), resourcesDir: path.join(directory, 'absent-resources')});
        assert.deepEqual(resolved, binaries);
        assert.doesNotThrow(() => verifyExecution(resolved));
        const resourcesDir = path.join(directory, 'development-resources');
        await fsPromises.mkdir(path.join(resourcesDir, 'bin'), {recursive: true});
        assert.deepEqual(resolveAndValidateBinaries({env: {PATH: directory}, platform: 'linux', resourcesDir}), binaries,
            'an intentionally empty development bundle must use runtime system tools');
        await fsPromises.copyFile(binaries[0], path.join(resourcesDir, 'bin', 'ffmpeg'));
        assert.throws(() => resolveAndValidateBinaries({env: {PATH: directory}, platform: 'linux', resourcesDir}),
            /[Bb]uild manifest not found/, 'an incomplete bundle must not fall back to system tools');
        assert.throws(() => resolveAndValidateBinaries({env: {MIOFIVE_FFMPEG_PATH: '', MIOFIVE_FFPROBE_PATH: ''}}), /Both MIOFIVE/);
    } finally {
        await fsPromises.rm(directory, {recursive: true, force: true});
    }
});

test('resource generation ships exact project/notices bytes and removes stale demo media only', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-resources-'));
    try {
        await fsPromises.mkdir(path.join(directory, 'public'));
        await fsPromises.mkdir(path.join(directory, 'test-data'));
        await fsPromises.writeFile(path.join(directory, 'public', 'index.html'), 'app shell');
        await fsPromises.writeFile(path.join(directory, 'test-data', 'sample.mp4'), 'synthetic');
        for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await fsPromises.copyFile(path.join(repositoryRoot, file), path.join(directory, file));
        copyResources({rootDir: directory, includeDemoVideos: true});
        const resources = path.join(directory, 'src-tauri', 'resources');
        assert.equal(await fsPromises.readFile(path.join(resources, 'test-data', 'sample.mp4'), 'utf8'), 'synthetic');
        copyResources({rootDir: directory});
        await assert.rejects(() => fsPromises.access(path.join(resources, 'test-data')), {code: 'ENOENT'});
        for (const [source, output] of [['LICENSE', 'PROJECT-LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']]) {
            assert.deepEqual(await fsPromises.readFile(path.join(resources, 'licenses', output)), await fsPromises.readFile(path.join(directory, source)));
        }
        assert.equal(await fsPromises.readFile(path.join(directory, 'test-data', 'sample.mp4'), 'utf8'), 'synthetic');
        const config = JSON.parse(await fsPromises.readFile(path.join(repositoryRoot, 'src-tauri', 'tauri.conf.json')));
        assert.equal(config.build.devUrl, undefined, 'desktop must not wait on a nonexistent fixed-port dev server');
        assert.equal(config.build.frontendDist, '../public');
    } finally {
        await fsPromises.rm(directory, {recursive: true, force: true});
    }
});

test('the web manifest and service worker remain deployable below a GitHub Pages project path', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'public', 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.ok(manifest.icons.every((icon) => !icon.src.startsWith('/')));

    const serviceWorker = fs.readFileSync(path.join(repositoryRoot, 'public', 'service-worker.js'), 'utf8');
    assert.match(serviceWorker, /self\.registration\.scope/);
    assert.match(serviceWorker, /'security\.js'/);
    assert.doesNotMatch(serviceWorker, /['"]\/(?:index\.html|app\.js|service-worker\.js|app-icon\.svg)['"]/);
}
);

test('ESLint ignores generated desktop resources and vendored source trees', () => {
    const eslintConfig = require('../../eslint.config');
    const ignores = eslintConfig[0].ignores;
    for (const expected of ['src-tauri/binaries/**', 'src-tauri/resources/**', 'vendor/**']) {
        assert.ok(ignores.includes(expected), `missing ESLint ignore: ${expected}`);
    }
});

test('macOS installation leaves the current application intact when staging copy fails', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-'));
    const sourcePath = path.join(directory, 'source.app');
    const destinationPath = path.join(directory, 'Applications', 'Miofive.app');
    await fsPromises.mkdir(sourcePath);
    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const failingFileSystem = Object.create(fsPromises);
    failingFileSystem.cp = async (_source, staging) => {
        await fsPromises.mkdir(staging);
        await fsPromises.writeFile(path.join(staging, 'partial.txt'), 'partial');
        throw new Error('simulated copy failure');
    };

    try {
        await assert.rejects(
            () => installBundle({
                sourcePath,
                destinationPath,
                fileSystem: failingFileSystem,
                uniqueSuffix: 'test',
            }),
            /simulated copy failure/
        );
        assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
        assert.equal(
            await fsPromises.access(path.join(directory, 'Applications', '.Miofive.app.install-test')).then(
                () => true,
                () => false
            ),
            false
        );
    } finally {
        await fsPromises.rm(directory, {recursive: true, force: true});
    }
});

test('macOS installation restores existing application from backup when final rename fails', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-installer-rollback-'));
    const sourcePath = path.join(directory, 'source.app');
    const destinationPath = path.join(directory, 'Applications', 'Miofive.app');
    await fsPromises.mkdir(sourcePath);
    await fsPromises.writeFile(path.join(sourcePath, 'new.txt'), 'new-version');
    await fsPromises.mkdir(destinationPath, {recursive: true});
    await fsPromises.writeFile(path.join(destinationPath, 'current.txt'), 'working');

    const failingFileSystem = Object.create(fsPromises);
    let renameCallCount = 0;
    failingFileSystem.rename = async (oldPath, newPath) => {
        renameCallCount++;
        if (renameCallCount === 2) {
            throw new Error('simulated final atomic rename failure');
        }
        return fsPromises.rename(oldPath, newPath);
    };

    try {
        await assert.rejects(
            () => installBundle({
                sourcePath,
                destinationPath,
                fileSystem: failingFileSystem,
                uniqueSuffix: 'test-rollback',
            }),
            /simulated final atomic rename failure/
        );
        assert.equal(renameCallCount, 3, 'expected rename for backup, failed rename for staging, and rollback rename');
        assert.equal(await fsPromises.readFile(path.join(destinationPath, 'current.txt'), 'utf8'), 'working');
        assert.equal(
            await fsPromises.access(path.join(directory, 'Applications', '.Miofive.app.install-test-rollback')).then(
                () => true,
                () => false
            ),
            false
        );
    } finally {
        await fsPromises.rm(directory, {recursive: true, force: true});
    }
});

test('source-built FFmpeg reuse requires every provenance and deployment pin and rejects missing, duplicate, or tampered entries', () => {
    const validManifest = [
        'FFmpeg:',
        `  version: ${buildConfig.ffmpeg.version}`,
        `  source: ${buildConfig.ffmpeg.url}`,
        `  sha256: ${buildConfig.ffmpeg.sha256}`,
        'x264:',
        `  commit: ${buildConfig.x264.commit}`,
        `  source: ${buildConfig.x264.url}`,
        `  sha256: ${buildConfig.x264.sha256}`,
        'Build:',
        `  minimum_macos: ${buildConfig.minimumMacosVersion}`,
    ].join('\n');

    // 1. Valid manifest acceptance
    const directFields = parseBuildManifest(validManifest);
    assert.equal(directFields.get('FFmpeg.version'), buildConfig.ffmpeg.version);
    assert.doesNotThrow(() => assertPinnedBuildManifest(validManifest));

    // 2. Tampered entries rejection
    assert.throws(
        () => assertPinnedBuildManifest(validManifest.replace(buildConfig.ffmpeg.sha256, 'stale-ffmpeg-sha')),
        /does not match the repository pin/
    );
    assert.throws(
        () => assertPinnedBuildManifest(validManifest.replace(buildConfig.ffmpeg.version, '8.1.1')),
        /does not match the repository pin/
    );
    assert.throws(
        () => assertPinnedBuildManifest(validManifest.replace(buildConfig.x264.commit, 'stale-x264-commit')),
        /does not match the repository pin/
    );
    assert.throws(
        () => assertPinnedBuildManifest(validManifest.replace(buildConfig.minimumMacosVersion, '12.0')),
        /does not match the repository pin/
    );

    // 3. Duplicate fields rejection
    const duplicateFieldManifest = validManifest + `\n  minimum_macos: ${buildConfig.minimumMacosVersion}`;
    assert.throws(
        () => assertPinnedBuildManifest(duplicateFieldManifest),
        /Duplicate build manifest field: Build\.minimum_macos/
    );

    const duplicateExplicitField = validManifest.replace(
        `  version: ${buildConfig.ffmpeg.version}`,
        `  version: ${buildConfig.ffmpeg.version}\n  version: ${buildConfig.ffmpeg.version}`
    );
    assert.throws(
        () => assertPinnedBuildManifest(duplicateExplicitField),
        /Duplicate build manifest field: FFmpeg\.version/
    );

    // 4. Missing required field rejection
    const missingFieldManifest = validManifest.replace(`  sha256: ${buildConfig.ffmpeg.sha256}\n`, '');
    assert.throws(
        () => assertPinnedBuildManifest(missingFieldManifest),
        /does not match the repository pin/
    );
});

test('source-built FFmpeg artifact verification requires matching binary SHA-256 digests and rejects missing, duplicate, and tampered entries', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-artifacts-'));
    const binDir = path.join(directory, 'bin');
    await fsPromises.mkdir(binDir);

    const ffmpegContent = 'binary-ffmpeg-data';
    const ffprobeContent = 'binary-ffprobe-data';
    await fsPromises.writeFile(path.join(binDir, 'ffmpeg'), ffmpegContent);
    await fsPromises.writeFile(path.join(binDir, 'ffprobe'), ffprobeContent);

    const crypto = require('node:crypto');
    const ffmpegSha = crypto.createHash('sha256').update(ffmpegContent).digest('hex');
    const ffprobeSha = crypto.createHash('sha256').update(ffprobeContent).digest('hex');

    const validFields = new Map([
        ['Artifacts.ffmpeg_sha256', ffmpegSha],
        ['Artifacts.ffprobe_sha256', ffprobeSha],
    ]);

    try {
        // Valid digests
        assert.doesNotThrow(() => verifySourceBuildArtifacts(validFields, binDir));

        // Missing artifact digests
        const missingFfmpeg = new Map([['Artifacts.ffprobe_sha256', ffprobeSha]]);
        assert.throws(
            () => verifySourceBuildArtifacts(missingFfmpeg, binDir),
            /missing Artifacts binary SHA-256 digests/
        );

        const missingFfprobe = new Map([['Artifacts.ffmpeg_sha256', ffmpegSha]]);
        assert.throws(
            () => verifySourceBuildArtifacts(missingFfprobe, binDir),
            /missing Artifacts binary SHA-256 digests/
        );

        // Tampered artifact digests
        const tamperedFfmpeg = new Map([
            ['Artifacts.ffmpeg_sha256', '0000000000000000000000000000000000000000000000000000000000000000'],
            ['Artifacts.ffprobe_sha256', ffprobeSha],
        ]);
        assert.throws(
            () => verifySourceBuildArtifacts(tamperedFfmpeg, binDir),
            /ffmpeg binary digest mismatch/
        );

        const tamperedFfprobe = new Map([
            ['Artifacts.ffmpeg_sha256', ffmpegSha],
            ['Artifacts.ffprobe_sha256', '0000000000000000000000000000000000000000000000000000000000000000'],
        ]);
        assert.throws(
            () => verifySourceBuildArtifacts(tamperedFfprobe, binDir),
            /ffprobe binary digest mismatch/
        );

        // Missing binary files on disk
        const missingBinDir = path.join(directory, 'empty-bin');
        await fsPromises.mkdir(missingBinDir);
        assert.throws(
            () => verifySourceBuildArtifacts(validFields, missingBinDir),
            /ENOENT|Missing ffmpeg binary/
        );
    } finally {
        await fsPromises.rm(directory, {recursive: true, force: true});
    }
});

test('canonical manifest generator creates valid manifest matching pinned config and verified binary digests', async () => {
    const dummyFfmpegSha = 'ebff60c3fff06e7c7932a73d957b91fe426d19583132600ab36e88a7f4907340';
    const dummyFfprobeSha = 'dad5d653c5e70340bbf0fd5476074d20ea0fa7ed1a7040e3358207a436e0bbef';

    // 1. generateBuildManifestText
    const manifestText = generateBuildManifestText({
        ffmpegSha256: dummyFfmpegSha,
        ffprobeSha256: dummyFfprobeSha,
        host: 'Darwin arm64',
        compiler: 'Apple clang version 21.0.0',
    });

    assert.match(manifestText, /^Miofive Video Converter bundled FFmpeg build/m);
    assert.match(manifestText, new RegExp(`version: ${buildConfig.ffmpeg.version}`));
    assert.match(manifestText, new RegExp(`commit: ${buildConfig.x264.commit}`));
    assert.match(manifestText, new RegExp(`ffmpeg_sha256: ${dummyFfmpegSha}`));
    assert.match(manifestText, new RegExp(`ffprobe_sha256: ${dummyFfprobeSha}`));

    // The generated manifest must pass assertPinnedBuildManifest
    const parsedFields = assertPinnedBuildManifest(manifestText);
    assert.equal(parsedFields.get('Artifacts.ffmpeg_sha256'), dummyFfmpegSha);
    assert.equal(parsedFields.get('Artifacts.ffprobe_sha256'), dummyFfprobeSha);

    // Rejects invalid SHA inputs
    assert.throws(
        () => generateBuildManifestText({ffmpegSha256: 'short', ffprobeSha256: dummyFfprobeSha}),
        /Invalid or missing ffmpeg SHA-256 digest/
    );
    assert.throws(
        () => generateBuildManifestText({ffmpegSha256: dummyFfmpegSha, ffprobeSha256: 'bad-hex!'}),
        /Invalid or missing ffprobe SHA-256 digest/
    );

    // 2. recordSourceBuildManifest in isolated temp directory
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-manifest-gen-'));
    const binDir = path.join(tempDir, 'bin');
    await fsPromises.mkdir(binDir);
    await fsPromises.writeFile(path.join(binDir, 'ffmpeg'), 'dummy-ffmpeg');
    await fsPromises.writeFile(path.join(binDir, 'ffprobe'), 'dummy-ffprobe');

    try {
        const result = recordSourceBuildManifest(tempDir);
        assert.ok(fs.existsSync(result.manifestFile));
        const verified = validateSourceBuild(tempDir);
        assert.equal(verified.fields.get('FFmpeg.version'), buildConfig.ffmpeg.version);
        assert.equal(verified.fields.get('Artifacts.ffmpeg_sha256'), computeSha256(path.join(binDir, 'ffmpeg')));
        assert.equal(verified.fields.get('Artifacts.ffprobe_sha256'), computeSha256(path.join(binDir, 'ffprobe')));
    } finally {
        await fsPromises.rm(tempDir, {recursive: true, force: true});
    }
});

test('safe cached regeneration preserves original build metadata and refuses to bless tampered cached bytes', async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-cached-regen-'));
    const binDir = path.join(tempDir, 'bin');
    await fsPromises.mkdir(binDir);
    await fsPromises.writeFile(path.join(binDir, 'ffmpeg'), 'original-source-built-ffmpeg');
    await fsPromises.writeFile(path.join(binDir, 'ffprobe'), 'original-source-built-ffprobe');

    try {
        // 1. Establish verified provenance record from source build
        const initial = recordSourceBuildManifest(tempDir);
        const originalFfmpegSha = initial.fields.get('Artifacts.ffmpeg_sha256');
        const originalFfprobeSha = initial.fields.get('Artifacts.ffprobe_sha256');
        const originalCompiler = initial.fields.get('Build.compiler');

        // 2. Safe regeneration on unmodified cached binaries succeeds and preserves metadata
        const regenerated = regenerateAndValidateManifest(tempDir);
        assert.equal(regenerated.fields.get('Artifacts.ffmpeg_sha256'), originalFfmpegSha);
        assert.equal(regenerated.fields.get('Artifacts.ffprobe_sha256'), originalFfprobeSha);
        assert.equal(regenerated.fields.get('Build.compiler'), originalCompiler);

        // 3. Tamper with cached binary on disk: regeneration MUST fail closed and refuse to bless
        await fsPromises.writeFile(path.join(binDir, 'ffmpeg'), 'tampered-cached-bytes');
        assert.throws(
            () => regenerateAndValidateManifest(tempDir),
            /ffmpeg binary digest mismatch/
        );

        // Even if manifest is missing, regeneration cannot bless arbitrary bytes without existing record
        await fsPromises.rm(path.join(tempDir, 'BUILD-MANIFEST.txt'));
        assert.throws(
            () => regenerateAndValidateManifest(tempDir),
            /Cannot regenerate cached manifest without existing build manifest/
        );
    } finally {
        await fsPromises.rm(tempDir, {recursive: true, force: true});
    }
});

test('bundled resource validation enforces BUILD-MANIFEST.txt and matching binary digests', async () => {
    const liveResourcesDir = path.join(repositoryRoot, 'src-tauri', 'resources');
    // 1. Live bundled resources validate cleanly if bundled
    if (fs.existsSync(path.join(liveResourcesDir, 'BUILD-MANIFEST.txt'))) {
        assert.doesNotThrow(() => validateBundledBuild(liveResourcesDir));
    }

    // 2. Isolated disposable bundled resource directory checks
    const tempResources = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-bundled-val-'));
    const tempBin = path.join(tempResources, 'bin');
    await fsPromises.mkdir(tempBin);
    await fsPromises.writeFile(path.join(tempBin, 'ffmpeg'), 'bundled-ffmpeg');
    await fsPromises.writeFile(path.join(tempBin, 'ffprobe'), 'bundled-ffprobe');

    try {
        // Missing bundled BUILD-MANIFEST.txt fails closed
        assert.throws(
            () => validateBundledBuild(tempResources),
            /Bundled build manifest not found/
        );

        // Write tampered manifest
        const badManifest = generateBuildManifestText({
            ffmpegSha256: '0000000000000000000000000000000000000000000000000000000000000000',
            ffprobeSha256: computeSha256(path.join(tempBin, 'ffprobe')),
        });
        await fsPromises.writeFile(path.join(tempResources, 'BUILD-MANIFEST.txt'), badManifest);
        assert.throws(
            () => validateBundledBuild(tempResources),
            /ffmpeg binary digest mismatch/
        );

        // Correct manifest validates cleanly
        const goodManifest = generateBuildManifestText({
            ffmpegSha256: computeSha256(path.join(tempBin, 'ffmpeg')),
            ffprobeSha256: computeSha256(path.join(tempBin, 'ffprobe')),
        });
        await fsPromises.writeFile(path.join(tempResources, 'BUILD-MANIFEST.txt'), goodManifest);
        assert.doesNotThrow(() => validateBundledBuild(tempResources));
    } finally {
        await fsPromises.rm(tempResources, {recursive: true, force: true});
    }
});

test('check-ffmpeg validates manifest and binary digests before first binary execution', async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-check-validation-'));
    const binDir = path.join(tempDir, 'bin');
    await fsPromises.mkdir(binDir);
    await fsPromises.writeFile(path.join(binDir, 'ffmpeg'), 'not-real-ffmpeg');
    await fsPromises.writeFile(path.join(binDir, 'ffprobe'), 'not-real-ffprobe');

    try {
        // Missing BUILD-MANIFEST.txt fails closed before execution
        assert.throws(
            () => resolveAndValidateBinaries({sourceBuiltDir: tempDir, resourcesDir: tempDir}),
            /[Bb]uild manifest not found/
        );

        // Tampered manifest SHA-256 fails closed before execution
        const tamperedManifest = generateBuildManifestText({
            ffmpegSha256: '0000000000000000000000000000000000000000000000000000000000000000',
            ffprobeSha256: computeSha256(path.join(binDir, 'ffprobe')),
        });
        await fsPromises.writeFile(path.join(tempDir, 'BUILD-MANIFEST.txt'), tamperedManifest);

        assert.throws(
            () => resolveAndValidateBinaries({sourceBuiltDir: tempDir, resourcesDir: tempDir}),
            /ffmpeg binary digest mismatch/
        );

        // Matching bundled files validate cleanly using the shared manifest format
        recordSourceBuildManifest(tempDir);
        const resolved = resolveAndValidateBinaries({sourceBuiltDir: tempDir, resourcesDir: tempDir});
        assert.deepEqual(resolved, [path.join(binDir, 'ffmpeg'), path.join(binDir, 'ffprobe')]);

        // Explicit development override boundary: caller-supplied binaries are accepted if executable
        const overrideEnv = {
            MIOFIVE_FFMPEG_PATH: path.join(binDir, 'ffmpeg'),
            MIOFIVE_FFPROBE_PATH: path.join(binDir, 'ffprobe'),
        };
        await fsPromises.chmod(path.join(binDir, 'ffmpeg'), 0o755);
        await fsPromises.chmod(path.join(binDir, 'ffprobe'), 0o755);
        const overridden = resolveAndValidateBinaries({env: overrideEnv});
        assert.deepEqual(overridden, [overrideEnv.MIOFIVE_FFMPEG_PATH, overrideEnv.MIOFIVE_FFPROBE_PATH]);
    } finally {
        await fsPromises.rm(tempDir, {recursive: true, force: true});
    }
});

test('source-built artifact validation enforces per-build identity across distinct toolchains and rejects swapped, stale, or tampered manifests', async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'miofive-build-identity-'));

    try {
        const buildADir = path.join(tempDir, 'build-a');
        const buildBDir = path.join(tempDir, 'build-b');
        const binA = path.join(buildADir, 'bin');
        const binB = path.join(buildBDir, 'bin');

        await fsPromises.mkdir(binA, {recursive: true});
        await fsPromises.mkdir(binB, {recursive: true});

        // 1. Two distinct build environments produce different binary bytes under the same pinned source configuration
        await fsPromises.writeFile(path.join(binA, 'ffmpeg'), 'toolchain-a-ffmpeg-artifact-bytes');
        await fsPromises.writeFile(path.join(binA, 'ffprobe'), 'toolchain-a-ffprobe-artifact-bytes');

        await fsPromises.writeFile(path.join(binB, 'ffmpeg'), 'toolchain-b-ffmpeg-artifact-bytes-distinct');
        await fsPromises.writeFile(path.join(binB, 'ffprobe'), 'toolchain-b-ffprobe-artifact-bytes-distinct');

        const manifestRecordA = recordSourceBuildManifest(buildADir);
        const manifestRecordB = recordSourceBuildManifest(buildBDir);

        const actualFfmpegShaA = computeSha256(path.join(binA, 'ffmpeg'));
        const actualFfprobeShaA = computeSha256(path.join(binA, 'ffprobe'));
        const actualFfmpegShaB = computeSha256(path.join(binB, 'ffmpeg'));
        const actualFfprobeShaB = computeSha256(path.join(binB, 'ffprobe'));

        // Artifact digests must be distinct across distinct builds
        assert.notEqual(actualFfmpegShaA, actualFfmpegShaB);
        assert.notEqual(actualFfprobeShaA, actualFfprobeShaB);

        // 2. Both builds validate cleanly against their own recorded per-build manifests and verify pinned source config
        const verifiedA = validateSourceBuild(buildADir);
        assert.equal(verifiedA.fields.get('FFmpeg.version'), buildConfig.ffmpeg.version);
        assert.equal(verifiedA.fields.get('FFmpeg.sha256'), buildConfig.ffmpeg.sha256);
        assert.equal(verifiedA.fields.get('x264.commit'), buildConfig.x264.commit);
        assert.equal(verifiedA.fields.get('x264.sha256'), buildConfig.x264.sha256);
        assert.equal(verifiedA.fields.get('Build.minimum_macos'), buildConfig.minimumMacosVersion);
        assert.equal(verifiedA.fields.get('Artifacts.ffmpeg_sha256'), actualFfmpegShaA);
        assert.equal(verifiedA.fields.get('Artifacts.ffprobe_sha256'), actualFfprobeShaA);

        const verifiedB = validateSourceBuild(buildBDir);
        assert.equal(verifiedB.fields.get('FFmpeg.version'), buildConfig.ffmpeg.version);
        assert.equal(verifiedB.fields.get('FFmpeg.sha256'), buildConfig.ffmpeg.sha256);
        assert.equal(verifiedB.fields.get('x264.commit'), buildConfig.x264.commit);
        assert.equal(verifiedB.fields.get('x264.sha256'), buildConfig.x264.sha256);
        assert.equal(verifiedB.fields.get('Build.minimum_macos'), buildConfig.minimumMacosVersion);
        assert.equal(verifiedB.fields.get('Artifacts.ffmpeg_sha256'), actualFfmpegShaB);
        assert.equal(verifiedB.fields.get('Artifacts.ffprobe_sha256'), actualFfprobeShaB);

        // 3. Swapped / cross-build manifest fails closed: Build A artifacts with Build B manifest
        await fsPromises.writeFile(path.join(buildADir, 'BUILD-MANIFEST.txt'), manifestRecordB.manifestText);
        assert.throws(
            () => validateSourceBuild(buildADir),
            /ffmpeg binary digest mismatch/
        );

        // 4. Stale / tampered binary fails closed: modified binary bytes after manifest generation
        await fsPromises.writeFile(path.join(buildBDir, 'bin', 'ffmpeg'), 'tampered-or-stale-binary-bytes');
        assert.throws(
            () => validateSourceBuild(buildBDir),
            /ffmpeg binary digest mismatch/
        );

        // 5. Tampered ffprobe binary also fails closed
        await fsPromises.writeFile(path.join(buildADir, 'BUILD-MANIFEST.txt'), manifestRecordA.manifestText);
        await fsPromises.writeFile(path.join(buildADir, 'bin', 'ffprobe'), 'tampered-ffprobe-bytes');
        assert.throws(
            () => validateSourceBuild(buildADir),
            /ffprobe binary digest mismatch/
        );

        // 6. Missing manifest fails closed
        await fsPromises.rm(path.join(buildADir, 'BUILD-MANIFEST.txt'));
        assert.throws(
            () => validateSourceBuild(buildADir),
            /Build manifest not found/
        );

        // 7. Missing binary fails closed
        await fsPromises.rm(path.join(buildADir, 'bin', 'ffmpeg'));
        await fsPromises.writeFile(path.join(buildADir, 'BUILD-MANIFEST.txt'), manifestRecordA.manifestText);
        assert.throws(
            () => validateSourceBuild(buildADir),
            /ENOENT|Missing ffmpeg binary/
        );
    } finally {
        await fsPromises.rm(tempDir, {recursive: true, force: true});
    }
});

test('Mach-O deployment target parsing rejects targets above the application minimum', () => {
    const versions = parseMinimumMacosVersions([
        '      cmd LC_BUILD_VERSION',
        '    minos 11.0',
        '      cmd LC_VERSION_MIN_MACOSX',
        '  version 10.13',
    ].join('\n'));
    assert.deepEqual(versions, ['11.0', '10.13']);
    assert.equal(compareVersions('11.0', buildConfig.minimumMacosVersion), 0);
    assert.equal(compareVersions('26.0', buildConfig.minimumMacosVersion), 1);
});

test('FFmpeg build script enforces validated MIOFIVE_FFMPEG_BUILD_JOBS and bounded default independent of ambient environment', () => {
    const {resolveBuildJobs} = require('../../scripts/read-ffmpeg-build-config');
    const scriptPath = path.join(repositoryRoot, 'scripts', 'build-ffmpeg-macos-arm64.sh');
    const configReaderPath = path.join(repositoryRoot, 'scripts', 'read-ffmpeg-build-config.js');

    // 1. Test shared resolver function directly with explicit arguments (independent of ambient process.env)
    assert.equal(resolveBuildJobs(undefined), 2);
    assert.equal(resolveBuildJobs(''), 2);
    assert.equal(resolveBuildJobs('  '), 2);
    assert.equal(resolveBuildJobs('1'), 1);
    assert.equal(resolveBuildJobs('2'), 2);
    assert.equal(resolveBuildJobs('4'), 4);
    assert.equal(resolveBuildJobs('16'), 16);

    // Rejects invalid/nonpositive inputs
    for (const invalid of ['0', '-1', 'abc', '2.5', 'true', '04', 'NaN', 'Infinity']) {
        assert.throws(
            () => resolveBuildJobs(invalid),
            /Invalid MIOFIVE_FFMPEG_BUILD_JOBS value/,
            `Expected invalid error for '${invalid}'`
        );
    }

    // Rejects oversized and huge integer inputs
    for (const oversized of [
        '17',
        '99',
        '1000',
        '9999999999999999999999999999999999999999999999999999999999999999',
        '1000000000000000000000000000000000000000000000000000000000000000',
    ]) {
        assert.throws(
            () => resolveBuildJobs(oversized),
            /Unreasonable MIOFIVE_FFMPEG_BUILD_JOBS value/,
            `Expected unreasonable error for '${oversized}'`
        );
    }

    // 2. Test ambient resolution when called with no arguments
    if (process.env.MIOFIVE_FFMPEG_BUILD_JOBS) {
        assert.equal(resolveBuildJobs(), resolveBuildJobs(process.env.MIOFIVE_FFMPEG_BUILD_JOBS));
    } else {
        assert.equal(resolveBuildJobs(), 2);
    }

    // 3. Test production CLI config reader with clean isolated environment
    const cleanEnv = {...process.env};
    delete cleanEnv.MIOFIVE_FFMPEG_BUILD_JOBS;

    // Default when unset in environment
    const defaultCliResult = spawnSync(process.execPath, [configReaderPath, 'buildJobs'], {
        env: cleanEnv,
        encoding: 'utf8',
    });
    assert.equal(defaultCliResult.status, 0);
    assert.equal(defaultCliResult.stdout.trim(), '2');

    // Valid override via environment
    const overrideCliResult = spawnSync(process.execPath, [configReaderPath, 'buildJobs'], {
        env: {...cleanEnv, MIOFIVE_FFMPEG_BUILD_JOBS: '4'},
        encoding: 'utf8',
    });
    assert.equal(overrideCliResult.status, 0);
    assert.equal(overrideCliResult.stdout.trim(), '4');

    // Huge integer rejection via environment
    const hugeCliResult = spawnSync(process.execPath, [configReaderPath, 'buildJobs'], {
        env: {...cleanEnv, MIOFIVE_FFMPEG_BUILD_JOBS: '9999999999999999999999999999999999999999999999999999999999999999'},
        encoding: 'utf8',
    });
    assert.equal(hugeCliResult.status, 1);
    assert.match(hugeCliResult.stderr, /Unreasonable MIOFIVE_FFMPEG_BUILD_JOBS value/);

    // 4. Test production build script exits before platform check or side effects
    for (const value of ['0', '-1', 'abc', '99', '2.5', '9999999999999999999999999999999999999999999999999999999999999999']) {
        const result = spawnSync(scriptPath, [], {
            env: {...cleanEnv, MIOFIVE_FFMPEG_BUILD_JOBS: value},
            encoding: 'utf8',
        });
        assert.equal(result.status, 1, `Expected status 1 for MIOFIVE_FFMPEG_BUILD_JOBS=${value}`);
        assert.match(
            result.stderr,
            /Invalid MIOFIVE_FFMPEG_BUILD_JOBS value|Unreasonable MIOFIVE_FFMPEG_BUILD_JOBS value/,
            `Expected validation error for MIOFIVE_FFMPEG_BUILD_JOBS=${value}`
        );
    }
});

test('declared engine range (^22.13.0 || >=24) enforces strict Node boundaries and excludes Node 23', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    assert.equal(packageJson.engines.node, '^22.13.0 || >=24');

    // Standalone semver range checker for "^22.13.0 || >=24" without external packages
    function parseSemver(v) {
        const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(v.trim());
        if (!match) return null;
        return {
            major: Number(match[1]),
            minor: Number(match[2]),
            patch: Number(match[3]),
        };
    }

    function satisfiesDeclaredEngine(versionStr) {
        const v = parseSemver(versionStr);
        if (!v) return false;
        // ^22.13.0 means major === 22 and (minor > 13 or (minor === 13 and patch >= 0))
        const inNode22 = (v.major === 22 && (v.minor > 13 || (v.minor === 13 && v.patch >= 0)));
        // >=24 means major >= 24
        const inNode24Plus = v.major >= 24;
        return inNode22 || inNode24Plus;
    }

    // 1. Rejects Node < 22
    for (const rejected of ['18.0.0', '18.20.4', '20.0.0', '20.18.0', '20.19.0']) {
        assert.equal(satisfiesDeclaredEngine(rejected), false, `Expected ${rejected} to be rejected`);
    }

    // 2. Rejects Node 22 below minimum 22.13.0
    for (const rejected of ['22.0.0', '22.1.0', '22.12.0', '22.12.99']) {
        assert.equal(satisfiesDeclaredEngine(rejected), false, `Expected ${rejected} to be rejected (below 22.13.0)`);
    }

    // 3. Accepts minimum Node 22.13.0 and subsequent Node 22 releases
    for (const accepted of ['22.13.0', '22.13.1', '22.14.0', '22.20.0']) {
        assert.equal(satisfiesDeclaredEngine(accepted), true, `Expected ${accepted} to be accepted`);
    }

    // 4. Strictly excludes Node 23 (odd-numbered release)
    for (const rejected of ['23.0.0', '23.1.0', '23.5.0', '23.9.0']) {
        assert.equal(satisfiesDeclaredEngine(rejected), false, `Expected Node 23 (${rejected}) to be excluded`);
    }

    // 5. Accepts Node >= 24 (including host Node 26)
    for (const accepted of ['24.0.0', '24.1.0', '25.0.0', '26.0.0', '26.5.0']) {
        assert.equal(satisfiesDeclaredEngine(accepted), true, `Expected ${accepted} to be accepted`);
    }

    // 6. Verify compatibility with devDependency eslint@10.9.1 engine requirement (^20.19.0 || ^22.13.0 || >=24)
    function satisfiesEslintEngine(versionStr) {
        const v = parseSemver(versionStr);
        if (!v) return false;
        const in20 = (v.major === 20 && (v.minor > 19 || (v.minor === 19 && v.patch >= 0)));
        const in22 = (v.major === 22 && (v.minor > 13 || (v.minor === 13 && v.patch >= 0)));
        const in24 = v.major >= 24;
        return in20 || in22 || in24;
    }

    // Every version accepted by our package.json MUST satisfy ESLint's requirement
    for (const testVersion of ['22.13.0', '22.14.0', '24.0.0', '26.5.0']) {
        assert.ok(satisfiesDeclaredEngine(testVersion));
        assert.ok(satisfiesEslintEngine(testVersion), `Expected ${testVersion} to satisfy ESLint engines`);
    }
});
