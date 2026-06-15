#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const resourcesDir = path.join(rootDir, 'src-tauri', 'resources');
const binDir = path.join(resourcesDir, 'bin');
const licenseDir = path.join(resourcesDir, 'licenses');

const MARTIN_RIEDL_MACOS_ARM64_RELEASE = {
    version: '8.1.1',
    baseUrl: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1778761665_8.1.1',
    tools: {
        ffmpeg: 'ffmpeg.zip',
        ffprobe: 'ffprobe.zip',
    },
};

function firstConfiguredPath(envNames) {
    for (const envName of envNames) {
        if (process.env[envName]) {
            return process.env[envName];
        }
    }

    return null;
}

function downloadFile(url, outputPath, redirectCount = 0) {
    if (redirectCount > 5) {
        return Promise.reject(new Error(`Too many redirects for ${url}`));
    }

    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                const location = response.headers.location;
                if (!location) {
                    reject(new Error(`Redirect without location for ${url}`));
                    return;
                }
                const redirectUrl = new URL(location, url).toString();
                downloadFile(redirectUrl, outputPath, redirectCount + 1).then(resolve, reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Download failed for ${url}: HTTP ${response.statusCode}`));
                return;
            }

            const output = fs.createWriteStream(outputPath);
            response.pipe(output);
            output.on('finish', () => output.close(resolve));
            output.on('error', reject);
        });

        request.on('error', reject);
    });
}

function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function verifyChecksum(filePath, checksumPath) {
    const checksumText = fs.readFileSync(checksumPath, 'utf8').trim();
    const expected = checksumText.split(/\s+/)[0];
    const actual = sha256(filePath);

    if (!expected || expected.toLowerCase() !== actual.toLowerCase()) {
        throw new Error(`SHA-256 mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`);
    }
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

function extractZip(zipPath, outputDir) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', outputDir], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`Failed to extract ${zipPath}`);
    }
}

async function downloadMartinRiedlTool(toolName, cacheDir) {
    const zipName = MARTIN_RIEDL_MACOS_ARM64_RELEASE.tools[toolName];
    const zipPath = path.join(cacheDir, zipName);
    const checksumPath = path.join(cacheDir, `${zipName}.sha256`);
    const unzipDir = path.join(cacheDir, `${toolName}-unzip`);
    const url = `${MARTIN_RIEDL_MACOS_ARM64_RELEASE.baseUrl}/${zipName}`;

    if (!fs.existsSync(zipPath) || !fs.existsSync(checksumPath)) {
        console.log(`Downloading ${toolName} ${MARTIN_RIEDL_MACOS_ARM64_RELEASE.version} for macOS arm64...`);
        await downloadFile(url, zipPath);
        await downloadFile(`${url}.sha256`, checksumPath);
    }

    verifyChecksum(zipPath, checksumPath);
    extractZip(zipPath, unzipDir);

    const executablePath = path.join(unzipDir, toolName);
    copyExecutable(executablePath, toolName);
}

function writeBundledLicenseNotice() {
    fs.mkdirSync(licenseDir, { recursive: true });
    fs.writeFileSync(
        path.join(licenseDir, 'FFMPEG-GPL-NOTICE.txt'),
        [
            'Bundled FFmpeg and FFprobe',
            '',
            `Version: ${MARTIN_RIEDL_MACOS_ARM64_RELEASE.version}`,
            'Source: https://ffmpeg.martin-riedl.de/',
            'Binary URLs:',
            `${MARTIN_RIEDL_MACOS_ARM64_RELEASE.baseUrl}/ffmpeg.zip`,
            `${MARTIN_RIEDL_MACOS_ARM64_RELEASE.baseUrl}/ffprobe.zip`,
            '',
            'The bundled FFmpeg and FFprobe binaries report GNU GPL version 3 or later in `-L` output.',
            'The release build verifies SHA-256 checksums and rejects binaries that report nonfree components.',
            '',
            'FFmpeg source code: https://ffmpeg.org/download.html',
            'Martin Riedl build script source: https://git.martin-riedl.de/ffmpeg/build-script',
        ].join('\n')
    );
}

async function bundleDefaultMacOSArm64FFmpeg() {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        console.log(
            'No default FFmpeg bundle for this platform. Set MIOFIVE_FFMPEG_PATH and MIOFIVE_FFPROBE_PATH to bundle explicit binaries.'
        );
        return;
    }

    const cacheDir = path.join(os.homedir(), '.cache', 'miofive-video-converter', 'ffmpeg', 'macos-arm64-8.1.1');
    fs.mkdirSync(cacheDir, { recursive: true });
    await downloadMartinRiedlTool('ffmpeg', cacheDir);
    await downloadMartinRiedlTool('ffprobe', cacheDir);
    writeBundledLicenseNotice();
}

async function bundleFFmpeg() {
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
        writeBundledLicenseNotice();
        return;
    }

    if (process.env.MIOFIVE_SKIP_FFMPEG_BUNDLE === 'true') {
        console.log('Skipping FFmpeg bundle because MIOFIVE_SKIP_FFMPEG_BUNDLE=true.');
        return;
    }

    await bundleDefaultMacOSArm64FFmpeg();
}

function bundlePublicAssets() {
    const publicSource = path.join(rootDir, 'public');
    const publicOutput = path.join(resourcesDir, 'public');
    fs.rmSync(publicOutput, { recursive: true, force: true });
    fs.cpSync(publicSource, publicOutput, { recursive: true });
    console.log(`Bundled public assets: ${publicOutput}`);
}

(async function main() {
    await bundleFFmpeg();
    bundlePublicAssets();
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
