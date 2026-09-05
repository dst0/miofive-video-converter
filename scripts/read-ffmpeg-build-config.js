#!/usr/bin/env node
'use strict';

const config = require('./ffmpeg-build-config');

const allowedValues = new Map([
    ['minimumMacosVersion', config.minimumMacosVersion],
    ['ffmpeg.version', config.ffmpeg.version],
    ['ffmpeg.archive', config.ffmpeg.archive],
    ['ffmpeg.url', config.ffmpeg.url],
    ['ffmpeg.sha256', config.ffmpeg.sha256],
    ['x264.commit', config.x264.commit],
    ['x264.archive', config.x264.archive],
    ['x264.url', config.x264.url],
    ['x264.sha256', config.x264.sha256],
]);

function resolveBuildJobs(envValue) {
    const rawValue = arguments.length > 0 ? envValue : process.env.MIOFIVE_FFMPEG_BUILD_JOBS;
    if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
        const str = String(rawValue).trim();
        if (!/^[1-9][0-9]*$/.test(str)) {
            throw new Error(`Invalid MIOFIVE_FFMPEG_BUILD_JOBS value: '${str}'. Must be a positive integer.`);
        }
        if (str.length > 2 || Number(str) > 16) {
            throw new Error(`Unreasonable MIOFIVE_FFMPEG_BUILD_JOBS value: ${str} (maximum 16).`);
        }
        return Number(str);
    }
    return 2;
}

function main() {
    const key = process.argv[2];

    if (key === 'buildJobs') {
        try {
            const jobs = resolveBuildJobs();
            process.stdout.write(String(jobs));
            process.exit(0);
        } catch (error) {
            console.error(error.message);
            process.exit(1);
        }
    }

    if (!allowedValues.has(key)) {
        console.error('Unknown FFmpeg build configuration key.');
        process.exit(1);
    }

    process.stdout.write(String(allowedValues.get(key)));
}

if (require.main === module) {
    main();
}

module.exports = {
    resolveBuildJobs,
};