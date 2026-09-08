#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repositoryRoot, 'src-tauri', 'Cargo.toml');
const binariesDirectory = path.join(repositoryRoot, 'src-tauri', 'binaries');
const resourcesDirectory = path.join(repositoryRoot, 'src-tauri', 'resources');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {stdio: 'inherit', ...options});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
    return result.status === 0;
}

const rustc = spawnSync('rustc', ['-vV'], {encoding: 'utf8'});
if (rustc.error || rustc.status !== 0) {
    console.error('A working Rust toolchain is required.');
    process.exit(1);
}

const targetTriple = /^host:\s+(.+)$/m.exec(rustc.stdout)?.[1];
if (!targetTriple) {
    console.error('Unable to determine the Rust host target.');
    process.exit(1);
}

const executableSuffix = targetTriple.includes('windows') ? '.exe' : '';
const sidecarPath = path.join(binariesDirectory, `miofive-server-${targetTriple}${executableSuffix}`);
const resourcePlaceholderPath = path.join(resourcesDirectory, 'check-placeholder');
let createdPlaceholder = false;
let createdResourcePlaceholder = false;

try {
    fs.mkdirSync(binariesDirectory, {recursive: true});
    try {
        const descriptor = fs.openSync(sidecarPath, 'wx', 0o700);
        fs.closeSync(descriptor);
        createdPlaceholder = true;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    fs.mkdirSync(resourcesDirectory, {recursive: true});
    try {
        const descriptor = fs.openSync(resourcePlaceholderPath, 'wx', 0o600);
        fs.closeSync(descriptor);
        createdResourcePlaceholder = true;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }

    const common = ['--manifest-path', manifestPath];
    let checksPassed = run('cargo', ['fmt', ...common, '--check']);
    if (checksPassed) {
        checksPassed = run('cargo', ['clippy', ...common, '--all-targets', '--all-features', '--', '-D', 'warnings']);
    }
    if (checksPassed) run('cargo', ['test', ...common, '--all-targets', '--all-features']);
} finally {
    if (createdPlaceholder) fs.rmSync(sidecarPath, {force: true});
    if (createdResourcePlaceholder) fs.rmSync(resourcePlaceholderPath, {force: true});
}