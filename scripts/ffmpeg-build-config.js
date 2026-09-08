'use strict';

const FFMPEG_VERSION = '9.0.1';
const X264_COMMIT = 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55';

module.exports = Object.freeze({
    target: 'macos-arm64',
    minimumMacosVersion: '11.0',
    ffmpeg: Object.freeze({
        version: FFMPEG_VERSION,
        archive: `ffmpeg-${FFMPEG_VERSION}.tar.xz`,
        url: `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`,
        sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
    }),
    x264: Object.freeze({
        commit: X264_COMMIT,
        archive: `x264-${X264_COMMIT}.tar.gz`,
        url: `https://code.videolan.org/videolan/x264/-/archive/${X264_COMMIT}/x264-${X264_COMMIT}.tar.gz`,
        sha256: 'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',
    }),
});