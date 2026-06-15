#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const binariesDir = path.join(rootDir, 'src-tauri', 'binaries');
const entry = path.join(rootDir, 'sidecar', 'server.js');

const targets = {
    darwin: {
        arm64: {
            pkg: 'node22-macos-arm64',
            triple: 'aarch64-apple-darwin',
        },
        x64: {
            pkg: 'node22-macos-x64',
            triple: 'x86_64-apple-darwin',
        },
    },
};

const platformTargets = targets[process.platform];
const target = platformTargets && platformTargets[process.arch];

if (!target) {
    console.error(`Unsupported sidecar build target: ${process.platform}/${process.arch}`);
    process.exit(1);
}

fs.mkdirSync(binariesDir, { recursive: true });

const outputPath = path.join(binariesDir, `miofive-server-${target.triple}`);
const result = spawnSync(
    path.join(rootDir, 'node_modules', '.bin', 'pkg'),
    [
        entry,
        '--target',
        target.pkg,
        '--output',
        outputPath,
        '--compress',
        'GZip',
    ],
    {
        cwd: rootDir,
        stdio: 'inherit',
    }
);

if (result.status !== 0) {
    process.exit(result.status || 1);
}

fs.chmodSync(outputPath, 0o755);
console.log(`Built Tauri sidecar: ${outputPath}`);
