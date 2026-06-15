#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const lockPath = path.join(rootDir, 'package-lock.json');
const tauriDir = path.join(rootDir, 'src-tauri');

const forbiddenLicensePattern = /\b(proprietary|commercial|non[-\s]?free|not legally redistributable)\b/i;
const forbiddenPackagePattern = /(^|\/)node_modules\/(@ffmpeg-installer|@ffprobe-installer|ffmpeg-static|ffprobe-static|ffmpeg-ffprobe-static|ffmpeg-static-all-platforms)(\/|$)/;

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

function checkLicense(name, license) {
    if (!license) {
        return;
    }

    if (forbiddenLicensePattern.test(String(license))) {
        fail(`${name} has a non-open-source license expression: ${license}`);
    }
}

function checkNpmLicenses() {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = Object.entries(lock.packages || {});
    let checked = 0;

    for (const [packagePath, packageInfo] of packages) {
        if (!packagePath) {
            checkLicense('root package', packageInfo.license);
            continue;
        }

        if (forbiddenPackagePattern.test(packagePath)) {
            fail(`Non-redistributable binary package must not be in package-lock.json: ${packagePath}`);
        }

        checkLicense(packagePath, packageInfo.license);
        checked += 1;
    }

    console.log(`Checked ${checked} npm package license entries.`);
}

function checkCargoLicenses() {
    if (!fs.existsSync(path.join(tauriDir, 'Cargo.toml'))) {
        return;
    }

    const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked'], {
        cwd: tauriDir,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    });

    if (result.status !== 0) {
        fail(`cargo metadata failed:\n${result.stderr || result.stdout}`);
        return;
    }

    const metadata = JSON.parse(result.stdout);
    let checked = 0;
    for (const crate of metadata.packages || []) {
        checkLicense(`${crate.name}@${crate.version}`, crate.license || crate.license_file);
        checked += 1;
    }

    console.log(`Checked ${checked} Cargo package license entries.`);
}

checkNpmLicenses();
checkCargoLicenses();

if (process.exitCode) {
    process.exit(process.exitCode);
}

console.log('Open-source license check passed.');
