#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {validateBundledBuild} = require('./copy-ffmpeg-binaries');
const {resolveExecutable} = require('../index');

const rootDir = path.resolve(__dirname, '..');
const defaultResourcesDir = path.join(rootDir, 'src-tauri', 'resources');

function resolveAndValidateBinaries(options = {}) {
    const env = options.env || process.env;
    const resourcesDir = options.resourcesDir || defaultResourcesDir;

    const customFfmpeg = env.MIOFIVE_FFMPEG_PATH;
    const customFfprobe = env.MIOFIVE_FFPROBE_PATH;

    if (Object.hasOwn(env, 'MIOFIVE_FFMPEG_PATH') || Object.hasOwn(env, 'MIOFIVE_FFPROBE_PATH')) {
        if (!customFfmpeg || !customFfprobe) {
            throw new Error('Both MIOFIVE_FFMPEG_PATH and MIOFIVE_FFPROBE_PATH must be set when overriding media tools.');
        }
        for (const [name, binPath] of [['FFmpeg', customFfmpeg], ['FFprobe', customFfprobe]]) {
            if (!fs.existsSync(binPath)) {
                throw new Error(`${name} binary path does not exist: ${binPath}`);
            }
            fs.accessSync(binPath, fs.constants.X_OK);
        }
        // Explicit operator trust boundary: development overrides are caller-supplied and not provenance-verified.
        return [customFfmpeg, customFfprobe];
    }

    // Check the artifacts runtime actually selects. The source-build cache is
    // validated by the build/copy gates, not by this availability check.
    const bundledBinDir = path.join(resourcesDir, 'bin');
    const hasBundledFiles = fs.existsSync(bundledBinDir) && fs.readdirSync(bundledBinDir).length > 0;
    if (hasBundledFiles || fs.existsSync(path.join(resourcesDir, 'BUILD-MANIFEST.txt'))) {
        validateBundledBuild(resourcesDir);
        const bundledFfmpeg = path.join(bundledBinDir, 'ffmpeg');
        const bundledFfprobe = path.join(bundledBinDir, 'ffprobe');
        return [bundledFfmpeg, bundledFfprobe];
    }

    // A system installation is an explicit documented development prerequisite,
    // not a provenance-verified release artifact. Never fall back past a damaged bundle.
    return ['ffmpeg', 'ffprobe'].map((name) => resolveExecutable(name, {
        env, bundled: false, platform: options.platform || process.platform,
    }));
}

function verifyExecution(binaries) {
    for (const [index, binary] of binaries.entries()) {
        const result = spawnSync(binary, ['-version'], {
            stdio: 'ignore',
            timeout: 15000,
            shell: false,
        });
        if (result.error || result.status !== 0) {
            throw new Error(`${index === 0 ? 'FFmpeg' : 'FFprobe'} is not available or failed execution.`);
        }
    }
}

function main() {
    try {
        const binaries = resolveAndValidateBinaries();
        verifyExecution(binaries);
        console.log('FFmpeg and FFprobe are available. Bundled artifacts, when selected, also passed manifest/digest validation; system tools are operator-managed.');
    } catch (error) {
        console.error(`Check failed: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    resolveAndValidateBinaries,
    verifyExecution,
};
