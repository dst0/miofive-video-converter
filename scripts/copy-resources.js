#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function copyDirectory(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`Missing resource source: ${sourceDir}`);
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function copyResources({rootDir = path.join(__dirname, '..'), includeDemoVideos = false} = {}) {
    const resourceDir = path.join(rootDir, 'src-tauri', 'resources');
    const copies = [
        ['public', 'public'],
        ['LICENSE', 'licenses/PROJECT-LICENSE.txt'],
        ['THIRD_PARTY_NOTICES.md', 'licenses/THIRD_PARTY_NOTICES.md'],
    ];
    if (includeDemoVideos) copies.push(['test-data', 'test-data']);
    for (const [source, target] of copies) {
        copyDirectory(path.join(rootDir, source), path.join(resourceDir, target));
        console.log(`Copied ${source} -> ${target}`);
    }
    if (!includeDemoVideos) {
        fs.rmSync(path.join(resourceDir, 'test-data'), { recursive: true, force: true });
    }
}

if (require.main === module) {
    copyResources({includeDemoVideos: process.argv.includes('--include-demo-videos')});
}

module.exports = {copyResources};
