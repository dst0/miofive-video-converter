#!/usr/bin/env node

/**
 * Generate test videos with sequential numbers for testing the video player
 * 
 * This script creates minimal test videos that display large, clear numbers
 * to make it easy to visually verify that videos play in the correct sequence.
 * 
 * Each video:
 * - Displays a single large number (1, 2, 3, etc.)
 * - Is 2 seconds long
 * - Has minimal resolution (160x120) for small file size
 * - Follows Miofive S1 Ultra naming convention
 * - Has synchronized timestamps
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const VIDEO_COUNT = 10; // Generate 10 test videos
const VIDEO_DURATION = 2; // seconds
const VIDEO_WIDTH = 160;
const VIDEO_HEIGHT = 120;
const VIDEO_FPS = 15;
const OUTPUT_DIR = path.join(__dirname, 'test-data', 'Normal');

// Base timestamp for filenames (Jan 1, 2025, 10:00:00 UTC)
const BASE_UTC_TIME = new Date('2025-01-01T10:00:00Z');
const BASE_LOCAL_TIME = new Date('2025-01-01T05:00:00'); // UTC-5

/**
 * Format date for filename (MMDDYY_HHMMSS)
 */
function formatDateForFilename(date) {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const year = String(date.getUTCFullYear()).slice(-2);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${month}${day}${year}_${hours}${minutes}${seconds}`;
}

/**
 * Format date for local filename
 */
function formatLocalDateForFilename(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${month}${day}${year}_${hours}${minutes}${seconds}`;
}

/**
 * Generate a single test video with a number displayed
 */
function generateVideo(number) {
    return new Promise((resolve) => {
        // Calculate timestamp for this video (1 minute apart)
        const minutesOffset = (number - 1);
        const utcTime = new Date(BASE_UTC_TIME.getTime() + minutesOffset * 60 * 1000);
        const localTime = new Date(BASE_LOCAL_TIME.getTime() + minutesOffset * 60 * 1000);
        
        // Generate filename following Miofive convention
        const utcStr = formatDateForFilename(utcTime);
        const localStr = formatLocalDateForFilename(localTime);
        const sequence = String(number).padStart(6, '0');
        const filename = `${utcStr}_${localStr}_${sequence}A.MP4`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        
        console.log(`Generating video ${number}/${VIDEO_COUNT}: ${filename}`);
        
        // FFmpeg arguments to create video with number text
        // Using drawtext filter to display the number in large font
        const ffmpegArgs = [
            '-f', 'lavfi',
            '-i', `color=c=gray:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:d=${VIDEO_DURATION}`,
            '-f', 'lavfi',
            '-i', `anullsrc=channel_layout=mono:sample_rate=44100`,
            '-vf', `drawtext=fontsize=${VIDEO_HEIGHT * 0.7}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:text='${number}'`,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            '-r', String(VIDEO_FPS),
            '-c:a', 'aac',
            '-t', String(VIDEO_DURATION),
            '-y', // Overwrite output file
            outputPath
        ];
        
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log(`  ✓ Created ${filename}`);
                resolve({ number, filename, success: true });
            } else {
                console.error(`  ✗ Failed to create ${filename}`);
                if (stderr) {
                    console.error(`  Error: ${stderr.substring(stderr.length - 200)}`);
                }
                resolve({ number, filename, success: false, error: `FFmpeg exited with code ${code}` });
            }
        });
        
        ffmpeg.on('error', (error) => {
            console.error(`  ✗ Failed to create ${filename}: ${error.message}`);
            resolve({ number, filename, success: false, error: error.message });
        });
    });
}

/**
 * Main function to generate all test videos
 */
async function main() {
    console.log('='.repeat(60));
    console.log('Test Video Generator');
    console.log('='.repeat(60));
    console.log(`Generating ${VIDEO_COUNT} test videos with sequential numbers`);
    console.log(`Resolution: ${VIDEO_WIDTH}x${VIDEO_HEIGHT}`);
    console.log(`Duration: ${VIDEO_DURATION} seconds each`);
    console.log(`Frame rate: ${VIDEO_FPS} fps`);
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log('='.repeat(60));
    console.log();
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created output directory: ${OUTPUT_DIR}`);
        console.log();
    }
    
    // Generate videos sequentially
    const results = [];
    for (let i = 1; i <= VIDEO_COUNT; i++) {
        const result = await generateVideo(i);
        results.push(result);
    }
    
    // Summary
    console.log();
    console.log('='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✓ Successfully generated: ${successful}/${VIDEO_COUNT} videos`);
    if (failed > 0) {
        console.log(`✗ Failed: ${failed} videos`);
        results.filter(r => !r.success).forEach(r => {
            console.log(`  - ${r.filename}: ${r.error}`);
        });
    }
    console.log('='.repeat(60));
    
    if (failed > 0) {
        process.exit(1);
    }
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
