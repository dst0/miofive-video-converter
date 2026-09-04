#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const buildConfig = require('./ffmpeg-build-config');

const rootDir = path.join(__dirname, '..');
const resourcesDir = path.join(rootDir, 'src-tauri', 'resources');
const binDir = path.join(resourcesDir, 'bin');
const licenseDir = path.join(resourcesDir, 'licenses');
const sourceBuiltDir = path.join(rootDir, 'vendor', 'ffmpeg', 'macos-arm64');

function runInspection(command, args, description) {
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0) {
        throw new Error(`Unable to inspect ${description}`);
    }
    return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function sanitizeIdentity(value) {
    const sanitized = Array.from(value, (character) => {
        const code = character.charCodeAt(0);
        return (code < 32 || code === 127) ? ' ' : character;
    }).join('');
    return sanitized.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function compareVersions(left, right) {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
        const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
        if (difference !== 0) return Math.sign(difference);
    }
    return 0;
}

function parseMinimumMacosVersions(output) {
    const versions = [];
    for (const match of output.matchAll(/^\s*minos\s+(\d+(?:\.\d+){1,2})\s*$/gm)) {
        versions.push(match[1]);
    }
    for (const match of output.matchAll(/LC_VERSION_MIN_MACOSX[\s\S]{0,160}?^\s*version\s+(\d+(?:\.\d+){1,2})\s*$/gm)) {
        versions.push(match[1]);
    }
    return [...new Set(versions)];
}

function assertMacArm64Compatibility(binaryPath, outputName) {
    if (process.platform !== 'darwin') return;

    const fileOutput = runInspection('/usr/bin/file', ['-b', binaryPath], `${outputName} architecture`);
    if (!/\barm64\b/.test(fileOutput)) {
        throw new Error(`${outputName} does not contain an Apple Silicon arm64 executable`);
    }

    const loadCommands = runInspection('/usr/bin/otool', ['-l', binaryPath], `${outputName} deployment target`);
    const minimumVersions = parseMinimumMacosVersions(loadCommands);
    if (minimumVersions.length === 0) {
        throw new Error(`${outputName} does not declare a readable minimum macOS version`);
    }
    const unsupported = minimumVersions.find(
        (version) => compareVersions(version, buildConfig.minimumMacosVersion) > 0
    );
    if (unsupported) {
        throw new Error(
            `${outputName} requires macOS ${unsupported}, above the app minimum ${buildConfig.minimumMacosVersion}`
        );
    }
}

function inspectRedistributableBinary(sourcePath, outputName, {expectedVersion, requireMacArm64 = false} = {}) {
    const resolved = path.resolve(sourcePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
        throw new Error(`${outputName} path is not a file: ${resolved}`);
    }
    fs.accessSync(resolved, fs.constants.X_OK);

    const versionOutput = runInspection(resolved, ['-version'], `${outputName} version`);
    const identity = sanitizeIdentity(versionOutput.split(/\r?\n/, 1)[0] || '');
    const expectedPrefix = `${outputName} version `;
    if (!identity.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
        throw new Error(`${outputName} did not report the expected executable identity`);
    }
    if (expectedVersion) {
        const reportedVersion = identity.slice(expectedPrefix.length).split(/\s+/, 1)[0];
        if (reportedVersion !== expectedVersion) {
            throw new Error(`${outputName} version ${reportedVersion} does not match pinned ${expectedVersion}`);
        }
    }

    const licenseOutput = runInspection(resolved, ['-L'], `${outputName} license`);
    if (/--enable-nonfree/.test(licenseOutput) || /not legally redistributable|nonfree parts|non-free/i.test(licenseOutput)) {
        throw new Error(
            `${outputName} reports nonfree components and is not legally redistributable. ` +
            'Use a redistributable LGPL/GPL FFmpeg build instead.'
        );
    }
    if (!/GNU (?:Lesser )?General Public License/i.test(licenseOutput)) {
        throw new Error(`${outputName} did not report expected GPL/LGPL redistribution terms`);
    }

    if (requireMacArm64) assertMacArm64Compatibility(resolved, outputName);
    return {resolved, identity};
}

function parseBuildManifest(text) {
    const fields = new Map();
    let section = null;
    for (const line of text.split(/\r?\n/)) {
        const sectionMatch = /^([A-Za-z0-9]+):\s*$/.exec(line);
        if (sectionMatch) {
            section = sectionMatch[1];
            continue;
        }
        const fieldMatch = /^\s{2}([a-z0-9_]+):\s*(.+)\s*$/.exec(line);
        if (!section || !fieldMatch) continue;
        const key = `${section}.${fieldMatch[1]}`;
        if (fields.has(key)) throw new Error(`Duplicate build manifest field: ${key}`);
        fields.set(key, fieldMatch[2]);
    }
    return fields;
}

function assertPinnedBuildManifest(text) {
    const fields = parseBuildManifest(text);
    const expected = new Map([
        ['FFmpeg.version', buildConfig.ffmpeg.version],
        ['FFmpeg.source', buildConfig.ffmpeg.url],
        ['FFmpeg.sha256', buildConfig.ffmpeg.sha256],
        ['x264.commit', buildConfig.x264.commit],
        ['x264.source', buildConfig.x264.url],
        ['x264.sha256', buildConfig.x264.sha256],
        ['Build.minimum_macos', buildConfig.minimumMacosVersion],
    ]);

    for (const [key, value] of expected) {
        if (fields.get(key) !== value) {
            throw new Error(`Build manifest ${key} does not match the repository pin`);
        }
    }
    return fields;
}

function copyInspectedExecutable(inspection, outputName) {
    const outputPath = path.join(binDir, outputName);
    fs.copyFileSync(inspection.resolved, outputPath);
    fs.chmodSync(outputPath, 0o755);
    console.log(`Bundled ${outputName}: ${outputPath}`);
}

function resetBundledFFmpegOutput() {
    fs.rmSync(binDir, {recursive: true, force: true});
    fs.mkdirSync(binDir, {recursive: true});
    fs.rmSync(licenseDir, {recursive: true, force: true});
    fs.rmSync(path.join(resourcesDir, 'BUILD-MANIFEST.txt'), {force: true});
}

function writeBundledLicenseNotice({source, inspections, manifestText = ''}) {
    fs.mkdirSync(licenseDir, {recursive: true});
    const sourceDescription = source === 'source-built'
        ? [
            'The binaries were built from the checksum-pinned repository configuration.',
            'The validated build manifest is included below.',
        ]
        : [
            'The binaries were supplied explicitly by the release operator.',
            'Their upstream source and checksum provenance are not asserted by this repository notice.',
        ];
    const lines = [
        'Bundled FFmpeg and FFprobe',
        '',
        `Source type: ${source}`,
        ...sourceDescription,
        '',
        `FFmpeg identity: ${inspections.ffmpeg.identity}`,
        `FFprobe identity: ${inspections.ffprobe.identity}`,
        'Both binaries reported GPL/LGPL terms and no nonfree components in `-L` output.',
        '',
        'FFmpeg source code: https://ffmpeg.org/download.html',
        'x264 source code: https://code.videolan.org/videolan/x264',
    ];
    if (manifestText) lines.push('', manifestText.trim(), '');
    fs.writeFileSync(path.join(licenseDir, 'FFMPEG-GPL-NOTICE.txt'), lines.join('\n'));
}

function computeSha256(filePath) {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

function verifySourceBuildArtifacts(manifestFields, binDirectory) {
    const expectedFfmpeg = manifestFields.get('Artifacts.ffmpeg_sha256');
    const expectedFfprobe = manifestFields.get('Artifacts.ffprobe_sha256');
    if (!expectedFfmpeg || !expectedFfprobe) {
        throw new Error('Build manifest missing Artifacts binary SHA-256 digests');
    }
    const ffmpegPath = path.join(binDirectory, 'ffmpeg');
    const ffprobePath = path.join(binDirectory, 'ffprobe');
    const actualFfmpeg = computeSha256(ffmpegPath);
    if (actualFfmpeg !== expectedFfmpeg) {
        throw new Error(`ffmpeg binary digest mismatch: expected ${expectedFfmpeg}, got ${actualFfmpeg}`);
    }
    const actualFfprobe = computeSha256(ffprobePath);
    if (actualFfprobe !== expectedFfprobe) {
        throw new Error(`ffprobe binary digest mismatch: expected ${expectedFfprobe}, got ${actualFfprobe}`);
    }
}

function generateBuildManifestText({
    ffmpegSha256,
    ffprobeSha256,
    host,
    minimumMacos = buildConfig.minimumMacosVersion,
    compiler,
    configure = '--disable-autodetect --disable-debug --disable-doc --disable-ffplay --disable-network --enable-gpl --enable-version3 --enable-libx264 --disable-nonfree',
} = {}) {
    if (!ffmpegSha256 || !/^[a-f0-9]{64}$/i.test(ffmpegSha256)) {
        throw new Error(`Invalid or missing ffmpeg SHA-256 digest: ${ffmpegSha256}`);
    }
    if (!ffprobeSha256 || !/^[a-f0-9]{64}$/i.test(ffprobeSha256)) {
        throw new Error(`Invalid or missing ffprobe SHA-256 digest: ${ffprobeSha256}`);
    }

    let detectedHost = host;
    if (!detectedHost) {
        const unameS = spawnSync('uname', ['-s'], {encoding: 'utf8'}).stdout || '';
        const unameM = spawnSync('uname', ['-m'], {encoding: 'utf8'}).stdout || '';
        detectedHost = `${unameS.trim()} ${unameM.trim()}`.trim() || 'Darwin arm64';
    }

    let detectedCompiler = compiler;
    if (!detectedCompiler) {
        try {
            const clangOutput = runInspection('/usr/bin/clang', ['--version'], 'clang version');
            detectedCompiler = (clangOutput.split(/\r?\n/)[0] || '').trim();
        } catch {
            detectedCompiler = 'Apple clang';
        }
    }

    const lines = [
        'Miofive Video Converter bundled FFmpeg build',
        '',
        'FFmpeg:',
        `  version: ${buildConfig.ffmpeg.version}`,
        `  source: ${buildConfig.ffmpeg.url}`,
        `  sha256: ${buildConfig.ffmpeg.sha256}`,
        '',
        'x264:',
        `  commit: ${buildConfig.x264.commit}`,
        `  source: ${buildConfig.x264.url}`,
        `  sha256: ${buildConfig.x264.sha256}`,
        '',
        'Build:',
        `  host: ${detectedHost}`,
        `  minimum_macos: ${minimumMacos}`,
        `  compiler: ${detectedCompiler}`,
        `  configure: ${configure}`,
        '',
        'Artifacts:',
        `  ffmpeg_sha256: ${ffmpegSha256.toLowerCase()}`,
        `  ffprobe_sha256: ${ffprobeSha256.toLowerCase()}`,
        '',
        'Validation:',
        '  ffmpeg -L and ffprobe -L were checked and did not report nonfree components.',
        '',
    ];
    return lines.join('\n');
}

function validateSourceBuild(targetDir = sourceBuiltDir) {
    const manifestFile = path.join(targetDir, 'BUILD-MANIFEST.txt');
    if (!fs.existsSync(manifestFile)) {
        throw new Error(`Build manifest not found: ${manifestFile}`);
    }
    const manifestText = fs.readFileSync(manifestFile, 'utf8');
    const fields = assertPinnedBuildManifest(manifestText);
    const binDirectory = path.join(targetDir, 'bin');
    verifySourceBuildArtifacts(fields, binDirectory);
    return {manifestText, fields, binDirectory};
}

function validateBundledBuild(resourcesDirectory = resourcesDir) {
    const manifestFile = path.join(resourcesDirectory, 'BUILD-MANIFEST.txt');
    if (!fs.existsSync(manifestFile)) {
        throw new Error(`Bundled build manifest not found: ${manifestFile}`);
    }
    const manifestText = fs.readFileSync(manifestFile, 'utf8');
    const fields = assertPinnedBuildManifest(manifestText);
    const binDirectory = path.join(resourcesDirectory, 'bin');
    verifySourceBuildArtifacts(fields, binDirectory);
    return {manifestText, fields, binDirectory};
}

function recordSourceBuildManifest(targetDir = sourceBuiltDir) {
    const binDirectory = path.join(targetDir, 'bin');
    const ffmpegPath = path.join(binDirectory, 'ffmpeg');
    const ffprobePath = path.join(binDirectory, 'ffprobe');

    if (!fs.existsSync(ffmpegPath)) {
        throw new Error(`Source-built ffmpeg binary not found: ${ffmpegPath}`);
    }
    if (!fs.existsSync(ffprobePath)) {
        throw new Error(`Source-built ffprobe binary not found: ${ffprobePath}`);
    }

    const ffmpegSha256 = computeSha256(ffmpegPath);
    const ffprobeSha256 = computeSha256(ffprobePath);

    const manifestText = generateBuildManifestText({
        ffmpegSha256,
        ffprobeSha256,
        minimumMacos: buildConfig.minimumMacosVersion,
    });

    const fields = assertPinnedBuildManifest(manifestText);
    verifySourceBuildArtifacts(fields, binDirectory);

    const manifestFile = path.join(targetDir, 'BUILD-MANIFEST.txt');
    writeManifestAtomically(manifestFile, manifestText);
    return {manifestText, fields, manifestFile};
}

function writeManifestAtomically(manifestFile, manifestText) {
    // The parent build directory must be operator-owned and not concurrently
    // replaced. Never truncate/reopen a potentially replaced destination link.
    const temporaryFile = `${manifestFile}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    let ownsTemporary = false;
    try {
        descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
        ownsTemporary = true;
        fs.writeFileSync(descriptor, manifestText, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporaryFile, manifestFile);
    } catch (error) {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* Keep the decisive write failure. */ }
        }
        if (ownsTemporary) {
            try { fs.unlinkSync(temporaryFile); } catch { /* Preserve uncertain cleanup state. */ }
        }
        throw error;
    }
}

function regenerateAndValidateManifest(targetDir = sourceBuiltDir) {
    const binDirectory = path.join(targetDir, 'bin');
    const ffmpegPath = path.join(binDirectory, 'ffmpeg');
    const ffprobePath = path.join(binDirectory, 'ffprobe');

    if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
        throw new Error(`Cached source-built binaries not found in ${binDirectory}`);
    }

    const manifestFile = path.join(targetDir, 'BUILD-MANIFEST.txt');
    // 1. Validate the existing trusted record: repository pins + matching binary hashes
    let descriptor;
    let existingText;
    try {
        descriptor = fs.openSync(manifestFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        if (!fs.fstatSync(descriptor).isFile()) throw new Error('Build manifest must be a regular file');
        existingText = fs.readFileSync(descriptor, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Cannot regenerate cached manifest without existing build manifest in ${targetDir}`, {cause: error});
        }
        throw error;
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    const existingFields = assertPinnedBuildManifest(existingText);
    // verifySourceBuildArtifacts proves binary bytes match the recorded hashes
    verifySourceBuildArtifacts(existingFields, binDirectory);

    // 2. Regenerate preserving original build metadata (host, compiler, configure)
    const ffmpegSha256 = existingFields.get('Artifacts.ffmpeg_sha256');
    const ffprobeSha256 = existingFields.get('Artifacts.ffprobe_sha256');
    const host = existingFields.get('Build.host') || 'Darwin arm64';
    const minimumMacos = existingFields.get('Build.minimum_macos') || buildConfig.minimumMacosVersion;
    const compiler = existingFields.get('Build.compiler');
    const configure = existingFields.get('Build.configure');

    const manifestText = generateBuildManifestText({
        ffmpegSha256,
        ffprobeSha256,
        host,
        minimumMacos,
        compiler,
        configure,
    });

    const fields = assertPinnedBuildManifest(manifestText);
    verifySourceBuildArtifacts(fields, binDirectory);
    writeManifestAtomically(manifestFile, manifestText);
    return {manifestText, fields, manifestFile};
}

function generateAndSaveBuildManifest(targetDir = sourceBuiltDir, options = {}) {
    return regenerateAndValidateManifest(targetDir, options);
}

function inspectSourceBuild() {
    const {manifestText, binDirectory} = validateSourceBuild(sourceBuiltDir);
    const ffmpeg = inspectRedistributableBinary(
        path.join(binDirectory, 'ffmpeg'),
        'ffmpeg',
        {expectedVersion: buildConfig.ffmpeg.version, requireMacArm64: true}
    );
    const ffprobe = inspectRedistributableBinary(
        path.join(binDirectory, 'ffprobe'),
        'ffprobe',
        {expectedVersion: buildConfig.ffmpeg.version, requireMacArm64: true}
    );
    return {manifestText, ffmpeg, ffprobe};
}

function buildDefaultMacOSArm64FFmpeg() {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        throw new Error(
            'No default source-built FFmpeg bundle for this platform. Set MIOFIVE_FFMPEG_PATH and MIOFIVE_FFPROBE_PATH to bundle explicit binaries.'
        );
    }

    let sourceBuild;
    try {
        sourceBuild = inspectSourceBuild();
    } catch (error) {
        console.warn(`Existing source FFmpeg bundle is not reusable: ${error.message}`);
        const scriptPath = path.join(rootDir, 'scripts', 'build-ffmpeg-macos-arm64.sh');
        const result = spawnSync(scriptPath, {cwd: rootDir, stdio: 'inherit'});
        if (result.status !== 0) {
            throw new Error(`Source FFmpeg build failed with exit code ${result.status}`, {cause: error});
        }
        sourceBuild = inspectSourceBuild();
    }

    resetBundledFFmpegOutput();
    copyInspectedExecutable(sourceBuild.ffmpeg, 'ffmpeg');
    copyInspectedExecutable(sourceBuild.ffprobe, 'ffprobe');
    fs.writeFileSync(path.join(resourcesDir, 'BUILD-MANIFEST.txt'), sourceBuild.manifestText, 'utf8');
    writeBundledLicenseNotice({
        source: 'source-built',
        inspections: sourceBuild,
        manifestText: sourceBuild.manifestText,
    });
}

function bundleExplicitFFmpeg(ffmpegPath, ffprobePath) {
    const inspections = {
        ffmpeg: inspectRedistributableBinary(ffmpegPath, 'ffmpeg', {requireMacArm64: true}),
        ffprobe: inspectRedistributableBinary(ffprobePath, 'ffprobe', {requireMacArm64: true}),
    };
    resetBundledFFmpegOutput();
    copyInspectedExecutable(inspections.ffmpeg, 'ffmpeg');
    copyInspectedExecutable(inspections.ffprobe, 'ffprobe');
    writeBundledLicenseNotice({source: 'explicit-env-paths', inspections});
}

function bundleFFmpeg() {
    const ffmpegPath = process.env.MIOFIVE_FFMPEG_PATH;
    const ffprobePath = process.env.MIOFIVE_FFPROBE_PATH;
    if (ffmpegPath || ffprobePath) {
        if (!ffmpegPath || !ffprobePath) {
            throw new Error('Set both MIOFIVE_FFMPEG_PATH and MIOFIVE_FFPROBE_PATH to bundle FFmpeg.');
        }
        bundleExplicitFFmpeg(ffmpegPath, ffprobePath);
        return;
    }

    if (process.env.MIOFIVE_SKIP_FFMPEG_BUNDLE === 'true') {
        resetBundledFFmpegOutput();
        console.log('Skipping FFmpeg bundle because MIOFIVE_SKIP_FFMPEG_BUNDLE=true.');
        return;
    }

    buildDefaultMacOSArm64FFmpeg();
}

function bundlePublicAssets() {
    const publicSource = path.join(rootDir, 'public');
    const publicOutput = path.join(resourcesDir, 'public');
    fs.rmSync(publicOutput, {recursive: true, force: true});
    fs.cpSync(publicSource, publicOutput, {recursive: true});
    console.log(`Bundled public assets: ${publicOutput}`);
}

function main() {
    if (process.argv.includes('--record-manifest') || process.argv.includes('record-manifest')) {
        recordSourceBuildManifest();
        console.log('Build manifest recorded and verified for fresh source build.');
        return;
    }
    if (
        process.argv.includes('--generate-manifest') || process.argv.includes('generate-manifest') ||
        process.argv.includes('--regenerate-manifest') || process.argv.includes('regenerate-manifest')
    ) {
        regenerateAndValidateManifest();
        console.log('Build manifest regenerated and verified against trusted artifact pins.');
        return;
    }
    if (process.argv.includes('--validate-manifest') || process.argv.includes('validate-manifest')) {
        validateSourceBuild();
        console.log('Build manifest and artifact hashes verified.');
        return;
    }
    bundleFFmpeg();
    bundlePublicAssets();
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = {
    assertPinnedBuildManifest,
    compareVersions,
    computeSha256,
    generateAndSaveBuildManifest,
    generateBuildManifestText,
    inspectRedistributableBinary,
    parseBuildManifest,
    parseMinimumMacosVersions,
    recordSourceBuildManifest,
    regenerateAndValidateManifest,
    validateBundledBuild,
    validateSourceBuild,
    verifySourceBuildArtifacts,
};
