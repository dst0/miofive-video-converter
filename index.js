// server
const express = require('express');
const helmet = require('helmet');
const {rateLimit} = require('express-rate-limit');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {pipeline} = require('stream/promises');
const {prepareExportOutput, publishExportOutput, cleanupExportOutput} = require('./export-output');

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_ERROR_TAIL_BYTES = 16 * 1024;
const MAX_MP4_ATOMS = 4096;
const MAX_SANE_VIDEO_DURATION = 86400 * 30; // 30 days maximum duration for dashcam media
const activeLongRunningChildren = new Set();
let activeHttpServer = null;
let shutdownHandlersInstalled = false;
let shutdownRequested = false;
const shutdownController = new AbortController();

function operationSignal(signal) {
    return signal ? AbortSignal.any([signal, shutdownController.signal]) : shutdownController.signal;
}

function requestLifetime(res) {
    const controller = new AbortController();
    const disconnect = () => {
        if (!res.writableEnded) controller.abort(new Error('Client disconnected'));
    };
    res.on('close', disconnect);
    if (res.destroyed || res.closed || res.socket?.destroyed) disconnect();
    return {
        signal: operationSignal(controller.signal),
        dispose: () => res.removeListener('close', disconnect),
    };
}

const RESOURCE_DIR = process.env.MIOFIVE_RESOURCE_DIR || path.join(__dirname, 'src-tauri', 'resources');
function resolveResourceDirectory(name) {
    const sourceDir = path.join(__dirname, name);
    if (fsSync.existsSync(sourceDir)) {
        return sourceDir;
    }

    return path.join(RESOURCE_DIR, name);
}

// Web assets are served from source in local dev and from copied resources in Tauri.
const PUBLIC_DIR = resolveResourceDirectory('public');
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const TEST_DATA_DIR = resolveResourceDirectory('test-data');
const BUNDLED_BIN_DIR = path.join(RESOURCE_DIR, 'bin');
const PRIVATE_ENDPOINTS = new Set([
    '/api/removable-devices',
    '/api/validate-path',
    '/check-ffmpeg',
    '/demo-mode',
    '/export',
    '/list-directories',
    '/scan',
    '/video',
]);

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
        const [{stdout: listOutput}, volumeEntries] = await Promise.all([
            runCapture('/usr/sbin/diskutil', ['list'], {timeout: 10000}),
            fs.readdir('/Volumes', {withFileTypes: true}),
        ]);
        const volumes = volumeEntries
            .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
            .map((entry) => entry.name);
        const listDevices = parseDiskutilList(listOutput, volumes);
        
        removableDevices = listDevices;
        removableDevicesChecked = true;
        return listDevices;
    } catch {
        console.error('Failed to scan removable devices.');
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

    const addCurrentDisk = () => {
        if (!currentDisk?.isExternal) return;

        const deviceCountBefore = devices.length;
        for (const part of currentDisk.partitions) {
            if (part.name && volumes.includes(part.name)) {
                const mountPoint = path.join('/Volumes', part.name);
                devices.push({
                    deviceName: part.name,
                    mountPoint,
                    documentsVideoPath: path.join(mountPoint, 'Documents', 'Video'),
                    sizeBytes: currentDisk.sizeBytes,
                });
            }
        }

        if (devices.length === deviceCountBefore) {
            const mountPoint = guessMountPoint(currentDisk.partitions, volumes);
            if (mountPoint) {
                devices.push({
                    deviceName: path.basename(mountPoint),
                    mountPoint,
                    documentsVideoPath: path.join(mountPoint, 'Documents', 'Video'),
                    sizeBytes: currentDisk.sizeBytes,
                });
            }
        }
    };
    
    for (const line of lines) {
        // Match disk header: /dev/disk4 (external, physical):
        const diskMatch = line.match(/\/dev\/(disk\d+)\s+\(([^)]+)\)/);
        if (diskMatch) {
            addCurrentDisk();
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
    addCurrentDisk();
    
    return devices;
}

/**
 * Guess mount point for a disk when partition name doesn't match /Volumes
 */
function guessMountPoint(partitions, volumes) {
    const normalizedPartitionNames = partitions
        .map((partition) => partition.name.trim().toLocaleLowerCase())
        .filter(Boolean);

    for (const vol of volumes) {
        if (vol === 'Macintosh HD' || vol === 'Preboot' || vol === 'Recovery' || vol === 'Data' || vol === 'VM') continue;
        const normalizedVolume = vol.trim().toLocaleLowerCase();
        if (normalizedPartitionNames.some((name) => normalizedVolume.includes(name) || name.includes(normalizedVolume))) {
            return path.join('/Volumes', vol);
        }
    }
    return null;
}
function createLocalRateLimiter({windowMs = 60000, limit = 300} = {}) {
    return rateLimit({
        windowMs,
        limit,
        // This is one local-user process, not a multi-tenant proxy. A fixed key
        // bounds memory and prevents spoofed forwarding headers/IPs adding quota.
        keyGenerator: () => 'loopback',
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).set('Cache-Control', 'no-store')
            .json({error: 'Too many requests. Please try again later.'}),
    });
}

function killChildProcessTree(child) {
    try {
        if (process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, 'SIGKILL');
        } else {
            child.kill('SIGKILL');
        }
    } catch {
        try {
            child.kill('SIGKILL');
        } catch {
            // The child may already have exited between the attempts.
        }
    }
}

function installShutdownHandlers() {
    if (shutdownHandlersInstalled) return;
    shutdownHandlersInstalled = true;
    const shutdown = () => {
        if (shutdownRequested) return;
        shutdownRequested = true;
        shutdownController.abort(new Error('Server is shutting down'));
        if (activeHttpServer?.listening) {
            activeHttpServer.close();
            // close() alone leaves active requests eligible for a later keep-alive
            // wait. Disconnect them now; aborted route cleanup still owns its work.
            activeHttpServer.closeAllConnections();
        }
        for (const child of activeLongRunningChildren) killChildProcessTree(child);
        // Do not call process.exit() on the normal path. Waiting for the server and
        // child handles to close lets route cleanup (notably partial export removal)
        // finish before Node exits naturally.
        const hardExit = setTimeout(() => process.exit(1), 2000);
        hardExit.unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

function runProcess(command, args, { cwd, env, captureStderr = false, signal } = {}) {
    signal = operationSignal(signal);
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason || new Error(`${path.basename(command)} was aborted`));
            return;
        }

        const stdio = captureStderr
            ? ['ignore', 'ignore', 'pipe']
            : 'inherit';
        const child = spawn(command, args, {
            stdio,
            cwd,
            env,
            detached: process.platform !== 'win32',
        });
        activeLongRunningChildren.add(child);
        let stderrOutput = '';
        if (captureStderr) {
            child.stderr.on('data', (data) => {
                stderrOutput = (stderrOutput + data.toString()).slice(-MAX_ERROR_TAIL_BYTES);
            });
        }

        let settled = false;
        let aborted = false;

        const onAbort = () => {
            aborted = true;
            try {
                if (captureStderr) child.stderr?.destroy();
            } catch {
                // Ignore stream destruction errors
            }
            killChildProcessTree(child);
        };

        if (signal) {
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        }

        const cleanup = () => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            activeLongRunningChildren.delete(child);
        };

        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (aborted) {
                reject(signal?.reason || new Error(`${path.basename(command)} was aborted`));
            } else if (code === 0) {
                resolve({stderr: stderrOutput});
            } else {
                reject(new Error(`${path.basename(command)} failed with exit code ${code}${stderrOutput ? ': ' + stderrOutput.trim().slice(-200) : ''}`));
            }
        });
    });
}

function runCapture(command, args, { cwd, env, timeout = 15000, signal } = {}) {
    signal = operationSignal(signal);
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            return reject(signal.reason || new Error(`${path.basename(command)} was aborted`));
        }
        const ownsProcessGroup = process.platform !== 'win32';
        const child = spawn(command, args, {
            cwd,
            env,
            detached: ownsProcessGroup,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        activeLongRunningChildren.add(child);
        let stdout = '';
        let stderr = '';
        let settled = false;
        let terminalError = null;
        let aborted = false;

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
            activeLongRunningChildren.delete(child);
            callback(value);
        };

        const terminate = (error) => {
            if (terminalError) return;
            terminalError = error;
            try {
                child.stdout?.destroy();
                child.stderr?.destroy();
            } catch {
                // Ignore stream destruction errors
            }
            killChildProcessTree(child);
        };

        const onAbort = () => {
            aborted = true;
            terminate(signal.reason || new Error(`${path.basename(command)} was aborted`));
        };

        if (signal) {
            if (signal.aborted) {
                onAbort();
            } else {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        }

        const timer = setTimeout(() => {
            terminate(new Error(`${path.basename(command)} timed out`));
        }, timeout);

        child.stdout.on('data', (data) => {
            stdout += data.toString();
            if (Buffer.byteLength(stdout) > MAX_CAPTURE_BYTES) {
                child.stdout.destroy();
                child.stderr.destroy();
                terminate(new Error(`${path.basename(command)} output exceeded the safety limit`));
            }
        });
        child.stderr.on('data', (data) => {
            stderr = (stderr + data.toString()).slice(-MAX_ERROR_TAIL_BYTES);
        });
        child.on('error', (error) => finish(reject, error));
        child.on('close', (code) => {
            if (aborted) {
                finish(reject, signal?.reason || new Error(`${path.basename(command)} was aborted`));
                return;
            }
            if (terminalError) {
                finish(reject, terminalError);
                return;
            }
            if (code === 0) {
                finish(resolve, { stdout, stderr });
                return;
            }
            finish(reject, new Error(stderr || `${path.basename(command)} failed with exit code ${code}`));
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

function resolveExecutable(name, {env = process.env, resourcesDir = RESOURCE_DIR, bundled = true, platform = process.platform} = {}) {
    const envName = `MIOFIVE_${name.toUpperCase()}_PATH`;
    if (Object.hasOwn(env, envName)) {
        const envPath = env[envName];
        if (typeof envPath !== 'string' || !envPath.trim() || !executableExists(envPath)) {
            throw new Error(`${envName} must point to an executable file`);
        }
        return envPath;
    }

    const candidates = [
        bundled ? path.join(resourcesDir, 'bin', executableName(name)) : undefined,
        platform === 'darwin' ? `/opt/homebrew/bin/${name}` : undefined,
        platform === 'darwin' ? `/usr/local/bin/${name}` : undefined,
        ...(env.PATH || '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, executableName(name))),
        name,
    ].filter(Boolean);

    return candidates.find((candidate) => candidate === name || executableExists(candidate)) || name;
}

function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function requestHostname(hostHeader) {
    if (!hostHeader || typeof hostHeader !== 'string') return null;
    try {
        return new URL(`http://${hostHeader}`).hostname;
    } catch {
        return null;
    }
}

function requestBoundaryGuard(req, res, next) {
    const hostname = requestHostname(req.headers.host);
    if (!hostname || !isLoopbackHostname(hostname)) {
        return res.status(403).json({error: 'Request host is not allowed'});
    }

    if (req.get('sec-fetch-site') === 'cross-site') {
        return res.status(403).json({error: 'Cross-site requests are not allowed'});
    }

    const origin = req.get('origin');
    if (origin) {
        if (origin === 'null') {
            return res.status(403).json({error: 'Cross-origin requests are not allowed'});
        }
        try {
            const originUrl = new URL(origin);
            if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.host !== req.headers.host) {
                return res.status(403).json({error: 'Cross-origin requests are not allowed'});
            }
        } catch {
            return res.status(403).json({error: 'Invalid request origin'});
        }
    }

    const referer = req.get('referer');
    if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (!['http:', 'https:'].includes(refererUrl.protocol) || refererUrl.host !== req.headers.host) {
                return res.status(403).json({error: 'Cross-origin requests are not allowed'});
            }
        } catch {
            return res.status(403).json({error: 'Invalid request referer'});
        }
    }

    return next();
}

app.disable('x-powered-by');
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'none'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", 'data:'],
            mediaSrc: ["'self'", 'blob:'],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            workerSrc: ["'self'"],
            upgradeInsecureRequests: null,
        },
    },
    crossOriginEmbedderPolicy: false,
}));
app.use(requestBoundaryGuard);
// Reject hostile browser origins before consuming quota. Keep media's legitimate
// range-request bursts separate from controls, and limit before parsing bodies
// or doing filesystem/process work. Express mounts also cover case/trailing slash.
app.use(['/api', '/check-ffmpeg', '/demo-mode', '/export', '/list-directories', '/scan'], createLocalRateLimiter());
app.use('/video', createLocalRateLimiter());
app.use(express.json({limit: '64kb', strict: true}));
app.use((req, res, next) => {
    const normalizedRoute = req.path.toLowerCase().replace(/\/+$/, '');
    if (PRIVATE_ENDPOINTS.has(normalizedRoute) || normalizedRoute.startsWith('/api/')) {
        res.set('Cache-Control', 'no-store');
    }

    if (
        ['POST', 'PUT', 'PATCH'].includes(req.method) &&
        (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    ) {
        return res.status(400).json({error: 'A JSON object request body is required'});
    }

    return next();
});

// Serve static assets (index.html, etc.)
app.use(express.static(PUBLIC_DIR));

// Check if FFmpeg is available
async function checkFFmpeg(signal = shutdownController.signal) {
    try {
        const ffmpegPath = resolveExecutable('ffmpeg');
        const ffprobePath = resolveExecutable('ffprobe');
        await runCapture(ffmpegPath, ['-version'], {signal});
        await runCapture(ffprobePath, ['-version'], {signal});
        return {
            available: true,
            bundled: ffmpegPath !== 'ffmpeg' && ffmpegPath.startsWith(BUNDLED_BIN_DIR),
        };
    } catch (err) {
        signal.throwIfAborted();
        return {
            available: false,
        };
    }
}

async function readMp4AtomHeader(handle, position, boundary) {
    if (!Number.isSafeInteger(position) || position < 0 || boundary - position < 8) return null;

    const header = Buffer.alloc(16);
    const {bytesRead} = await handle.read(header, 0, Math.min(16, boundary - position), position);
    if (bytesRead < 8) return null;

    const size32 = header.readUInt32BE(0);
    const type = header.toString('ascii', 4, 8);
    let headerSize = 8;
    let size;

    if (size32 === 1) {
        if (bytesRead < 16) return null;
        const size64 = header.readBigUInt64BE(8);
        if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(size64);
        headerSize = 16;
    } else if (size32 === 0) {
        size = boundary - position;
    } else {
        size = size32;
    }

    if (size < headerSize || position + size > boundary) return null;
    return {position, type, size, headerSize, end: position + size};
}

// Walks MP4 atom headers and skips payloads, so a valid `moov` atom may be at the end of a large file.
async function getVideoDurationFast(filePath, signal = shutdownController.signal) {
    signal.throwIfAborted();
    const handle = await fs.open(filePath, 'r');
    try {
        const {size: fileSize} = await handle.stat();
        let position = 0;
        let moov = null;
        let atomCount = 0;

        while (position < fileSize) {
            signal.throwIfAborted();
            if (++atomCount > MAX_MP4_ATOMS) return null;
            const atom = await readMp4AtomHeader(handle, position, fileSize);
            if (!atom) return null;
            if (atom.type === 'moov') {
                moov = atom;
                break;
            }
            position = atom.end;
        }

        if (!moov) return null;
        position = moov.position + moov.headerSize;

        while (position < moov.end) {
            signal.throwIfAborted();
            if (++atomCount > MAX_MP4_ATOMS) return null;
            const atom = await readMp4AtomHeader(handle, position, moov.end);
            if (!atom) return null;

            if (atom.type === 'mvhd') {
                const payloadLength = Math.min(atom.size - atom.headerSize, 32);
                if (payloadLength < 20) return null;
                const payload = Buffer.alloc(payloadLength);
                const {bytesRead} = await handle.read(
                    payload,
                    0,
                    payloadLength,
                    atom.position + atom.headerSize
                );
                if (bytesRead !== payloadLength) return null;

                const version = payload.readUInt8(0);
                let timescale;
                let duration;
                if (version === 0) {
                    timescale = payload.readUInt32BE(12);
                    duration = payload.readUInt32BE(16);
                    if (duration === 0xFFFFFFFF) return null;
                } else if (version === 1 && payloadLength >= 32) {
                    timescale = payload.readUInt32BE(20);
                    const duration64 = payload.readBigUInt64BE(24);
                    if (duration64 === 0xFFFFFFFFFFFFFFFFn) return null;
                    if (duration64 > BigInt(Number.MAX_SAFE_INTEGER)) return null;
                    duration = Number(duration64);
                } else {
                    return null;
                }

                if (!Number.isFinite(timescale) || timescale <= 0) return null;
                const seconds = duration / timescale;
                return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_SANE_VIDEO_DURATION ? seconds : null;
            }

            position = atom.end;
        }

        return null;
    } finally {
        await handle.close();
    }
}

async function mapWithConcurrency(values, concurrency, callback, signal) {
    signal = operationSignal(signal);
    const results = new Array(values.length);
    let nextIndex = 0;
    let failure = null;

    const workers = Array.from({length: Math.min(concurrency, values.length)}, async () => {
        while (nextIndex < values.length) {
            if (signal?.aborted) {
                throw signal.reason || new Error('Operation was aborted');
            }
            if (failure) {
                throw failure;
            }
            const index = nextIndex++;
            try {
                results[index] = await callback(values[index], index);
            } catch (err) {
                failure = err;
                throw err;
            }
            if (signal?.aborted) {
                throw signal.reason || new Error('Operation was aborted');
            }
        }
    });
    const settledWorkers = await Promise.allSettled(workers);
    const firstRejection = settledWorkers.find((result) => result.status === 'rejected');
    if (firstRejection) {
        throw firstRejection.reason;
    }
    return results;
}

async function getVideoDurationsBatch(filePaths, options = {}) {
    const signal = options instanceof AbortSignal ? options : options?.signal;
    return mapWithConcurrency(filePaths, 4, async (filePath) => {
        try {
            return await getVideoDuration(filePath, signal);
        } catch (err) {
            if (signal?.aborted) {
                throw err;
            }
            return null;
        }
    }, signal);
}

// Parse filename to extract UTC and local timestamps
function parseFilename(filename) {
    // Pattern: {MMDDYY}_{HHMMSS}_{MMDDYY}_{HHMMSS}_{dddddd(A|B)}.MP4
    const pattern = /^(\d{6})_(\d{6})_(\d{6})_(\d{6})_(\d{6}[AB])\.MP4$/i;
    const match = filename.match(pattern);
    if (!match) return null;

    const [, utcDate, utcTime, localDate, localTime, sequence] = match;

    const parseDateTime = (datePart, timePart) => {
        const month = Number(datePart.slice(0, 2));
        const day = Number(datePart.slice(2, 4));
        const year = 2000 + Number(datePart.slice(4, 6));
        const hour = Number(timePart.slice(0, 2));
        const minute = Number(timePart.slice(2, 4));
        const second = Number(timePart.slice(4, 6));
        // Camera wall time has no timezone identifier. Validate its calendar fields
        // without applying the viewer computer's timezone or DST transition rules.
        const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
        const parts = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()];
        const expected = [year, month, day, hour, minute, second];
        return parts.every((part, index) => part === expected[index]) ? value : null;
    };

    const utcTimestamp = parseDateTime(utcDate, utcTime);
    const localTimestamp = parseDateTime(localDate, localTime);

    return {
        utcTimestamp,
        localTimestamp,
        sequence,
        isValid: Boolean(utcTimestamp && localTimestamp)
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
async function scanDirectory(dirPath, startTime, endTime, signal, state = {count: 0, visited: 0}, depth = 0) {
    signal.throwIfAborted();
    if (depth > 32) throw new Error('Folder nesting is too deep');
    const results = [];
    const entries = await fs.opendir(dirPath);
    for await (const entry of entries) {
        signal.throwIfAborted();
        if (++state.visited > 100000) throw new Error('Folder contains too many entries; choose a smaller folder');
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const subResults = await scanDirectory(fullPath, startTime, endTime, signal, state, depth + 1);
            results.push(...subResults);
        } else if (entry.isFile()) {
            const upperName = entry.name.toUpperCase();
            if (upperName.endsWith('A.MP4') || upperName.endsWith('B.MP4')) {
                const parsed = parseFilename(entry.name);
                if (parsed?.isValid) {
                    const timestamp = parsed.utcTimestamp.getTime();
                    if (startTime && timestamp < startTime) continue;
                    if (endTime && timestamp > endTime) continue;
                    state.count++;
                    if (state.count > 20000) throw new Error('Folder contains too many matching videos');
                    results.push({
                        path: fullPath,
                        filename: entry.name,
                        utcTime: parsed.utcTimestamp.toISOString(),
                        localTime: parsed.localTimestamp.toISOString().slice(0, -1),
                        timestamp,
                        fileType: getFileType(fullPath)
                    });
                }
            }
        }
    }
    return results.sort((a, b) => (
        a.timestamp - b.timestamp ||
        a.filename.localeCompare(b.filename) ||
        a.path.localeCompare(b.path)
    ));
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
        relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

async function realPathInside(parentPath, childPath) {
    const [realParent, realChild] = await Promise.all([
        fs.realpath(parentPath),
        fs.realpath(childPath),
    ]);
    return isPathInside(realParent, realChild);
}

async function requireDemoPath(targetPath) {
    if (DEMO_MODE && !(await realPathInside(TEST_DATA_DIR, targetPath))) {
        throw new Error('Access denied in demo mode. Only test-data is accessible.');
    }
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

async function getVideoDuration(filePath, signalOrOptions) {
    const signal = signalOrOptions instanceof AbortSignal ? signalOrOptions : signalOrOptions?.signal;
    if (signal?.aborted) {
        throw signal.reason || new Error('Operation was aborted');
    }
    try {
        const fastDuration = await getVideoDurationFast(filePath, operationSignal(signal));
        if (Number.isFinite(fastDuration) && fastDuration > 0 && fastDuration <= MAX_SANE_VIDEO_DURATION) {
            return fastDuration;
        }
    } catch {
        // Fall through to ffprobe for files whose MP4 metadata is not in the header.
    }

    if (signal?.aborted) {
        throw signal.reason || new Error('Operation was aborted');
    }

    const { stdout } = await runCapture(resolveExecutable('ffprobe'), [
        '-v', 'error',
        '-protocol_whitelist', 'file,pipe', '-f', 'mov',
        '-show_entries', 'format=duration',
        '-of', 'default=nokey=1:noprint_wrappers=1',
        filePath,
    ], { signal });
    const probedDuration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(probedDuration) || probedDuration <= 0 || probedDuration > MAX_SANE_VIDEO_DURATION) {
        throw new Error(`Unable to read duration for ${path.basename(filePath)}`);
    }
    return probedDuration;
}

async function hasAudioStream(filePath, signalOrOptions) {
    const signal = signalOrOptions instanceof AbortSignal ? signalOrOptions : signalOrOptions?.signal;
    if (signal?.aborted) {
        throw signal.reason || new Error('Operation was aborted');
    }
    const { stdout } = await runCapture(resolveExecutable('ffprobe'), [
        '-v', 'error',
        '-protocol_whitelist', 'file,pipe', '-f', 'mov',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=index',
        '-of', 'csv=p=0',
        filePath,
    ], { signal });
    // Only a successful, empty probe proves that a clip has no audio. A failed
    // probe must stop the export rather than silently discard the user's sound.
    return stdout.trim().length > 0;
}

async function validateInputFiles(files) {
    const normalizedFiles = [];

    for (const file of files) {
        if (typeof file !== 'string' || !file.trim()) {
            throw new Error('Invalid input file path');
        }

        const normalizedPath = path.resolve(file);
        if (!normalizedPath.toUpperCase().endsWith('.MP4')) {
            throw new Error('Only MP4 files are allowed');
        }

        await fs.access(normalizedPath);
        const stat = await fs.stat(normalizedPath);
        if (!stat.isFile()) {
            throw new Error('Path is not a file');
        }
        await requireDemoPath(normalizedPath);

        normalizedFiles.push(await fs.realpath(normalizedPath));
    }

    return normalizedFiles;
}

function validateOutputFilename(filename) {
    if (typeof filename !== 'string' || !filename || filename !== filename.trim()) {
        throw new Error('Output filename is required');
    }
    if (
        filename === '.' ||
        filename === '..' ||
        filename.length > 240 ||
        /[\0/\\<>:"|?*]/.test(filename) ||
        /[. ]$/.test(filename)
    ) {
        throw new Error('Output filename must be a plain filename without folders or reserved characters');
    }
    if (!/\.mp4$/i.test(filename)) throw new Error('Output filename must use the .mp4 extension');
    const stem = filename.slice(0, -4);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) {
        throw new Error('Output filename is reserved by the operating system');
    }
}

function resolveRequestedOutputPath({outputPath, outputFolder, outputFilename}) {
    if (outputFolder !== undefined || outputFilename !== undefined) {
        if (typeof outputFolder !== 'string' || !outputFolder.trim()) {
            throw new Error('Output folder is required');
        }
        validateOutputFilename(outputFilename);
        const normalizedFolder = path.resolve(outputFolder);
        const combinedPath = path.resolve(normalizedFolder, outputFilename);
        if (path.dirname(combinedPath) !== normalizedFolder) {
            throw new Error('Output filename must stay inside the selected folder');
        }
        return combinedPath;
    }

    if (typeof outputPath !== 'string' || !outputPath.trim()) {
        throw new Error('Output path is required');
    }
    return outputPath;
}

async function buildExportSegments(files, rangeStart, rangeEnd, signal) {
    if (signal?.aborted) {
        throw signal.reason || new Error('Export was aborted');
    }
    const durations = await mapWithConcurrency(files, 4, (filePath) => getVideoDuration(filePath, signal), signal);
    if (signal?.aborted) {
        throw signal.reason || new Error('Export was aborted');
    }
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

    if (!Number.isFinite(normalizedStart) || normalizedStart < 0) {
        throw new Error('Export start time cannot be negative');
    }
    if (normalizedEnd !== undefined && (!Number.isFinite(normalizedEnd) || normalizedEnd <= normalizedStart)) {
        throw new Error('Export end time must be after start time');
    }

    if (quality !== undefined && !Object.hasOwn(EXPORT_QUALITY_PROFILES, quality)) {
        throw new Error('Export quality is invalid');
    }
    const normalizedQuality = quality || 'max';

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
        'Output filename',
        'Too many files',
        'Export ',
        'Mixed camera channels',
        'Selected range',
        'Unable to read duration',
    ].some((pattern) => message.includes(pattern));
}

async function exportVideoRange({ files, finalOutputPath, rangeStart, rangeEnd, speed, quality, signal }) {
    if (signal?.aborted) {
        throw signal.reason || new Error('Export was aborted');
    }
    const options = normalizeExportOptions({ rangeStart, rangeEnd, speed, quality });
    const { segments, totalDuration, startSeconds, endSeconds } = await buildExportSegments(
        files,
        options.rangeStart,
        options.rangeEnd,
        signal
    );

    if (signal?.aborted) {
        throw signal.reason || new Error('Export was aborted');
    }

    const audioFlags = await mapWithConcurrency(segments, 4, (segment) => hasAudioStream(segment.file, signal), signal);

    if (signal?.aborted) {
        throw signal.reason || new Error('Export was aborted');
    }
    const includeAudio = audioFlags.some(Boolean);
    const args = ['-hide_banner', '-loglevel', 'info', '-stats', '-y'];
    let nextInputIndex = 0;

    segments.forEach((segment, index) => {
        segment.inputIndex = nextInputIndex;
        segment.hasAudio = audioFlags[index];
        args.push('-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', segment.file);
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

    args.push(
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-movflags', '+faststart',
        finalOutputPath
    );

    await runProcess(resolveExecutable('ffmpeg'), args, { captureStderr: true, signal });

    if (signal?.aborted) {
        throw signal.reason || new Error('Export was aborted');
    }

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

let exportInProgress = false;
let scanInProgress = false;

// Root: serve the HTML file explicitly (nice fallback)
app.get('/api/removable-devices', async (req, res) => {
    if (DEMO_MODE) return res.json([]);
    // Detect removable devices on startup
    if (!removableDevicesChecked) {
        await findRemovableDevices();
    }
    res.json(removableDevices);
});

app.post('/api/validate-path', async (req, res) => {
    const { path: targetPath, type } = req.body; // type: 'scan' | 'export'
    if (typeof targetPath !== 'string' || !targetPath.trim() || !['scan', 'export'].includes(type)) {
        return res.status(400).json({valid: false, error: 'A path and valid path type are required'});
    }
    if (DEMO_MODE && type === 'export') return res.json({valid: false});
    
    try {
        const normalizedPath = path.resolve(targetPath);
        const stats = await fs.stat(normalizedPath);
        await requireDemoPath(normalizedPath);
        return res.json({valid: stats.isDirectory(), path: normalizedPath});
    } catch {
        return res.json({valid: false});
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
    if (!DEMO_MODE && !removableDevicesChecked) {
        await findRemovableDevices();
    }
    
    res.json({
        enabled: DEMO_MODE,
        demoPath: DEMO_MODE ? TEST_DATA_DIR : null,
        removableDevices: DEMO_MODE ? [] : removableDevices,
    });
});

// List directories endpoint
app.post('/list-directories', async (req, res) => {
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
        
        if (typeof dirPath !== 'string') {
            return res.status(400).json({error: 'Path must be a string'});
        }

        const normalizedPath = path.resolve(dirPath);
        
        try {
            await fs.access(normalizedPath);
            await requireDemoPath(normalizedPath);
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
        } catch (error) {
            const status = error.message.startsWith('Access denied') ? 403 : 400;
            return res.status(status).json({error: status === 403 ? error.message : 'Unable to access directory'});
        }
    }
    
    const {path: dirPath} = req.body;
    
    try {
        // If no path provided, list root/common directories based on platform
        if (!dirPath) {
            const platform = os.platform();
            let locations = [];
            
            if (platform === 'win32') {
                // Windows: List available drives
                try {
                    const {stdout} = await runCapture('wmic', ['logicaldisk', 'get', 'name'], {timeout: 5000});
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
        
        // Normalize the selected local path; only demo mode imposes a fixed root.
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
    } catch {
        res.status(400).json({error: 'Unable to access directory'});
    }
});

// Scan endpoint
app.post('/scan', async (req, res) => {
    const {folderPath, startTime, endTime, channels, includeDurations = true} = req.body;
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return res.status(400).json({error: 'Folder path is required'});
    }
    if (channels !== undefined && (
        !Array.isArray(channels) ||
        channels.length !== 1 ||
        channels.some((channel) => !['A', 'B'].includes(channel))
    )) {
        return res.status(400).json({error: 'Select exactly one camera channel (A or B)'});
    }
    if (typeof includeDurations !== 'boolean') {
        return res.status(400).json({error: 'includeDurations must be a boolean'});
    }
    if (scanInProgress) {
        return res.status(409).json({error: 'Another scan is already in progress'});
    }

    const selectedChannels = channels || ['A'];
    const includeA = selectedChannels.includes('A');
    const includeB = selectedChannels.includes('B');

    const lifetime = requestLifetime(res);
    scanInProgress = true;
    try {
        lifetime.signal.throwIfAborted();
        const normalizedPath = path.resolve(folderPath);
        await fs.access(normalizedPath);
        const stat = await fs.stat(normalizedPath);
        if (!stat.isDirectory()) throw new Error('Path is not a directory');
        await requireDemoPath(normalizedPath);

        const startTs = startTime ? Date.parse(startTime) : null;
        const endTs = endTime ? Date.parse(endTime) : null;
        if (startTime && !Number.isFinite(startTs)) throw new Error('Invalid start time');
        if (endTime && !Number.isFinite(endTs)) throw new Error('Invalid end time');
        if (startTs !== null && endTs !== null && startTs > endTs) {
            throw new Error('Start time must not be after end time');
        }

        let files = await scanDirectory(await fs.realpath(normalizedPath), startTs, endTs, lifetime.signal);
        files = files.filter(f => {
            const name = f.filename.toUpperCase();
            return (includeA && name.endsWith('A.MP4')) || (includeB && name.endsWith('B.MP4'));
        });
        
        // Probe video durations if requested
        if (includeDurations && files.length > 0) {
            console.log(`Probing durations for ${files.length} video files...`);
            const durationProbeStartedAt = Date.now();
            const filePaths = files.map(f => f.path);
            const durations = await getVideoDurationsBatch(filePaths, {signal: lifetime.signal});
            
            // Add durations to file objects
            files = files.map((file, index) => ({
                ...file,
                duration: durations[index]
            }));
            
            const totalDuration = durations.reduce((sum, d) => sum + (d || 0), 0);
            const elapsed = Date.now() - durationProbeStartedAt;
            console.log(`Duration probing complete in ${elapsed}ms. Total duration: ${totalDuration.toFixed(2)}s`);
        }
        
        lifetime.signal.throwIfAborted();
        res.json({files, count: files.length});
    } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        const status = error.message.startsWith('Access denied') ? 403 : 400;
        res.status(status).json({
            error: status === 403 ? error.message : 'Invalid folder path, filters, or access permissions',
        });
    } finally {
        lifetime.dispose();
        scanInProgress = false;
    }
});


async function handleExportRequest(req, res) {
    if (DEMO_MODE) {
        return res.status(403).json({error: 'Video export is disabled in demo mode'});
    }
    const {files, outputPath, outputFolder, outputFilename, rangeStart, rangeEnd, speed, quality} = req.body;
    if (!Array.isArray(files) || files.length === 0 || files.length > 1000) {
        return res.status(400).json({error: 'No files to export'});
    }
    let requestedOutputPath;
    try {
        requestedOutputPath = resolveRequestedOutputPath({outputPath, outputFolder, outputFilename});
    } catch (error) {
        return res.status(400).json({error: error.message});
    }
    if (exportInProgress) {
        return res.status(409).json({error: 'Another export is already in progress'});
    }

    const abortController = requestLifetime(res);

    let stagedOutput;
    const cleanup = async () => {
        try { await cleanupExportOutput(stagedOutput); } catch {
            // Preserve uncertain/unexpected entries. Never broaden cleanup to the
            // user's destination or turn a committed export into a failed one.
            console.warn('Unable to remove private export staging folder; manual inspection may be needed.');
        }
        stagedOutput = undefined;
    };
    exportInProgress = true;
    try {
        if (abortController.signal.aborted) {
            throw abortController.signal.reason || new Error('Client disconnected');
        }
        const ffmpegStatus = await checkFFmpeg(abortController.signal);
        if (!ffmpegStatus.available) {
            return res.status(400).json({error: 'FFmpeg is not available in the app bundle or system PATH'});
        }
        if (abortController.signal.aborted) {
            throw abortController.signal.reason || new Error('Client disconnected');
        }
        const normalizedFiles = await validateInputFiles(files);
        if (abortController.signal.aborted) {
            throw abortController.signal.reason || new Error('Client disconnected');
        }
        const cameraChannels = new Set(normalizedFiles
            .map((filePath) => /([AB])\.MP4$/i.exec(path.basename(filePath))?.[1].toUpperCase())
            .filter(Boolean));
        if (cameraChannels.size > 1) {
            throw new Error('Mixed camera channels cannot be exported as one exact timeline');
        }
        stagedOutput = await prepareExportOutput(requestedOutputPath);
        if (abortController.signal.aborted) {
            throw abortController.signal.reason || new Error('Client disconnected');
        }
        const details = await exportVideoRange({
            files: normalizedFiles,
            finalOutputPath: stagedOutput.stagingPath,
            rangeStart,
            rangeEnd,
            speed,
            quality,
            signal: abortController.signal,
        });

        if (abortController.signal.aborted) {
            throw abortController.signal.reason || new Error('Client disconnected');
        }

        const finalOutputPath = await publishExportOutput(stagedOutput, abortController.signal);
        await cleanup();
        if (res.destroyed || res.writableEnded) return;
        res.json({
            success: true,
            message: 'Video exported successfully',
            output: finalOutputPath,
            details,
        });
    } catch (err) {
        await cleanup();
        if (!res.writableEnded && !res.destroyed) {
            const clientError = isClientInputError(err);
            res.status(clientError ? 400 : 500).json({
                error: clientError ? err.message : 'Video export failed',
            });
        }
    } finally {
        abortController.dispose();
        exportInProgress = false;
    }
}

app.post('/export', handleExportRequest);

// Serve video files with range support for streaming
function parseByteRange(rangeHeader, fileSize) {
    if (!rangeHeader) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (!match[1] && !match[2]) || fileSize <= 0) return undefined;

    let start;
    let end;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : fileSize - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
            return undefined;
        }
        end = Math.min(end, fileSize - 1);
    }
    return {start, end};
}

app.get('/video', async (req, res) => {
    const videoPath = req.query.path;
    
    if (typeof videoPath !== 'string' || !videoPath.trim()) {
        return res.status(400).json({error: 'Video path is required'});
    }
    
    try {
        // Normalize the selected local path; only demo mode imposes a fixed root.
        const normalizedPath = path.resolve(videoPath);
        
        // Normal mode intentionally serves an explicit local MP4 path so recordings may
        // live on removable media. The enforced security boundary is the loopback-only
        // listener plus request metadata checks above; demo mode additionally confines
        // every real path to bundled test data.
        
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
        await requireDemoPath(normalizedPath);
        
        const fileSize = stat.size;
        const parsedRange = parseByteRange(req.headers.range, fileSize);
        
        if (req.headers.range && !parsedRange) {
            res.set('Content-Range', `bytes */${fileSize}`);
            return res.sendStatus(416);
        }

        if (parsedRange) {
            const {start, end} = parsedRange;
            const chunkSize = (end - start) + 1;
            
            // Read the file stream
            const fileStream = fsSync.createReadStream(normalizedPath, {start, end});
            
            // Set headers for partial content
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-store',
            });
            
            await pipeline(fileStream, res);
        } else {
            // No range header, send the entire file
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-store',
            });
            
            await pipeline(fsSync.createReadStream(normalizedPath), res);
        }
    } catch (err) {
        if (!res.headersSent) {
            const status = err.message.startsWith('Access denied') ? 403 : 400;
            res.status(status).json({error: status === 403 ? err.message : 'Unable to access video file'});
        } else {
            res.destroy();
        }
    }
});

app.use((_req, res) => {
    res.status(404).json({error: 'Not found'});
});

app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') {
        return res.status(413).json({error: 'Request body is too large'});
    }
    if (error instanceof SyntaxError) {
        return res.status(400).json({error: 'Invalid JSON request body'});
    }
    return res.status(500).json({error: 'Unexpected server error'});
});

// Start server
async function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST, silent = false } = {}) {
    if (!isLoopbackHostname(host)) {
        throw new Error('Miofive Video Converter only supports loopback server binding');
    }
    installShutdownHandlers();
    const hasFFmpeg = await checkFFmpeg();

    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            activeHttpServer = server;
            const address = server.address();
            const resolvedPort = typeof address === 'object' && address ? address.port : port;
            const resolvedHost = host;

            if (!silent) {
                console.log(`\n✅ Server running at http://${resolvedHost}:${resolvedPort}\n`);
                if (DEMO_MODE) {
                    console.log('🎭 Demo Mode is ENABLED');
                    console.log(`   Only test-data directory is accessible: ${TEST_DATA_DIR}\n`);
                }
                if (hasFFmpeg.available) {
                    console.log(`✅ FFmpeg is ready (${hasFFmpeg.bundled ? 'bundled' : 'system'})`);
                } else {
                    console.log('⚠️  FFmpeg is NOT available');
                    console.log('   Video export will not work');
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
    createLocalRateLimiter,
    buildExportSegments,
    getVideoDuration,
    getVideoDurationFast,
    getVideoDurationsBatch,
    hasAudioStream,
    mapWithConcurrency,
    parseByteRange,
    parseDiskutilList,
    parseFilename,
    realPathInside,
    requestBoundaryGuard,
    resolveExecutable,
    resolveRequestedOutputPath,
    runCapture,
    runProcess,
};
