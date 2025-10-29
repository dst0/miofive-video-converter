#!/usr/bin/env node
// ffmpeg-check-install.js
const { spawn, spawnSync } = require('child_process');

function runStream(command, { cwd, env } = {}) {
    // Stream output live; support shell pipes/&& via shell:true
    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, stdio: 'inherit', cwd, env });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Command failed: ${command} (exit ${code})`))));
    });
}

function runCapture(command) {
    // Capture output (for version checks)
    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `exit ${code}`))));
    });
}

function hasCmd(cmd) {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    const res = spawnSync(probe, { shell: true, stdio: 'ignore' });
    return res.status === 0;
}

async function checkFFmpeg() {
    try {
        await runCapture('ffmpeg -version');
        return true;
    } catch {
        return false;
    }
}

async function printFFmpegVersion() {
    try {
        const { stdout } = await runCapture('ffmpeg -version');
        const m = stdout.match(/ffmpeg version\s+([^\s]+)/i);
        if (m) console.log(`   Version: ${m[1]}`);
    } catch {
        // ignore
    }
}

async function installFFmpeg() {
    const platform = process.platform;
    console.log('FFmpeg not found. Attempting to install...\n');

    try {
        if (platform === 'darwin') {
            console.log('Detected macOS.');
            if (!hasCmd('brew')) {
                console.error('❌ Homebrew is not installed.\nInstall from https://brew.sh then run: brew install ffmpeg');
                throw new Error('brew not found');
            }
            console.log('Installing via Homebrew:\n$ brew install ffmpeg\n');
            await runStream('brew update');
            await runStream('brew install ffmpeg');
        } else if (platform === 'linux') {
            console.log('Detected Linux.');
            // Try common package managers in order
            if (hasCmd('apt')) {
                console.log('Installing via apt (sudo may prompt for password)…\n$ sudo apt update && sudo apt install -y ffmpeg\n');
                await runStream('sudo apt update');
                await runStream('sudo apt install -y ffmpeg');
            } else if (hasCmd('dnf')) {
                console.log('Installing via dnf…\n$ sudo dnf install -y ffmpeg\n');
                await runStream('sudo dnf install -y ffmpeg');
            } else if (hasCmd('pacman')) {
                console.log('Installing via pacman…\n$ sudo pacman -Sy --noconfirm ffmpeg\n');
                await runStream('sudo pacman -Sy --noconfirm ffmpeg');
            } else {
                throw new Error('No supported package manager (apt/dnf/pacman) found.');
            }
        } else if (platform === 'win32') {
            console.log('Detected Windows.');
            // Try Chocolatey or Scoop if available
            if (hasCmd('choco')) {
                console.log('Installing via Chocolatey:\n> choco install ffmpeg -y\n');
                await runStream('choco install ffmpeg -y');
            } else if (hasCmd('scoop')) {
                console.log('Installing via Scoop:\n> scoop install ffmpeg\n');
                await runStream('scoop install ffmpeg');
            } else {
                console.error('❌ Neither Chocolatey nor Scoop found.');
                console.error('Please install FFmpeg manually:\n  1) https://ffmpeg.org/download.html (Windows builds)\n  2) Add the "bin" folder to your PATH\nOr install a package manager:\n  - Chocolatey: https://chocolatey.org/install  (then: choco install ffmpeg)\n  - Scoop: https://scoop.sh  (then: scoop install ffmpeg)');
                throw new Error('no package manager on Windows');
            }
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        console.log('\n✅ FFmpeg installation completed!');
    } catch (err) {
        console.error('\n❌ Failed to install FFmpeg.');
        if (err && err.message) console.error(err.message);
        throw err;
    }
}

(async function main() {
    try {
        console.log('Checking for FFmpeg…\n');
        const has = await checkFFmpeg();

        if (has) {
            console.log('✅ FFmpeg is already installed and available in PATH.');
            await printFFmpegVersion();
            console.log('\nYou can start the server now with: npm start');
            return;
        }

        await installFFmpeg();

        // Verify
        if (await checkFFmpeg()) {
            console.log('\n✅ FFmpeg verified successfully!');
            await printFFmpegVersion();
            console.log('You can start the server now with: npm start');
        } else {
            console.error('\n❌ FFmpeg installation could not be verified.');
            console.error('Please ensure FFmpeg is in your PATH and try again.');
            process.exit(1);
        }
    } catch {
        process.exit(1);
    }
})();
