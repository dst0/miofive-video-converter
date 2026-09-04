#!/usr/bin/env node
'use strict';

const {randomUUID} = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const appName = 'Miofive Video Converter.app';
const source = path.resolve('src-tauri', 'target', 'release', 'bundle', 'macos', appName);
const applicationsDirectory = path.join(os.homedir(), 'Applications');
const destination = path.join(applicationsDirectory, appName);

async function pathExists(targetPath, fileSystem = fs) {
    try {
        await fileSystem.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function installBundle({
    sourcePath = source,
    destinationPath = destination,
    fileSystem = fs,
    uniqueSuffix = `${process.pid}-${randomUUID()}`,
} = {}) {
    const sourceStat = await fileSystem.stat(sourcePath);
    if (!sourceStat.isDirectory()) throw new Error('The built application bundle was not found.');

    const destinationDirectory = path.dirname(destinationPath);
    const destinationName = path.basename(destinationPath);
    const staging = path.join(destinationDirectory, `.${destinationName}.install-${uniqueSuffix}`);
    await fileSystem.mkdir(destinationDirectory, {recursive: true});

    let backup;
    try {
        // Copy beside the destination first. The working installation remains untouched
        // if disk, permission, or source errors interrupt this potentially long step.
        await fileSystem.cp(sourcePath, staging, {recursive: true, errorOnExist: true, force: false});

        if (await pathExists(destinationPath, fileSystem)) {
            backup = `${destinationPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            await fileSystem.rename(destinationPath, backup);
        }

        // Staging and destination share a directory, so this final replacement is atomic.
        await fileSystem.rename(staging, destinationPath);
    } catch (error) {
        await fileSystem.rm(staging, {recursive: true, force: true}).catch(() => {});
        if (backup && !(await pathExists(destinationPath, fileSystem))) {
            await fileSystem.rename(backup, destinationPath);
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
    install().catch(() => {
        console.error('Unable to install the application bundle.');
        process.exit(1);
    });
}

module.exports = {installBundle};