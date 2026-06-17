// server
const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const {exec, spawn} = require('child_process');
const {promisify} = require('util');

const execPromise = promisify(exec);
const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

const RESOURCE_DIR = process.env.MIOFIVE_RESOURCE_DIR || path.join(__dirname, 'src-tauri', 'resources');
const PUBLIC_DIR = fsSync.existsSync(path.join(RESOURCE_DIR, 'public'))
    ? path.join(RESOURCE_DIR, 'public')
    : path.join(__dirname, 'public');
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const TEST_DATA_DIR = path.join(__dirname, 'test-data');
const BUNDLED_BIN_DIR = path.join(RESOURCE_DIR, 'bin');

// MP4 duration extraction configuration
const MP4_HEADER_BUFFER_SIZE = 1024 * 1024; // 1MB should be enough for headers

// Removable devices cache
let removableDevices = [];
let removableDevicesChecked = false;

/**
 * Find USB flash drives, SD cards, and other removable devices on macOS
 * Uses diskutil list text output for reliable detection
 */
async function findRemovableDevices() {
    if (process.platform !== 'darwin') return [];
    
    try {
        const { stdout: listOutput } = await execPromise('diskutil list', { timeout: 10000 });
        const { stdout: volumesOutput } = await execPromise('ls /Volumes/', { timeout: 5000 });
        const volumes = volumesOutput.trim().split('\n').filter(Boolean);
        const listDevices = parseDiskutilList(listOutput, volumes);
        
        removableDevices = listDevices;
        removableDevicesChecked = true;
        return listDevices;
    } catch (err) {
        console.error('Failed to scan removable devices:', err.message);
        return [];
    }
}

/**
 * Parse diskutil list text output to find external/removable devices
 */
function parseDiskutilList(stdout, volumes) {
    const devices = [];
    const lines = stdout.split('\n');
    
    let currentDisk = null;
    
    for (const line of lines) {
        // Match disk header: /dev/disk4 (external, physical):
        const diskMatch = line.match(/\/dev\/(disk\d+)\s+\(([^)]+)\)/);
        if (diskMatch) {
            const diskNode = `/dev/${diskMatch[1]}`;
            const description = diskMatch[2];
            currentDisk = {
                diskNode,
                isExternal: description.includes('external'),
                partitions: [],
                sizeBytes: 0,
            };
            continue;
        }
        
        // Match GUID_partition_scheme line for size:
        //   0:      GUID_partition_scheme                        *123.9 GB   disk4
        if (currentDisk && line.includes('GUID_partition_scheme')) {
            const sizeMatch = line.match(/\*[\s]*(\d+\.?\d*)\s+(TB|GB|MB|KB)/);
            if (sizeMatch) {
                const value = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2];
                const multipliers = { KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
                currentDisk.sizeBytes = Math.round(value * (multipliers[unit] || 1));
            }
        }
        
        // Match partition lines - capture the identifier at end and everything before size as type+name
        //   2:       Microsoft Basic Data XBOX ONE X              123.7 GB   disk4s2
        const partMatch = line.match(/^\s+\d+:\s+(.+?)\s+(\d+\.?\d*)\s+(TB|GB|MB|KB)\s+(\S+)/);
        if (currentDisk && partMatch) {
            const typeAndName = partMatch[1].trim();
            const partitionNode = partMatch[4];
            
            // Extract just the name portion (last word or words after known type keywords)
            // Known type prefixes to strip:
            const typePrefixes = [
                'GUID_partition_scheme', 'Apple_APFS_ISC', 'Apple_APFS', 'APFS Volume',
                'APFS Snapshot', 'Apple_APFS_Recovery', 'APFS Container Scheme -',
                'Microsoft Basic Data', 'EFI', 'Linux Filesystem', 'Linux Swap',
                'FAT32 Partition', 'ExFAT Media', 'HFS+', 'Apple_HFS',
                'Apple_Boot', 'Apple_RAID', 'Apple_CORE',
            ];
            let name = typeAndName;
            for (const prefix of typePrefixes) {
                if (typeAndName.startsWith(prefix)) {
                    name = typeAndName.slice(prefix.length).trim();
                    break;
                }
            }
            
            currentDisk.partitions.push({ name, node: partitionNode });
        }
    }
    
    // Process external disks that have mounted partitions
    if (currentDisk && currentDisk.isExternal) {
        for (const part of currentDisk.partitions) {
            if (volumes.includes(part.name) && part.name !== '') {
                const mountPoint = path.join('/Volumes', part.name);
                devices.push({
                    deviceName: part.name,
                    mountPoint,
                    documentsVideoPath: path.join(mountPoint, 'Documents', 'Video'),
                    sizeBytes: currentDisk.sizeBytes,
                });
            }
        }
        // If no partition name matched /Volumes, try diskutil info fallback
        if (!devices.length) {
            const firstPart = currentDisk.partitions[0];
            if (firstPart) {
                const mountPoint = guessMountPoint(currentDisk.diskNode, currentDisk.partitions, volumes);
                if (mountPoint) {
                    devices.push({
                        deviceName: firstPart.name || currentDisk.diskNode,
                        mountPoint,
                        documentsVideoPath: path.join(mountPoint, 'Documents', 'Video'),
                        sizeBytes: currentDisk.sizeBytes,
                    });
                }
            }
        }
    }
    
    return devices;
}

/**
 * Guess mount point for a disk when partition name doesn't match /Volumes
 */
function guessMountPoint(diskNode, partitions, volumes) {
    // Check if any volume matches a substring of partition node
    for (const vol of volumes) {
        // Skip system volumes
        if (vol === 'Macintosh HD' || vol === 'Preboot' || vol === 'Recovery' || vol === 'Data' || vol === 'VM') continue;
    }
    return null;
}
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 100; // Max requests per window

function checkRateLimit(clientId) {
    const now = Date.now();
    const clientData = rateLimitMap.get(clientId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    
    if (now > clientData.resetTime) {
        clientData.count = 0;
        clientData.resetTime = now + RATE_LIMIT_WINDOW;
    }
    
    clientData.count++;
    rateLimitMap.set(clientId, clientData);
    
    return clientData.count <= MAX_REQUESTS;
}

function runStream(command, { cwd, env } = {}) {
    // Stream output live; support shell pipes/&& via shell:true
    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, stdio: 'inherit', cwd, env });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Command failed: ${command} (exit ${code})`))));
    });
}

function runProcess(command, args, { cwd, env, captureStderr = false } = {}) {
    return new Promise((resolve, reject) => {
        const stdio = captureStderr
            ? ['pipe', 'inherit', 'pipe']
            : 'inherit';
        const child = spawn(command, args, { stdio, cwd, env });
        let stderrOutput = '';
        if (captureStderr) {
            child.stderr.on('data', (data) => {
                stderrOutput += data.toString();
                process.stderr.write(data);
            });
        }
        child.on('error', reject);
        child.on('close', (code) => (
            code === 0 ? resolve({ stderr: stderrOutput }) : reject(new Error(`${command} failed with exit code ${code}${stderrOutput ? ': ' + stderrOutput.trim().slice(-200) : ''}`))
        ));
    });
}

function runCapture(command, args, { cwd, env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(stderr || `${command} failed with exit code ${code}`));
        });
    });
}

function executableName(name) {
    return process.platform === 'win32' ? `${name}.exe` : name;
}

function executableExists(filePath) {
    try {
        fsSync.accessSync(filePath, fsSync.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function resolveExecutable(name) {
    const envPath = process.env[`MIOFIVE_${name.toUpperCase()}_PATH`];
    const candidates = [
        envPath,
        path.join(BUNDLED_BIN_DIR, executableName(name)),
        process.platform === 'darwin' ? `/opt/homebrew/bin/${name}` : undefined,
        process.platform === 'darwin' ? `/usr/local/bin/${name}` : undefined,
        name,
    ].filter(Boolean);

    return candidates.find((candidate) => candidate === name || executableExists(candidate)) || name;
}

app.use(express.json());

// Serve static assets (index.html, etc.)
app.use(express.static(PUBLIC_DIR));

// Check if FFmpeg is available
async function checkFFmpeg() {
    try {
        const ffmpegPath = resolveExecutable('ffmpeg');
        const ffprobePath = resolveExecutable('ffprobe');
        await runCapture(ffmpegPath, ['-version']);
        await runCapture(ffprobePath, ['-version']);
        return {
            available: true,
            ffmpegPath,
            ffprobePath,
            bundled: ffmpegPath !== 'ffmpeg' && ffmpegPath.startsWith(BUNDLED_BIN_DIR),
        };
    } catch (err) {
        return {
            available: false,
            message: err.message,
        };
    }
}

// Get video duration by parsing MP4 file structure (pure JavaScript - very fast!)
// This reads the MP4 'mvhd' atom to extract duration without spawning external processes
function getVideoDurationFast(filePath) {
    return new Promise((resolve, reject) => {
        let fd;
        try {
            fd = fsSync.openSync(filePath, 'r');
            const buffer = Buffer.alloc(MP4_HEADER_BUFFER_SIZE);
            
            fsSync.readSync(fd, buffer, 0, buffer.length, 0);
            fsSync.closeSync(fd);
            
            // Find 'moov' atom (movie metadata container)
            let pos = 0;
            let moovStart = -1;
            
            while (pos < buffer.length - 8) {
                const atomSize = buffer.readUInt32BE(pos);
                const atomType = buffer.toString('ascii', pos + 4, pos + 8);
                
                if (atomType === 'moov') {
                    moovStart = pos;
                    break;
                }
                
                // Bounds check: ensure atom doesn't extend beyond remaining buffer
                if (atomSize === 0 || atomSize > (buffer.length - pos)) break;
                pos += atomSize;
            }
            
            if (moovStart === -1) {
                return resolve(null);
            }
            
            // Find 'mvhd' atom (movie header) inside 'moov'
            pos = moovStart + 8;
            const moovEnd = moovStart + buffer.readUInt32BE(moovStart);
            
            while (pos < moovEnd && pos < buffer.length - 8) {
                const atomSize = buffer.readUInt32BE(pos);
                const atomType = buffer.toString('ascii', pos + 4, pos + 8);
                
                if (atomType === 'mvhd') {
                    // Found mvhd atom - extract duration
                    const version = buffer.readUInt8(pos + 8);
                    let timescale, duration;
                    
                    if (version === 0) {
                        // Version 0: 32-bit values
                        timescale = buffer.readUInt32BE(pos + 20);
                        duration = buffer.readUInt32BE(pos + 24);
                    } else {
                        // Version 1: 64-bit values
                        timescale = buffer.readUInt32BE(pos + 28);
                        // Duration is 64-bit - read as BigInt for full precision
                        const durationBig = buffer.readBigUInt64BE(pos + 32);
                        // Convert to number (safe for typical dashcam videos < 584 years at 1000 Hz)
                        duration = Number(durationBig);
                    }
                    
                    return resolve(duration / timescale);
                }
                
                // Bounds check: ensure atom doesn't extend beyond remaining buffer
                if (atomSize === 0 || atomSize > (buffer.length - pos)) break;
                pos += atomSize;
            }
            
            resolve(null);
        } catch (err) {
            if (fd !== undefined) {
                try { fsSync.closeSync(fd); } catch {}
            }
            reject(err);
        }
    });
}

// Get durations for multiple files (pure JS - extremely fast, ~0.1ms per file)
async function getVideoDurationsBatch(filePaths) {
    return Promise.all(filePaths.map(filePath => getVideoDurationFast(filePath)));
}

// Parse filename to extract UTC and local timestamps
function parseFilename(filename) {
    // Pattern: {MMDDYY}_{HHMMSS}_{MMDDYY}_{HHMMSS}_{dddddd(A|B)}.MP4
    const pattern = /(\d{6})_(\d{6})_(\d{6})_(\d{6})_(\d{6}[AB])\.MP4$/i;
    const match = filename.match(pattern);
    if (!match) return null;

    const [, utcDate, utcTime, localDate, localTime, sequence] = match;

    // UTC datetime
    const utcMonth = utcDate.substring(0, 2);
    const utcDay = utcDate.substring(2, 4);
    const utcYear = '20' + utcDate.substring(4, 6);
    const utcHour = utcTime.substring(0, 2);
    const utcMin = utcTime.substring(2, 4);
    const utcSec = utcTime.substring(4, 6);
    const utcTimestamp = new Date(`${utcYear}-${utcMonth}-${utcDay}T${utcHour}:${utcMin}:${utcSec}Z`);

    // Local datetime
    const localYear = '20' + localDate.substring(0, 2);
    const localMonth = localDate.substring(2, 4);
    const localDay = localDate.substring(4, 6);
    const localHour = localTime.substring(0, 2);
    const localMin = localTime.substring(2, 4);
    const localSec = localTime.substring(4, 6);
    let localDateTimeString = `${localYear}-${localMonth}-${localDay}T${localHour}:${localMin}:${localSec}`;
    const localTimestamp = new Date(localDateTimeString);

    return {
        utcTimestamp,
        localTimestamp,
        sequence,
        isValid: !isNaN(utcTimestamp.getTime()) && !isNaN(localTimestamp.getTime())
    };
}

// Extract file type from path (Normal, Emr, Park, or Other)
function getFileType(filePath) {
    const pathUpper = filePath.toUpperCase();
    if (pathUpper.includes('/EMR') || pathUpper.includes('\\EMR')) {
        return 'Emr';
    } else if (pathUpper.includes('/NORMAL') || pathUpper.includes('\\NORMAL')) {
        return 'Normal';
    } else if (pathUpper.includes('/PARK') || pathUpper.includes('\\PARK')) {
        return 'Park';
    }
    return 'Other';
}

// Recursively scan directory
async function scanDirectory(dirPath, startTime, endTime) {
    const results = [];
    try {
        const entries = await fs.readdir(dirPath, {withFileTypes: true});
        for (const entry of entries) {
            // Skip hidden files/directories (starting with .)
            if (entry.name.startsWith('.')) {
                continue;
            }
            
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const subResults = await scanDirectory(fullPath, startTime, endTime);
                results.push(...subResults);
            } else if (entry.isFile()) {
                const upperName = entry.name.toUpperCase();
                if (upperName.endsWith('A.MP4') || upperName.endsWith('B.MP4')) {
                    const parsed = parseFilename(entry.name);
                    if (parsed && parsed.isValid) {
                        const timestamp = parsed.utcTimestamp.getTime();
                        if (startTime && timestamp < startTime) continue;
                        if (endTime && timestamp > endTime) continue;
                        results.push({
                            path: fullPath,
                            filename: entry.name,
                            utcTime: parsed.utcTimestamp.toISOString(),
                            localTime: parsed.localTimestamp.toISOString(),
                            timestamp,
                            fileType: getFileType(fullPath)
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Error scanning ${dirPath}:`, err.message);
    }
    return results.sort((a, b) => a.timestamp - b.timestamp);
}

const EXPORT_QUALITY_PROFILES = {
    max: { crf: '16', preset: 'slow', audioBitrate: '192k' },
    high: { crf: '20', preset: 'medium', audioBitrate: '160k' },
    standard: { crf: '23', preset: 'medium', audioBitrate: '128k' },
    compact: { crf: '28', preset: 'fast', audioBitrate: '96k' },
};

function isPathInside(parentPath, childPath) {
    const relativePath = path.relative(parentPath, childPath);
    return relativePath === '' || (
        relativePath &&
        !relativePath.startsWith('..') &&
        !path.isAbsolute(relativePath)
    );
}

function parseTimestamp(timestamp) {
    if (typeof timestamp === 'number') return timestamp;
    if (!timestamp || timestamp === '') return 0;
    // Handle MM:SS.mmm format
    const match = timestamp.match(/^(\d{2}):(\d{2}\.\d{1,3})$/);
    if (match) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        return minutes * 60 + seconds;
    }
    // Fall back to plain number
    return Number(timestamp);
}

function toFiniteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new Error(`${label} must be a valid number`);
    }
    return number;
}

function formatFilterNumber(value) {
    return Number(value)
        .toFixed(6)
        .replace(/0+$/, '')
        .replace(/\.$/, '');
}

function roundSecondsToMilliseconds(value) {
    return Math.round(Number(value) * 1000) / 1000;
}

function buildAtempoFilter(speed) {
    const filters = [];
    let remaining = speed;

    while (remaining < 0.5) {
        filters.push('atempo=0.5');
        remaining /= 0.5;
    }

    while (remaining > 2) {
        filters.push('atempo=2');
        remaining /= 2;
    }

    filters.push(`atempo=${formatFilterNumber(remaining)}`);
    return filters.join(',');
}

async function getVideoDuration(filePath) {
    try {
        const fastDuration = await getVideoDurationFast(filePath);
        if (Number.isFinite(fastDuration) && fastDuration > 0) {
            return fastDuration;
        }
    } catch {
        // Fall through to ffprobe for files whose MP4 metadata is not in the header.
    }

    const { stdout } = await runCapture(resolveExecutable('ffprobe'), [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=nokey=1:noprint_wrappers=1',
        filePath,
    ]);
    const probedDuration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(probedDuration) || probedDuration <= 0) {
        throw new Error(`Unable to read duration for ${path.basename(filePath)}`);
    }
    return probedDuration;
}

async function hasAudioStream(filePath) {
    try {
        const { stdout } = await runCapture(resolveExecutable('ffprobe'), [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=index',
            '-of', 'csv=p=0',
            filePath,
        ]);
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

async function validateInputFiles(files) {
    const normalizedTestData = path.resolve(TEST_DATA_DIR);
    const normalizedFiles = [];

    for (const file of files) {
        if (typeof file !== 'string' || !file.trim()) {
            throw new Error('Invalid input file path');
        }

        const normalizedPath = path.resolve(file);
        if (!normalizedPath.toUpperCase().endsWith('.MP4')) {
            throw new Error('Only MP4 files are allowed');
        }

        if (DEMO_MODE && !isPathInside(normalizedTestData, normalizedPath)) {
            throw new Error('Access denied in demo mode. Only test-data videos are accessible.');
        }

        await fs.access(normalizedPath);
        const stat = await fs.stat(normalizedPath);
        if (!stat.isFile()) {
            throw new Error(`Path is not a file: ${normalizedPath}`);
        }

        normalizedFiles.push(normalizedPath);
    }

    return normalizedFiles;
}

async function getAvailableOutputPath(outputPath) {
    const normalizedOutputPath = path.resolve(outputPath);
    const parsedPath = path.parse(normalizedOutputPath);

    if (!parsedPath.dir) {
        throw new Error('Output folder is required');
    }

    await fs.access(parsedPath.dir);
    const outputDirStat = await fs.stat(parsedPath.dir);
    if (!outputDirStat.isDirectory()) {
        throw new Error('Output folder is not a directory');
    }

    let finalOutputPath = normalizedOutputPath;
    let counter = 1;
    const MAX_COUNTER = 9999;

    while (counter <= MAX_COUNTER) {
        try {
            await fs.access(finalOutputPath);
            finalOutputPath = path.join(parsedPath.dir, `${parsedPath.name}_${counter}${parsedPath.ext}`);
            counter++;
        } catch {
            return finalOutputPath;
        }
    }

    throw new Error('Too many files with the same name. Please choose a different filename.');
}

async function buildExportSegments(files, rangeStart, rangeEnd) {
    const durations = await Promise.all(files.map((filePath) => getVideoDuration(filePath)));
    const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
    const startSeconds = roundSecondsToMilliseconds(Math.max(0, rangeStart ?? 0));
    const endSeconds = roundSecondsToMilliseconds(Math.min(rangeEnd ?? totalDuration, totalDuration));

    if (startSeconds >= endSeconds) {
        throw new Error('Export end time must be after start time');
    }

    const segments = [];
    let globalOffset = 0;

    files.forEach((file, index) => {
        const duration = durations[index];
        const fileStart = globalOffset;
        const fileEnd = globalOffset + duration;
        const overlapStart = Math.max(startSeconds, fileStart);
        const overlapEnd = Math.min(endSeconds, fileEnd);

        const segmentDuration = roundSecondsToMilliseconds(overlapEnd - overlapStart);

        if (segmentDuration > 0) {
            segments.push({
                file,
                start: roundSecondsToMilliseconds(overlapStart - fileStart),
                duration: segmentDuration,
            });
        }

        globalOffset = fileEnd;
    });

    if (segments.length === 0) {
        throw new Error('Selected range does not include any video frames');
    }

    return { segments, totalDuration, startSeconds, endSeconds };
}

function normalizeExportOptions({ rangeStart, rangeEnd, speed, quality }) {
    const normalizedSpeed = speed === undefined ? 1 : toFiniteNumber(speed, 'Export speed');
    if (normalizedSpeed < 0.1 || normalizedSpeed > 50) {
        throw new Error('Export speed must be between 0.1x and 50x');
    }

    const normalizedStart = rangeStart === undefined || rangeStart === null || rangeStart === ''
        ? 0
        : roundSecondsToMilliseconds(Number(rangeStart));
    const normalizedEnd = rangeEnd === undefined || rangeEnd === null || rangeEnd === ''
        ? undefined
        : roundSecondsToMilliseconds(Number(rangeEnd));

    if (normalizedStart < 0) {
        throw new Error('Export start time cannot be negative');
    }
    if (normalizedEnd !== undefined && normalizedEnd <= normalizedStart) {
        throw new Error('Export end time must be after start time');
    }

    const normalizedQuality = EXPORT_QUALITY_PROFILES[quality] ? quality : 'max';

    return {
        rangeStart: normalizedStart,
        rangeEnd: normalizedEnd,
        speed: normalizedSpeed,
        quality: normalizedQuality,
        profile: EXPORT_QUALITY_PROFILES[normalizedQuality],
    };
}

function isClientInputError(error) {
    const message = error?.message || '';
    return [
        'Invalid input',
        'Only MP4',
        'Access denied',
        'Path is not a file',
        'Output folder',
        'Too many files',
        'Export ',
        'Selected range',
        'Unable to read duration',
    ].some((pattern) => message.includes(pattern));
}

async function exportVideoRange({ files, finalOutputPath, rangeStart, rangeEnd, speed, quality }) {
    const options = normalizeExportOptions({ rangeStart, rangeEnd, speed, quality });
    const { segments, totalDuration, startSeconds, endSeconds } = await buildExportSegments(
        files,
        options.rangeStart,
        options.rangeEnd
    );

    const audioFlags = await Promise.all(segments.map((segment) => hasAudioStream(segment.file)));
    const includeAudio = audioFlags.some(Boolean);
    const args = ['-hide_banner', '-loglevel', 'info', '-stats', '-y'];
    let nextInputIndex = 0;

    segments.forEach((segment, index) => {
        segment.inputIndex = nextInputIndex;
        segment.hasAudio = audioFlags[index];
        args.push('-i', segment.file);
        nextInputIndex++;

        if (includeAudio && !segment.hasAudio) {
            segment.silentInputIndex = nextInputIndex;
            args.push(
                '-f', 'lavfi',
                '-t', formatFilterNumber(segment.duration),
                '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'
            );
            nextInputIndex++;
        }
    });

    const filterParts = [];
    const atempoFilter = buildAtempoFilter(options.speed);
    const speedExpr = formatFilterNumber(options.speed);

    segments.forEach((segment, index) => {
        const startExpr = formatFilterNumber(segment.start);
        const durationExpr = formatFilterNumber(segment.duration);

        filterParts.push(
            `[${segment.inputIndex}:v:0]trim=start=${startExpr}:duration=${durationExpr},` +
            `setpts=(PTS-STARTPTS)/${speedExpr}[v${index}]`
        );

        if (includeAudio) {
            const audioSource = segment.hasAudio
                ? `[${segment.inputIndex}:a:0]atrim=start=${startExpr}:duration=${durationExpr}`
                : `[${segment.silentInputIndex}:a:0]atrim=duration=${durationExpr}`;
            filterParts.push(`${audioSource},asetpts=PTS-STARTPTS,${atempoFilter}[a${index}]`);
        }
    });

    if (segments.length > 1) {
        if (includeAudio) {
            const concatInputs = segments.map((_, index) => `[v${index}][a${index}]`).join('');
            filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`);
        } else {
            const concatInputs = segments.map((_, index) => `[v${index}]`).join('');
            filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=0[outv]`);
        }
    }

    args.push('-filter_complex', filterParts.join(';'));

    if (segments.length > 1) {
        args.push('-map', '[outv]');
        if (includeAudio) {
            args.push('-map', '[outa]');
        }
    } else {
        args.push('-map', '[v0]');
        if (includeAudio) {
            args.push('-map', '[a0]');
        }
    }

    args.push(
        '-c:v', 'libx264',
        '-preset', options.profile.preset,
        '-crf', options.profile.crf,
        '-pix_fmt', 'yuv420p'
    );

    if (includeAudio) {
        args.push('-c:a', 'aac', '-b:a', options.profile.audioBitrate);
    }

    args.push('-movflags', '+faststart', finalOutputPath);

    console.log(
        `Exporting ${formatFilterNumber(endSeconds - startSeconds)}s range ` +
        `at ${formatFilterNumber(options.speed)}x using ${options.quality} quality...`
    );
    await runProcess(resolveExecutable('ffmpeg'), args, { captureStderr: true });

    return {
        rangeStart: startSeconds,
        rangeEnd: endSeconds,
        selectedDuration: endSeconds - startSeconds,
        outputDuration: (endSeconds - startSeconds) / options.speed,
        speed: options.speed,
        quality: options.quality,
        sourceDuration: totalDuration,
    };
}

// Root: serve the HTML file explicitly (nice fallback)
app.get('/api/removable-devices', async (req, res) => {
    // Detect removable devices on startup
    if (!removableDevicesChecked) {
        await findRemovableDevices();
    }
    res.json(removableDevices);
});

app.post('/api/validate-path', async (req, res) => {
    const { path: targetPath, type } = req.body; // type: 'scan' | 'export'
    if (!targetPath) return res.status(400).json({ valid: false, error: 'Path required' });
    
    try {
        const stats = await fs.stat(targetPath);
        if (type === 'scan') {
            return res.json({ valid: stats.isDirectory(), path: targetPath });
        } else {
            return res.json({ valid: stats.isDirectory(), path: targetPath });
        }
    } catch {
        return res.json({ valid: false, path: targetPath });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Check FFmpeg availability
app.get('/check-ffmpeg', async (req, res) => {
    res.json(await checkFFmpeg());
});

// Check if demo mode is enabled
app.get('/demo-mode', async (req, res) => {
    // Detect removable devices on startup
    if (!removableDevicesChecked) {
        await findRemovableDevices();
    }
    
    res.json({
        enabled: DEMO_MODE,
        demoPath: DEMO_MODE ? TEST_DATA_DIR : null,
        removableDevices,
    });
});

// List directories endpoint
app.post('/list-directories', async (req, res) => {
    // Rate limiting check
    const clientId = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientId)) {
        return res.status(429).json({error: 'Too many requests. Please try again later.'});
    }
    
    // In demo mode, only allow access to test-data directory
    if (DEMO_MODE) {
        const {path: dirPath} = req.body;
        
        // If no path, return test-data as root
        if (!dirPath) {
            return res.json({
                directories: [{
                    name: 'test-data (Demo)',
                    path: TEST_DATA_DIR,
                    type: 'demo'
                }]
            });
        }
        
        // Normalize path and ensure it's within test-data
        const normalizedPath = path.resolve(dirPath);
        const normalizedTestData = path.resolve(TEST_DATA_DIR);
        
        if (!normalizedPath.startsWith(normalizedTestData)) {
            return res.status(403).json({error: 'Access denied in demo mode. Only test-data directory is accessible.'});
        }
        
        try {
            await fs.access(normalizedPath);
            const stat = await fs.stat(normalizedPath);
            
            if (!stat.isDirectory()) {
                return res.status(400).json({error: 'Path is not a directory'});
            }
            
            const entries = await fs.readdir(normalizedPath, {withFileTypes: true});
            
            const directories = entries
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
                .map(entry => ({
                    name: entry.name,
                    path: path.join(normalizedPath, entry.name),
                    type: 'folder'
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            
            return res.json({directories});
        } catch (err) {
            return res.status(400).json({error: 'Unable to access directory', message: err.message});
        }
    }
    
    const {path: dirPath} = req.body;
    
    try {
        // If no path provided, list root/common directories based on platform
        if (!dirPath) {
            const os = require('os');
            const platform = os.platform();
            let locations = [];
            
            if (platform === 'win32') {
                // Windows: List available drives
                try {
                    const {stdout} = await execPromise('wmic logicaldisk get name');
                    const drives = stdout.split('\n')
                        .map(line => line.trim())
                        .filter(line => line && line !== 'Name' && line.match(/^[A-Z]:/))
                        .map(drive => ({name: drive + '\\', path: drive + '\\', type: 'drive'}));
                    
                    if (drives.length > 0) {
                        locations.push(...drives);
                    } else {
                        locations.push({name: 'C:\\', path: 'C:\\', type: 'drive'});
                    }
                } catch (error) {
                    locations.push({name: 'C:\\', path: 'C:\\', type: 'drive'});
                }
                
                // Add common Windows folders
                const homeDir = os.homedir();
                const commonFolders = [
                    {name: 'Desktop', path: path.join(homeDir, 'Desktop'), type: 'common'},
                    {name: 'Documents', path: path.join(homeDir, 'Documents'), type: 'common'},
                    {name: 'Downloads', path: path.join(homeDir, 'Downloads'), type: 'common'},
                    {name: 'Pictures', path: path.join(homeDir, 'Pictures'), type: 'common'},
                    {name: 'Videos', path: path.join(homeDir, 'Videos'), type: 'common'},
                ];
                
                // Only add folders that exist
                for (const folder of commonFolders) {
                    try {
                        await fs.access(folder.path);
                        locations.push(folder);
                    } catch (err) {
                        // Folder doesn't exist, skip it
                    }
                }
                
                res.json({directories: locations});
                return;
            } else {
                // Unix-like: Start from home directory and common places
                const homeDir = os.homedir();
                locations.push({name: '~ (Home)', path: homeDir, type: 'common'});
                
                // Add common Unix folders
                const commonFolders = [
                    {name: 'Desktop', path: path.join(homeDir, 'Desktop'), type: 'common'},
                    {name: 'Documents', path: path.join(homeDir, 'Documents'), type: 'common'},
                    {name: 'Downloads', path: path.join(homeDir, 'Downloads'), type: 'common'},
                    {name: 'Pictures', path: path.join(homeDir, 'Pictures'), type: 'common'},
                    {name: 'Videos', path: path.join(homeDir, 'Videos'), type: 'common'},
                ];
                
                // Only add folders that exist
                for (const folder of commonFolders) {
                    try {
                        await fs.access(folder.path);
                        locations.push(folder);
                    } catch (err) {
                        // Folder doesn't exist, skip it
                    }
                }
                
                // Add system locations for Unix/macOS
                if (platform === 'darwin') {
                    // macOS: Add /Volumes for external drives
                    try {
                        await fs.access('/Volumes');
                        locations.push({name: '/Volumes (External Drives)', path: '/Volumes', type: 'system'});
                    } catch (err) {
                        // /Volumes doesn't exist or not accessible
                    }
                } else {
                    // Linux: Add /media for external drives
                    try {
                        await fs.access('/media');
                        locations.push({name: '/media (External Drives)', path: '/media', type: 'system'});
                    } catch (err) {
                        // /media doesn't exist or not accessible
                    }
                    
                    // Linux: Add /mnt for mounted drives
                    try {
                        await fs.access('/mnt');
                        locations.push({name: '/mnt (Mounted Drives)', path: '/mnt', type: 'system'});
                    } catch (err) {
                        // /mnt doesn't exist or not accessible
                    }
                }
                
                // Add root directory
                locations.push({name: '/ (Root)', path: '/', type: 'system'});
                
                res.json({directories: locations});
                return;
            }
        }
        
        // Normalize and resolve the path to prevent directory traversal attacks
        const normalizedPath = path.resolve(dirPath);
        
        // Verify the path exists and is accessible
        await fs.access(normalizedPath);
        const stat = await fs.stat(normalizedPath);
        
        if (!stat.isDirectory()) {
            return res.status(400).json({error: 'Path is not a directory'});
        }
        
        // Read directory contents
        const entries = await fs.readdir(normalizedPath, {withFileTypes: true});
        
        // Filter for directories only, exclude hidden directories
        const directories = entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => ({
                name: entry.name,
                path: path.join(normalizedPath, entry.name),
                type: 'folder'
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({directories});
    } catch (err) {
        res.status(400).json({error: 'Unable to access directory', message: err.message});
    }
});

// Scan endpoint
app.post('/scan', async (req, res) => {
    const {folderPath, startTime, endTime, channels, includeDurations = true} = req.body;
    if (!folderPath) return res.status(400).json({error: 'Folder path is required'});
    
    // In demo mode, only allow scanning test-data directory
    if (DEMO_MODE) {
        const normalizedPath = path.resolve(folderPath);
        const normalizedTestData = path.resolve(TEST_DATA_DIR);
        
        if (!normalizedPath.startsWith(normalizedTestData)) {
            return res.status(403).json({error: 'Access denied in demo mode. Only test-data directory is accessible.'});
        }
    }
    
    const includeA = channels?.includes('A');
    const includeB = channels?.includes('B');

    try {
        await fs.access(folderPath);
        const startTs = startTime ? new Date(startTime).getTime() : null;
        const endTs = endTime ? new Date(endTime).getTime() : null;
        let files = await scanDirectory(folderPath, startTs, endTs);
        files = files.filter(f => {
            const name = f.filename.toUpperCase();
            return (includeA && name.endsWith('A.MP4')) || (includeB && name.endsWith('B.MP4'));
        });
        
        // Probe video durations if requested
        if (includeDurations && files.length > 0) {
            console.log(`Probing durations for ${files.length} video files...`);
            const startTime = Date.now();
            const filePaths = files.map(f => f.path);
            const durations = await getVideoDurationsBatch(filePaths);
            
            // Add durations to file objects
            files = files.map((file, index) => ({
                ...file,
                duration: durations[index]
            }));
            
            const totalDuration = durations.reduce((sum, d) => sum + (d || 0), 0);
            const elapsed = Date.now() - startTime;
            console.log(`Duration probing complete in ${elapsed}ms. Total duration: ${totalDuration.toFixed(2)}s`);
        }
        
        res.json({files, count: files.length});
    } catch (err) {
        res.status(400).json({error: 'Invalid folder path or access denied', message: err.message});
    }
});


async function handleExportRequest(req, res) {
    const {files, outputPath, rangeStart, rangeEnd, speed, quality} = req.body;
    if (!files || files.length === 0) {
        return res.status(400).json({error: 'No files to export'});
    }
    if (!outputPath) {
        return res.status(400).json({error: 'Output path is required'});
    }

    const ffmpegStatus = await checkFFmpeg();
    if (!ffmpegStatus.available) {
        return res.status(400).json({error: 'FFmpeg is not available in the app bundle or system PATH'});
    }

    try {
        const normalizedFiles = await validateInputFiles(files);
        const finalOutputPath = await getAvailableOutputPath(outputPath);
        const details = await exportVideoRange({
            files: normalizedFiles,
            finalOutputPath,
            rangeStart,
            rangeEnd,
            speed,
            quality,
        });

        console.log('Videos exported successfully to:', finalOutputPath);
        res.json({
            success: true,
            message: 'Video exported successfully',
            output: finalOutputPath,
            details,
        });
    } catch (err) {
        console.error('Failed to export videos:', err.message, err.stack);
        res.status(isClientInputError(err) ? 400 : 500).json({error: `Failed to export videos: ${err.message}`});
    }
}

app.post('/export', handleExportRequest);

// Serve video files with range support for streaming
app.get('/video', async (req, res) => {
    // Rate limiting check
    const clientId = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientId)) {
        return res.status(429).json({error: 'Too many requests. Please try again later.'});
    }
    
    const videoPath = req.query.path;
    
    if (!videoPath) {
        return res.status(400).json({error: 'Video path is required'});
    }
    
    // In demo mode, only allow access to test-data videos
    if (DEMO_MODE) {
        const normalizedPath = path.resolve(videoPath);
        const normalizedTestData = path.resolve(TEST_DATA_DIR);
        
        if (!normalizedPath.startsWith(normalizedTestData)) {
            return res.status(403).json({error: 'Access denied in demo mode. Only test-data videos are accessible.'});
        }
    }
    
    try {
        // Normalize and resolve the path to prevent directory traversal attacks
        const normalizedPath = path.resolve(videoPath);
        
        // Security Note: This endpoint serves video files from paths provided by the user.
        // The application is designed to work with dashcam videos that can be located
        // anywhere on the filesystem (external drives, network shares, etc.).
        // Security is enforced through:
        // 1. File type validation (MP4 only)
        // 2. Rate limiting (to prevent DoS)
        // 3. File existence and accessibility checks
        // Users should be aware they're granting access to files they explicitly select.
        
        // Additional validation: check if the file ends with .MP4 or .mp4
        if (!normalizedPath.toUpperCase().endsWith('.MP4')) {
            return res.status(400).json({error: 'Only MP4 files are allowed'});
        }
        
        // Verify the file exists and is accessible
        await fs.access(normalizedPath);
        const stat = await fs.stat(normalizedPath);
        
        if (!stat.isFile()) {
            return res.status(400).json({error: 'Path is not a file'});
        }
        
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            // Parse range header
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            
            // Read the file stream
            const fileStream = fsSync.createReadStream(normalizedPath, {start, end});
            
            // Set headers for partial content
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
            });
            
            fileStream.pipe(res);
        } else {
            // No range header, send the entire file
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
            });
            
            const fileStream = fsSync.createReadStream(normalizedPath);
            fileStream.pipe(res);
        }
    } catch (err) {
        res.status(400).json({error: 'Unable to access video file', message: err.message});
    }
});

// Start server
async function startServer({ port = DEFAULT_PORT, host, silent = false } = {}) {
    const hasFFmpeg = await checkFFmpeg();
    const listenArgs = host ? [port, host] : [port];

    return new Promise((resolve, reject) => {
        const server = app.listen(...listenArgs, () => {
            const address = server.address();
            const resolvedPort = typeof address === 'object' && address ? address.port : port;
            const resolvedHost = host || 'localhost';

            if (!silent) {
                console.log(`\n✅ Server running at http://${resolvedHost}:${resolvedPort}\n`);
                if (DEMO_MODE) {
                    console.log('🎭 Demo Mode is ENABLED');
                    console.log(`   Only test-data directory is accessible: ${TEST_DATA_DIR}\n`);
                }
                if (hasFFmpeg.available) {
                    console.log(`✅ FFmpeg is ready: ${hasFFmpeg.ffmpegPath}`);
                } else {
                    console.log('⚠️  FFmpeg is NOT available');
                    console.log('   Video export will not work');
                    if (hasFFmpeg.message) {
                        console.log(`   ${hasFFmpeg.message}`);
                    }
                }
                console.log('\nPress Ctrl+C to stop the server\n');
            }

            resolve({ server, port: resolvedPort, host: resolvedHost, hasFFmpeg });
        });

        server.on('error', reject);
    });
}

if (require.main === module) {
    startServer().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    app,
    startServer,
    checkFFmpeg,
};
