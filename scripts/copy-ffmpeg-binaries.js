#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const resourcesDir = path.join(rootDir, 'src-tauri', 'resources');
const binDir = path.join(resourcesDir, 'bin');
const licenseDir = path.join(resourcesDir, 'licenses');
const sourceBuiltDir = path.join(rootDir, 'vendor', 'ffmpeg', 'macos-arm64');
const buildManifestPath = path.join(sourceBuiltDir, 'BUILD-MANIFEST.txt');

function firstConfiguredPath(envNames) {
    for (const envName of envNames) {
        if (process.env[envName]) {
            return process.env[envName];
        }
    }

    return null;
}

function assertRedistributableBinary(sourcePath, outputName) {
    const result = spawnSync(sourcePath, ['-L'], { encoding: 'utf8' });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    if (result.status !== 0) {
        throw new Error(`Unable to inspect ${outputName} license with "${sourcePath} -L"`);
    }

    if (/nonfree|not legally redistributable/i.test(output)) {
        throw new Error(
            `${outputName} reports nonfree components and is not legally redistributable. ` +
            'Use a redistributable LGPL/GPL FFmpeg build instead.'
        );
    }
}

function copyExecutable(sourcePath, outputName) {
    const resolved = path.resolve(sourcePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
        throw new Error(`${outputName} path is not a file: ${resolved}`);
    }

    assertRedistributableBinary(resolved, outputName);

    const outputPath = path.join(binDir, outputName);
    fs.copyFileSync(resolved, outputPath);
    fs.chmodSync(outputPath, 0o755);
    console.log(`Bundled ${outputName}: ${outputPath}`);
}

function writeBundledLicenseNotice(source = 'source-built') {
    fs.mkdirSync(licenseDir, { recursive: true });
    const manifestText = fs.existsSync(buildManifestPath)
        ? fs.readFileSync(buildManifestPath, 'utf8')
        : '';
    fs.writeFileSync(
        path.join(licenseDir, 'FFMPEG-GPL-NOTICE.txt'),
        [
            'Bundled FFmpeg and FFprobe',
            '',
            `Source type: ${source}`,
            'The default macOS arm64 release builds FFmpeg and x264 from pinned upstream source archives.',
            '',
            'The release build verifies source archive SHA-256 checksums and rejects built binaries that report nonfree components.',
            'The bundled FFmpeg and FFprobe binaries report GPL/LGPL terms in `-L` output.',
            '',
            'FFmpeg source code: https://ffmpeg.org/download.html',
            'x264 source code: https://code.videolan.org/videolan/x264',
            '',
            manifestText,
        ].join('\n')
    );
}

function buildDefaultMacOSArm64FFmpeg() {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        throw new Error(
            'No default source-built FFmpeg bundle for this platform. Set MIOFIVE_FFMPEG_PATH and MIOFIVE_FFPROBE_PATH to bundle explicit binaries.'
        );
    }

    const ffmpegPath = path.join(sourceBuiltDir, 'bin', 'ffmpeg');
    const ffprobePath = path.join(sourceBuiltDir, 'bin', 'ffprobe');

    if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
        const scriptPath = path.join(rootDir, 'scripts', 'build-ffmpeg-macos-arm64.sh');
        const result = spawnSync(scriptPath, { cwd: rootDir, stdio: 'inherit' });
        if (result.status !== 0) {
            throw new Error(`Source FFmpeg build failed with exit code ${result.status}`);
        }
    }

    copyExecutable(ffmpegPath, 'ffmpeg');
    copyExecutable(ffprobePath, 'ffprobe');
    writeBundledLicenseNotice('source-built');
}

function bundleFFmpeg() {
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.rmSync(licenseDir, { recursive: true, force: true });

    const ffmpegPath = firstConfiguredPath(['MIOFIVE_FFMPEG_PATH', 'FFMPEG_PATH']);
    const ffprobePath = firstConfiguredPath(['MIOFIVE_FFPROBE_PATH', 'FFPROBE_PATH']);

    if (ffmpegPath || ffprobePath) {
        if (!ffmpegPath || !ffprobePath) {
            throw new Error(
                'Set both MIOFIVE_FFMPEG_PATH and MIOFIVE_FFPROBE_PATH to bundle FFmpeg.'
            );
        }

        copyExecutable(ffmpegPath, 'ffmpeg');
        copyExecutable(ffprobePath, 'ffprobe');
        writeBundledLicenseNotice('explicit-env-paths');
        return;
    }

    if (process.env.MIOFIVE_SKIP_FFMPEG_BUNDLE === 'true') {
        console.log('Skipping FFmpeg bundle because MIOFIVE_SKIP_FFMPEG_BUNDLE=true.');
        return;
    }

    buildDefaultMacOSArm64FFmpeg();
}

function bundlePublicAssets() {
    const publicSource = path.join(rootDir, 'public');
    const publicOutput = path.join(resourcesDir, 'public');
    fs.rmSync(publicOutput, { recursive: true, force: true });
    fs.cpSync(publicSource, publicOutput, { recursive: true });
    console.log(`Bundled public assets: ${publicOutput}`);
}

function main() {
    bundleFFmpeg();
    bundlePublicAssets();
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exit(1);
}
