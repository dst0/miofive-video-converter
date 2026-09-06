#!/usr/bin/env node
'use strict';

const {randomUUID} = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const {validateBundledBuild} = require('./copy-ffmpeg-binaries');

const appName = 'Miofive Video Converter.app';
const source = path.resolve('src-tauri', 'target', 'release', 'bundle', 'macos', appName);
const applicationsDirectory = path.join(os.homedir(), 'Applications');
const destination = path.join(applicationsDirectory, appName);

async function pathExists(targetPath, fileSystem = fs) {
    try {
        await fileSystem.access(targetPath);
        return true;
    } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
    }
}

async function assertRegularFile(filePath, fileSystem, description, {executable = false} = {}) {
    let stat;
    try {
        stat = await fileSystem.stat(filePath);
    } catch {
        throw new Error(`${description} not found: ${filePath}`);
    }
    if (!stat.isFile()) {
        throw new Error(`${description} is not a regular file: ${filePath}`);
    }
    if (stat.size <= 0) {
        throw new Error(`${description} is empty: ${filePath}`);
    }

    const rOk = (fileSystem.constants && fileSystem.constants.R_OK !== undefined)
        ? fileSystem.constants.R_OK
        : fsSync.constants.R_OK;
    try {
        await fileSystem.access(filePath, rOk);
    } catch {
        throw new Error(`${description} is not readable: ${filePath}`);
    }

    if (executable) {
        const xOk = (fileSystem.constants && fileSystem.constants.X_OK !== undefined)
            ? fileSystem.constants.X_OK
            : fsSync.constants.X_OK;
        try {
            await fileSystem.access(filePath, xOk);
        } catch {
            throw new Error(`${description} is not executable: ${filePath}`);
        }
        if ((stat.mode & 0o111) === 0) {
            throw new Error(`${description} is not executable: ${filePath}`);
        }
    }
}

async function validateBundle(bundlePath, fileSystem = fs) {
    let bundleStat;
    try {
        bundleStat = await fileSystem.stat(bundlePath);
    } catch {
        throw new Error(`The built application bundle was not found: ${bundlePath}`);
    }
    if (!bundleStat.isDirectory()) {
        throw new Error(`The built application bundle is not a directory: ${bundlePath}`);
    }

    await assertRegularFile(path.join(bundlePath, 'Contents', 'Info.plist'), fileSystem, 'Info.plist');
    await assertRegularFile(path.join(bundlePath, 'Contents', 'MacOS', 'miofive-video-converter'), fileSystem, 'Host executable', {executable: true});
    await assertRegularFile(path.join(bundlePath, 'Contents', 'MacOS', 'miofive-server'), fileSystem, 'Sidecar executable', {executable: true});

    const resourcesDirectory = path.join(bundlePath, 'Contents', 'Resources', 'resources');
    let resourcesStat;
    try {
        resourcesStat = await fileSystem.stat(resourcesDirectory);
    } catch {
        throw new Error(`Resources directory not found: ${resourcesDirectory}`);
    }
    if (!resourcesStat.isDirectory()) {
        throw new Error(`Resources directory is not a directory: ${resourcesDirectory}`);
    }

    const binDirectory = path.join(resourcesDirectory, 'bin');
    const ffmpegPath = path.join(binDirectory, 'ffmpeg');
    const ffprobePath = path.join(binDirectory, 'ffprobe');
    const hasFfmpeg = await pathExists(ffmpegPath, fileSystem);
    const hasFfprobe = await pathExists(ffprobePath, fileSystem);
    if (!hasFfmpeg || !hasFfprobe) {
        throw new Error(
            'Missing bundled ffmpeg/ffprobe binaries. If this bundle was created with ' +
            'MIOFIVE_SKIP_FFMPEG_BUNDLE for local development, run via development workflow instead.'
        );
    }
    await assertRegularFile(ffmpegPath, fileSystem, 'FFmpeg binary', {executable: true});
    await assertRegularFile(ffprobePath, fileSystem, 'FFprobe binary', {executable: true});

    const publicDirectory = path.join(resourcesDirectory, 'public');
    const requiredPublicAssets = [
        'index.html',
        'app.js',
        'player.js',
        'folder-browser.js',
        'security.js',
        'demo-api-mock.js',
        'dialog.js',
        'styles.css',
        'player-styles.css',
    ];
    for (const assetName of requiredPublicAssets) {
        await assertRegularFile(path.join(publicDirectory, assetName), fileSystem, `Public asset ${assetName}`);
    }

    const licensesDirectory = path.join(resourcesDirectory, 'licenses');
    const requiredNotices = ['PROJECT-LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'FFMPEG-GPL-NOTICE.txt'];
    for (const noticeName of requiredNotices) {
        await assertRegularFile(path.join(licensesDirectory, noticeName), fileSystem, `License notice ${noticeName}`);
    }

    const mediaNoticePath = path.join(licensesDirectory, 'FFMPEG-GPL-NOTICE.txt');
    const mediaNoticeContent = await fileSystem.readFile(mediaNoticePath, 'utf8');
    const isExplicitEnvPaths = /Source type:\s*explicit-env-paths/i.test(mediaNoticeContent);
    const isSourceBuilt = /Source type:\s*source-built/i.test(mediaNoticeContent);

    const manifestFile = path.join(resourcesDirectory, 'BUILD-MANIFEST.txt');
    const manifestExists = await pathExists(manifestFile, fileSystem);

    if (manifestExists) {
        validateBundledBuild(resourcesDirectory);
    } else if (isExplicitEnvPaths) {
        // Explicit operator-supplied local bundle without source-pin manifest; binaries already validated
    } else if (isSourceBuilt) {
        throw new Error(`Missing build manifest for source-built bundle: ${manifestFile}`);
    } else {
        throw new Error(`Missing build manifest: ${manifestFile}`);
    }
}

async function installBundle({
    sourcePath = source,
    destinationPath = destination,
    fileSystem = fs,
    uniqueSuffix = `${process.pid}-${randomUUID()}`,
} = {}) {
    await validateBundle(sourcePath, fileSystem);

    const destinationDirectory = path.dirname(destinationPath);
    const destinationName = path.basename(destinationPath);
    const staging = path.join(destinationDirectory, `.${destinationName}.install-${uniqueSuffix}`);
    await fileSystem.mkdir(destinationDirectory, {recursive: true});

    let ownsStaging = false;
    let backup;

    try {
        await fileSystem.mkdir(staging);
        ownsStaging = true;

        await fileSystem.cp(sourcePath, staging, {recursive: true, force: true});

        await validateBundle(staging, fileSystem);

        if (await pathExists(destinationPath, fileSystem)) {
            backup = `${destinationPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            await fileSystem.rename(destinationPath, backup);
        }

        await fileSystem.rename(staging, destinationPath);
        ownsStaging = false;
    } catch (error) {
        if (ownsStaging) {
            await fileSystem.rm(staging, {recursive: true, force: true}).catch(() => {});
        }
        if (backup && !(await pathExists(destinationPath, fileSystem))) {
            try {
                await fileSystem.rename(backup, destinationPath);
            } catch (rollbackError) {
                throw new AggregateError(
                    [error, rollbackError],
                    `Installation failed (${error.message || error}) and restoration from backup failed: ${rollbackError.message || rollbackError}`,
                    {cause: rollbackError}
                );
            }
        }
        throw error;
    }

    return {backup};
}

async function install() {
    const {backup} = await installBundle();
    console.log(backup ? `Installed ${appName}; the previous bundle was preserved as a backup.` : `Installed ${appName}.`);
}

if (require.main === module) {
    install().catch((error) => {
        const message = error && error.message ? error.message : 'Unknown installation error.';
        console.error(`Unable to install the application bundle: ${message}`);
        process.exit(1);
    });
}

module.exports = {installBundle, validateBundle};
