#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const resourceDir = path.join(rootDir, 'src-tauri', 'resources');
const includeDemoVideos = process.argv.includes('--include-demo-videos');

const copies = [
    ['public', 'public'],
];

if (includeDemoVideos) {
    copies.push(['test-data', 'test-data']);
}

function copyDirectory(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`Missing resource source: ${sourceDir}`);
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
}

for (const [source, target] of copies) {
    const sourceDir = path.join(rootDir, source);
    const targetDir = path.join(resourceDir, target);
    copyDirectory(sourceDir, targetDir);
    console.log(`Copied ${source} -> ${path.relative(rootDir, targetDir)}`);
}

if (!includeDemoVideos) {
    fs.rmSync(path.join(resourceDir, 'test-data'), { recursive: true, force: true });
}
