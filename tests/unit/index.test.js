const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

const {
    getVideoDurationFast,
    mapWithConcurrency,
    parseByteRange,
    parseDiskutilList,
    parseFilename,
    realPathInside,
    resolveExecutable,
    resolveRequestedOutputPath,
    runCapture,
    startServer,
} = require('../../index');

function atom(type, payload, extended = false) {
    const headerLength = extended ? 16 : 8;
    const buffer = Buffer.alloc(headerLength + payload.length);
    if (extended) {
        buffer.writeUInt32BE(1, 0);
        buffer.writeBigUInt64BE(BigInt(buffer.length), 8);
    } else {
        buffer.writeUInt32BE(buffer.length, 0);
    }
    buffer.write(type, 4, 4, 'ascii');
    payload.copy(buffer, headerLength);
    return buffer;
}

function request({port, requestPath = '/', method = 'GET', headers = {}, body}) {
    return new Promise((resolve, reject) => {
        const clientRequest = http.request({
            hostname: '127.0.0.1',
            port,
            path: requestPath,
            method,
            headers,
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks),
            }));
        });
        clientRequest.on('error', reject);
        if (body) clientRequest.write(body);
        clientRequest.end();
    });
}

async function startIsolatedDemoServer() {
    const entry = path.resolve('index.js');
    const program = `const {startServer}=require(${JSON.stringify(entry)});startServer({port:0,host:'127.0.0.1',silent:true}).then(({server,port})=>{process.stdout.write(String(port)+'\\n');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));}).catch(()=>process.exit(1));`;
    const child = spawn(process.execPath, ['-e', program], {
        cwd: path.dirname(entry),
        env: {...process.env, DEMO_MODE: 'true'},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            const lineEnd = stdout.indexOf('\n');
            if (lineEnd !== -1) resolve(Number(stdout.slice(0, lineEnd)));
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-4096);
        });
        child.once('exit', (code) => reject(new Error(`Demo server exited with ${code}: ${stderr}`)));
        child.once('error', reject);
    });
    return {child, port};
}

test('parseFilename treats both date components as MMDDYY and rejects impossible dates', () => {
    const parsed = parseFilename('123124_235959_123124_185959_000001A.MP4');
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.utcTimestamp.toISOString(), '2024-12-31T23:59:59.000Z');
    assert.equal(parsed.localTimestamp.getUTCFullYear(), 2024);
    assert.equal(parsed.localTimestamp.getUTCMonth(), 11);
    assert.equal(parsed.localTimestamp.getUTCDate(), 31);

    assert.equal(parseFilename('023125_120000_023125_120000_000001B.MP4').isValid, false);
    assert.equal(parseFilename('prefix_123124_235959_123124_185959_000001A.MP4'), null);
});

test('parseByteRange accepts bounded and suffix ranges and rejects malformed ranges', () => {
    assert.deepEqual(parseByteRange('bytes=0-9', 100), {start: 0, end: 9});
    assert.deepEqual(parseByteRange('bytes=90-', 100), {start: 90, end: 99});
    assert.deepEqual(parseByteRange('bytes=-10', 100), {start: 90, end: 99});
    assert.deepEqual(parseByteRange('bytes=0-1000', 100), {start: 0, end: 99});
    assert.equal(parseByteRange('bytes=100-101', 100), undefined);
    assert.equal(parseByteRange('bytes=0-1,3-4', 100), undefined);
    assert.equal(parseByteRange('nonsense', 100), undefined);
});

test('an explicitly configured media tool path fails closed when it is not executable', () => {
    const previous = process.env.MIOFIVE_FFMPEG_PATH;
    process.env.MIOFIVE_FFMPEG_PATH = path.join(os.tmpdir(), 'missing-miofive-ffmpeg');
    try {
        assert.throws(() => resolveExecutable('ffmpeg'), /must point to an executable file/);
    } finally {
        if (previous === undefined) delete process.env.MIOFIVE_FFMPEG_PATH;
        else process.env.MIOFIVE_FFMPEG_PATH = previous;
    }
});

test('output folder and filename are joined server-side without traversal or separator guessing', () => {
    const selectedFolder = path.join(os.tmpdir(), 'folder-with-backslash\\name');
    assert.equal(
        resolveRequestedOutputPath({outputFolder: selectedFolder, outputFilename: 'clip.mp4'}),
        path.join(selectedFolder, 'clip.mp4')
    );
    assert.throws(
        () => resolveRequestedOutputPath({outputFolder: selectedFolder, outputFilename: '../escape.mp4'}),
        /plain filename/
    );
});

test('MP4 duration parser finds an extended-size moov atom after a large media atom', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-mp4-parser-'));
    const filePath = path.join(directory, 'video.mp4');
    const mvhdPayload = Buffer.alloc(20);
    mvhdPayload.writeUInt8(0, 0);
    mvhdPayload.writeUInt32BE(1000, 12);
    mvhdPayload.writeUInt32BE(2500, 16);
    const bytes = Buffer.concat([
        atom('ftyp', Buffer.alloc(8)),
        atom('mdat', Buffer.alloc(1024 * 1024 + 16)),
        atom('moov', atom('mvhd', mvhdPayload), true),
    ]);

    try {
        await fs.writeFile(filePath, bytes);
        assert.equal(await getVideoDurationFast(filePath), 2.5);
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('MP4 duration parser bounds adversarial atom traversal', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-mp4-limit-'));
    const filePath = path.join(directory, 'video.mp4');
    const bytes = Buffer.concat(Array.from({length: 4097}, () => atom('free', Buffer.alloc(0))));

    try {
        await fs.writeFile(filePath, bytes);
        assert.equal(await getVideoDurationFast(filePath), null);
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('MP4 duration parser rejects version 0 indeterminate duration sentinel and excessive durations', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-mp4-sentinel-v0-'));
    const sentinelFile = path.join(directory, 'sentinel.mp4');
    const excessiveFile = path.join(directory, 'excessive.mp4');

    const sentinelPayload = Buffer.alloc(20);
    sentinelPayload.writeUInt8(0, 0);
    sentinelPayload.writeUInt32BE(1000, 12);
    sentinelPayload.writeUInt32BE(0xFFFFFFFF, 16);

    const excessivePayload = Buffer.alloc(20);
    excessivePayload.writeUInt8(0, 0);
    excessivePayload.writeUInt32BE(1, 12);
    excessivePayload.writeUInt32BE(86400 * 30 + 1, 16);

    try {
        await fs.writeFile(sentinelFile, Buffer.concat([atom('moov', atom('mvhd', sentinelPayload))]));
        assert.equal(await getVideoDurationFast(sentinelFile), null);

        await fs.writeFile(excessiveFile, Buffer.concat([atom('moov', atom('mvhd', excessivePayload))]));
        assert.equal(await getVideoDurationFast(excessiveFile), null);
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('MP4 duration parser parses valid version 1 64-bit mvhd atoms and rejects sentinels and excessive durations', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-mp4-v1-'));
    const validFile = path.join(directory, 'valid-v1.mp4');
    const sentinelFile = path.join(directory, 'sentinel-v1.mp4');
    const excessiveFile = path.join(directory, 'excessive-v1.mp4');

    // mvhd version 1 layout:
    // [0]: version (1)
    // [1..3]: flags (0)
    // [4..11]: creation_time (64-bit)
    // [12..19]: modification_time (64-bit)
    // [20..23]: timescale (32-bit)
    // [24..31]: duration (64-bit)
    const validPayload = Buffer.alloc(32);
    validPayload.writeUInt8(1, 0);
    validPayload.writeUInt32BE(1000, 20);
    validPayload.writeBigUInt64BE(5000n, 24);

    const sentinelPayload = Buffer.alloc(32);
    sentinelPayload.writeUInt8(1, 0);
    sentinelPayload.writeUInt32BE(1000, 20);
    sentinelPayload.writeBigUInt64BE(0xFFFFFFFFFFFFFFFFn, 24);

    const excessivePayload = Buffer.alloc(32);
    excessivePayload.writeUInt8(1, 0);
    excessivePayload.writeUInt32BE(1, 20);
    excessivePayload.writeBigUInt64BE(BigInt(86400 * 30 + 1), 24);

    try {
        await fs.writeFile(validFile, Buffer.concat([atom('moov', atom('mvhd', validPayload))]));
        assert.equal(await getVideoDurationFast(validFile), 5.0);

        await fs.writeFile(sentinelFile, Buffer.concat([atom('moov', atom('mvhd', sentinelPayload))]));
        assert.equal(await getVideoDurationFast(sentinelFile), null);

        await fs.writeFile(excessiveFile, Buffer.concat([atom('moov', atom('mvhd', excessivePayload))]));
        assert.equal(await getVideoDurationFast(excessiveFile), null);

        // Positive regression: v1 duration at high timescale must NOT be rejected.
        // 0xFFFFFFFF ticks at 90000 Hz = 47721.858… s (valid, < MAX_SANE_VIDEO_DURATION)
        const highTimescale90k = Buffer.alloc(32);
        highTimescale90k.writeUInt8(1, 0);
        highTimescale90k.writeUInt32BE(90000, 20);
        highTimescale90k.writeBigUInt64BE(0xFFFFFFFFn, 24);
        const ts90kFile = path.join(directory, 'v1-90k.mp4');
        await fs.writeFile(ts90kFile, Buffer.concat([atom('moov', atom('mvhd', highTimescale90k))]));
        const duration90k = await getVideoDurationFast(ts90kFile);
        assert.ok(Number.isFinite(duration90k), 'v1 0xFFFFFFFF ticks at 90kHz must parse');
        assert.ok(Math.abs(duration90k - (0xFFFFFFFF / 90000)) < 0.001,
            `expected ~${(0xFFFFFFFF / 90000).toFixed(3)}s, got ${duration90k}`);

        // 0xFFFFFFFF ticks at 1000000 Hz = 4294.967295 s (valid)
        const highTimescale1M = Buffer.alloc(32);
        highTimescale1M.writeUInt8(1, 0);
        highTimescale1M.writeUInt32BE(1000000, 20);
        highTimescale1M.writeBigUInt64BE(0xFFFFFFFFn, 24);
        const ts1MFile = path.join(directory, 'v1-1M.mp4');
        await fs.writeFile(ts1MFile, Buffer.concat([atom('moov', atom('mvhd', highTimescale1M))]));
        const duration1M = await getVideoDurationFast(ts1MFile);
        assert.ok(Number.isFinite(duration1M), 'v1 0xFFFFFFFF ticks at 1MHz must parse');
        assert.ok(Math.abs(duration1M - (0xFFFFFFFF / 1000000)) < 0.001,
            `expected ~${(0xFFFFFFFF / 1000000).toFixed(3)}s, got ${duration1M}`);
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('diskutil parser keeps every mounted external disk instead of only the last one', () => {
    const output = [
        '/dev/disk4 (external, physical):',
        '   0: GUID_partition_scheme *32.0 GB disk4',
        '   2: Microsoft Basic Data CAMERA ONE 31.9 GB disk4s2',
        '/dev/disk5 (external, physical):',
        '   0: GUID_partition_scheme *64.0 GB disk5',
        '   2: Microsoft Basic Data CAMERA TWO 63.9 GB disk5s2',
        '/dev/disk6 (internal, physical):',
        '   0: GUID_partition_scheme *1.0 TB disk6',
    ].join('\n');

    const devices = parseDiskutilList(output, ['CAMERA ONE', 'CAMERA TWO']);
    assert.deepEqual(devices.map((device) => device.deviceName), ['CAMERA ONE', 'CAMERA TWO']);
});

test('server refuses a non-loopback bind', async () => {
    await assert.rejects(
        () => startServer({port: 0, host: '0.0.0.0', silent: true}),
        /only supports loopback/
    );
});

test('real path containment rejects prefix siblings and symlinks that escape the root', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-containment-'));
    const allowedRoot = path.join(directory, 'test-data');
    const prefixSibling = path.join(directory, 'test-data-evil');
    const escapedLink = path.join(allowedRoot, 'escaped');
    await fs.mkdir(allowedRoot);
    await fs.mkdir(prefixSibling);
    await fs.symlink(prefixSibling, escapedLink, 'dir');

    try {
        assert.equal(await realPathInside(allowedRoot, allowedRoot), true);
        assert.equal(await realPathInside(allowedRoot, prefixSibling), false);
        assert.equal(await realPathInside(allowedRoot, escapedLink), false);
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('HTTP boundary rejects hostile hosts, sets CSP, and returns 416 for invalid video ranges', async () => {
    const {server, port} = await startServer({port: 0, host: '127.0.0.1', silent: true});
    const videoPath = path.resolve('test-data', 'Normal', '010125_100000_010125_050000_000001A.MP4');
    try {
        const root = await request({port});
        assert.equal(root.status, 200);
        assert.match(root.headers['content-security-policy'], /default-src 'self'/);
        assert.equal(root.headers['x-powered-by'], undefined);

        const hostileHost = await request({port, headers: {Host: 'attacker.example'}});
        assert.equal(hostileHost.status, 403);

        const hostileOrigin = await request({port, headers: {Origin: 'https://attacker.example'}});
        assert.equal(hostileOrigin.status, 403);

        const nullOrigin = await request({port, headers: {Origin: 'null'}});
        assert.equal(nullOrigin.status, 403);

        const crossSite = await request({port, headers: {'Sec-Fetch-Site': 'cross-site'}});
        assert.equal(crossSite.status, 403);

        const hostileReferer = await request({port, headers: {Referer: 'https://attacker.example/path'}});
        assert.equal(hostileReferer.status, 403);

        const invalidRange = await request({
            port,
            requestPath: `/video?path=${encodeURIComponent(videoPath)}`,
            headers: {Range: 'bytes=999999999-'},
        });
        assert.equal(invalidRange.status, 416);
        assert.match(invalidRange.headers['content-range'], /^bytes \*\/\d+$/);
        assert.equal(invalidRange.headers['cache-control'], 'no-store');

        const missingBody = await request({port, requestPath: '/scan', method: 'POST'});
        assert.equal(missingBody.status, 400);
        assert.match(JSON.parse(missingBody.body).error, /JSON object request body/);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test('demo mode hides devices, rejects arbitrary path probes, and disables export', async () => {
    const {child, port} = await startIsolatedDemoServer();
    const jsonHeaders = {'Content-Type': 'application/json'};
    try {
        const devices = await request({port, requestPath: '/api/removable-devices'});
        assert.equal(devices.status, 200);
        assert.deepEqual(JSON.parse(devices.body), []);

        const validation = await request({
            port,
            requestPath: '/api/validate-path',
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({path: os.tmpdir(), type: 'export'}),
        });
        assert.equal(validation.status, 200);
        assert.deepEqual(JSON.parse(validation.body), {valid: false});

        const exportResponse = await request({
            port,
            requestPath: '/export',
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({files: [path.resolve('test-data/Normal/example.MP4')], outputPath: '/tmp/out.mp4'}),
        });
        assert.equal(exportResponse.status, 403);
    } finally {
        child.kill('SIGTERM');
        await once(child, 'exit');
    }
});

test('capture timeout kills the complete Unix process group and closes inherited pipes', {
    skip: process.platform === 'win32',
}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-process-tree-'));
    const pidFile = path.join(directory, 'descendant.pid');
    const program = [
        "const fs=require('node:fs')",
        "const {spawn}=require('node:child_process')",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']})",
        "fs.writeFileSync(process.argv[1],String(child.pid))",
        "setInterval(()=>{},1000)",
    ].join(';');
    try {
        const startedAt = Date.now();
        await assert.rejects(
            () => runCapture(process.execPath, ['-e', program, pidFile], {timeout: 1500}),
            /timed out/
        );
        assert.ok(Date.now() - startedAt < 5000, 'timeout waited on a descendant-held pipe');

        const descendantPid = Number(await fs.readFile(pidFile, 'utf8'));
        let descendantExists = true;
        for (let attempt = 0; attempt < 20 && descendantExists; attempt++) {
            try {
                process.kill(descendantPid, 0);
                await new Promise((resolve) => setTimeout(resolve, 25));
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
                descendantExists = false;
            }
        }
        assert.equal(descendantExists, false, `descendant ${descendantPid} survived timeout`);
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('graceful shutdown kills an active process group and waits for asynchronous cleanup', {
    skip: process.platform === 'win32',
}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-shutdown-'));
    const partialFile = path.join(directory, 'partial.mp4');
    const descendantPidFile = path.join(directory, 'descendant.pid');
    const entry = path.resolve('index.js');
    const worker = [
        "const fs=require('node:fs')",
        "const {spawn}=require('node:child_process')",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']})",
        'fs.writeFileSync(process.argv[1],String(child.pid))',
        'setInterval(()=>{},1000)',
    ].join(';');
    const program = [
        "const fs=require('node:fs/promises')",
        `const {startServer,runProcess}=require(${JSON.stringify(entry)})`,
        '(async()=>{',
        "await startServer({port:0,host:'127.0.0.1',silent:true})",
        'await fs.writeFile(process.argv[1],\'partial\')',
        "process.stdout.write('ready\\n')",
        `try{await runProcess(process.execPath,['-e',${JSON.stringify(worker)},process.argv[2]],{captureStderr:true})}catch{await new Promise(resolve=>setTimeout(resolve,100));await fs.rm(process.argv[1],{force:true})}`,
        '})().catch(()=>process.exit(2))',
    ].join(';');
    const child = spawn(process.execPath, ['-e', program, partialFile, descendantPidFile], {
        cwd: path.dirname(entry),
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
        await Promise.race([
            once(child.stdout, 'data'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown fixture did not start')), 5000)),
        ]);
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                await fs.access(descendantPidFile);
                break;
            } catch (error) {
                if (error.code !== 'ENOENT' || attempt === 99) throw error;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }
        child.kill('SIGTERM');
        const [code, signal] = await Promise.race([
            once(child, 'exit'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('sidecar did not shut down')), 5000)),
        ]);
        assert.equal(code, 0, `sidecar exited via ${signal || code}`);
        await assert.rejects(() => fs.access(partialFile), {code: 'ENOENT'});

        const descendantPid = Number(await fs.readFile(descendantPidFile, 'utf8'));
        assert.throws(() => process.kill(descendantPid, 0), {code: 'ESRCH'});
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('graceful shutdown also owns bounded capture process groups', {
    skip: process.platform === 'win32',
}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-capture-shutdown-'));
    const pidFile = path.join(directory, 'capture-pids.json');
    const entry = path.resolve('index.js');
    const worker = [
        "const fs=require('node:fs')",
        "const {spawn}=require('node:child_process')",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']})",
        'fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]))',
        'setInterval(()=>{},1000)',
    ].join(';');
    const program = [
        `const {startServer,runCapture}=require(${JSON.stringify(entry)})`,
        '(async()=>{',
        "await startServer({port:0,host:'127.0.0.1',silent:true})",
        "process.stdout.write('ready\\n')",
        `try{await runCapture(process.execPath,['-e',${JSON.stringify(worker)},process.argv[1]],{timeout:30000})}catch{}`,
        '})().catch(()=>process.exit(2))',
    ].join(';');
    const child = spawn(process.execPath, ['-e', program, pidFile], {
        cwd: path.dirname(entry),
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
        await Promise.race([
            once(child.stdout, 'data'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('capture fixture did not start')), 5000)),
        ]);
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                await fs.access(pidFile);
                break;
            } catch (error) {
                if (error.code !== 'ENOENT' || attempt === 99) throw error;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }

        child.kill('SIGTERM');
        const [code, signal] = await Promise.race([
            once(child, 'exit'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('capture sidecar did not shut down')), 5000)),
        ]);
        assert.equal(code, 0, `capture sidecar exited via ${signal || code}`);
        const pids = JSON.parse(await fs.readFile(pidFile, 'utf8'));
        for (const pid of pids) {
            assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
        }
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('subprocess capture destroys streams and terminates process group when output exceeds safety limit', async () => {
    const program = "process.stdout.write('A'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000)";
    await assert.rejects(
        () => runCapture(process.execPath, ['-e', program], {timeout: 5000}),
        /output exceeded the safety limit/
    );
});

test('client HTTP disconnect during export terminates transcode process, removes partial output, and frees mutex', {
    skip: process.platform === 'win32',
}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-export-abort-'));
    const mockFfmpeg = path.join(directory, 'mock-ffmpeg');
    const pidFile = path.join(directory, 'ffmpeg.pid');
    const outputFile = path.join(directory, 'output.mp4');
    const sampleVideo = path.resolve('test-data', 'Normal', '010125_100000_010125_050000_000001A.MP4');

    const scriptContent = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "if (process.argv.includes('-version')) {",
        "    process.stdout.write('ffmpeg version 7.0\\n');",
        '    process.exit(0);',
        '}',
        'const pidFile = process.env.MOCK_PID_FILE;',
        'if (pidFile) fs.writeFileSync(pidFile, String(process.pid));',
        'const outPath = process.argv[process.argv.length - 1];',
        "if (outPath && outPath.endsWith('.mp4')) fs.writeFileSync(outPath, 'partial video data');",
        'setInterval(() => {}, 1000);',
    ].join('\n');

    await fs.writeFile(mockFfmpeg, scriptContent, {mode: 0o755});

    const previousFfmpegPath = process.env.MIOFIVE_FFMPEG_PATH;
    const previousPidFile = process.env.MOCK_PID_FILE;
    process.env.MIOFIVE_FFMPEG_PATH = mockFfmpeg;
    process.env.MOCK_PID_FILE = pidFile;

    const {server, port} = await startServer({port: 0, host: '127.0.0.1', silent: true});
    let clientRequest;
    let competingHandle;
    let ffmpegPid = null;
    let processTerminated = false;

    try {
        clientRequest = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        });
        clientRequest.on('error', () => {}); // Expected on client destroy
        clientRequest.write(JSON.stringify({
            files: [sampleVideo],
            outputPath: outputFile,
        }));
        clientRequest.end();

        // Wait for mock FFmpeg process to start and record its PID
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                ffmpegPid = Number(await fs.readFile(pidFile, 'utf8'));
                if (ffmpegPid) break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        assert.ok(ffmpegPid, 'mock FFmpeg did not start in time');
        assert.doesNotThrow(() => process.kill(ffmpegPid, 0), 'mock FFmpeg should be running');
        await assert.rejects(fs.access(outputFile), {code: 'ENOENT'}, 'no public placeholder while encoding');
        assert.ok((await fs.readdir(directory)).some((name) => name.startsWith('.miofive-export-')));
        const sentinel = Buffer.from('unrelated file created while export runs');
        competingHandle = await fs.open(outputFile, 'wx+', 0o600);
        await competingHandle.writeFile(sentinel);
        const competingIdentity = await competingHandle.stat();

        // Client disconnects while transcode is active
        clientRequest.destroy();

        // Wait for process termination and cleanup
        for (let attempt = 0; attempt < 40; attempt++) {
            try {
                process.kill(ffmpegPid, 0);
                await new Promise((resolve) => setTimeout(resolve, 25));
            } catch (error) {
                if (error.code === 'ESRCH') {
                    processTerminated = true;
                    break;
                }
                throw error;
            }
        }
        if (!processTerminated) {
            // Clean up orphan process before failing
            try {
                process.kill(ffmpegPid, 'SIGKILL');
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
        assert.ok(processTerminated, `mock FFmpeg PID ${ffmpegPid} was not killed on disconnect`);

        // Cleanup may outlive child termination, but must remove only staging.
        for (let attempt = 0; attempt < 100; attempt++) {
            if (!(await fs.readdir(directory)).some((name) => name.startsWith('.miofive-export-'))) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal((await fs.readdir(directory)).some((name) => name.startsWith('.miofive-export-')), false);
        const publicIdentity = await fs.lstat(outputFile);
        assert.ok(publicIdentity.isFile());
        assert.deepEqual([publicIdentity.dev, publicIdentity.ino, publicIdentity.size],
            [competingIdentity.dev, competingIdentity.ino, sentinel.length]);
        const contents = Buffer.alloc(sentinel.length);
        const {bytesRead} = await competingHandle.read(contents, 0, contents.length, 0);
        assert.equal(bytesRead, sentinel.length);
        assert.deepEqual(contents, sentinel);

        // Cross the actual mutex before failing tool preflight. An empty files
        // list returns before admission and cannot prove the mutex was released.
        process.env.MIOFIVE_FFMPEG_PATH = path.join(directory, 'absent-tool');
        const probeResponse = await request({
            port,
            requestPath: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({files: [sampleVideo], outputPath: outputFile}),
        });
        assert.equal(probeResponse.status, 400);
        assert.match(JSON.parse(probeResponse.body).error, /FFmpeg is not available/);
    } finally {
        clientRequest?.destroy();
        if (ffmpegPid && !processTerminated) {
            try { process.kill(-ffmpegPid, 'SIGKILL'); } catch { /* Already reaped. */ }
        }
        server.closeAllConnections();
        await competingHandle?.close();
        if (previousFfmpegPath !== undefined) process.env.MIOFIVE_FFMPEG_PATH = previousFfmpegPath;
        else delete process.env.MIOFIVE_FFMPEG_PATH;
        if (previousPidFile !== undefined) process.env.MOCK_PID_FILE = previousPidFile;
        else delete process.env.MOCK_PID_FILE;

        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('client HTTP disconnect during duration probe terminates ffprobe process group, stops queued probes, prevents FFmpeg launch, and frees mutex', {
    skip: process.platform === 'win32',
}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-probe-abort-'));
    const mockFfprobe = path.join(directory, 'mock-ffprobe');
    const mockFfmpeg = path.join(directory, 'mock-ffmpeg');
    const probePidFile = path.join(directory, 'probe.pid');
    const descendantPidFile = path.join(directory, 'probe-descendant.pid');
    const probePidsLog = path.join(directory, 'probe-pids.jsonl');
    const probeInvocationsFile = path.join(directory, 'probe-invocations.log');
    const ffmpegInvocationsFile = path.join(directory, 'ffmpeg-invocations.log');
    const outputFile = path.join(directory, 'output.mp4');

    const dummyVideos = [];
    for (let i = 1; i <= 6; i++) {
        const dummyPath = path.join(directory, `dummy${i}.MP4`);
        await fs.writeFile(dummyPath, Buffer.from('not an mp4 with moov'));
        dummyVideos.push(dummyPath);
    }

    const ffprobeScript = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const {spawn} = require('node:child_process');",
        "if (process.argv.includes('-version')) {",
        "    process.stdout.write('ffprobe version 7.0\\n');",
        '    process.exit(0);',
        '}',
        'const invocationsFile = process.env.PROBE_INVOCATIONS_FILE;',
        'const filePath = process.argv[process.argv.length - 1];',
        "if (invocationsFile) fs.appendFileSync(invocationsFile, filePath + '\\n');",
        'const pidFile = process.env.PROBE_PID_FILE;',
        'const descendantPidFile = process.env.PROBE_DESCENDANT_PID_FILE;',
        'const pidsLog = process.env.PROBE_PIDS_LOG;',
        "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "    stdio: ['ignore', 'pipe', 'pipe'],",
        '});',
        'if (pidFile) fs.writeFileSync(pidFile, String(process.pid));',
        'if (descendantPidFile) fs.writeFileSync(descendantPidFile, String(descendant.pid));',
        "if (pidsLog) fs.appendFileSync(pidsLog, JSON.stringify({ pid: process.pid, descendantPid: descendant.pid }) + '\\n');",
        'setInterval(() => {}, 1000);',
    ].join('\n');

    const ffmpegScript = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "if (process.argv.includes('-version')) {",
        "    process.stdout.write('ffmpeg version 7.0\\n');",
        '    process.exit(0);',
        '}',
        'const ffmpegLog = process.env.FFMPEG_INVOCATIONS_FILE;',
        "if (ffmpegLog) fs.appendFileSync(ffmpegLog, 'ffmpeg was spawned\\n');",
        'process.exit(0);',
    ].join('\n');

    await fs.writeFile(mockFfprobe, ffprobeScript, {mode: 0o755});
    await fs.writeFile(mockFfmpeg, ffmpegScript, {mode: 0o755});

    const prevFfprobePath = process.env.MIOFIVE_FFPROBE_PATH;
    const prevFfmpegPath = process.env.MIOFIVE_FFMPEG_PATH;
    const prevProbePidFile = process.env.PROBE_PID_FILE;
    const prevDescendantPidFile = process.env.PROBE_DESCENDANT_PID_FILE;
    const prevProbePidsLog = process.env.PROBE_PIDS_LOG;
    const prevInvocationsFile = process.env.PROBE_INVOCATIONS_FILE;
    const prevFfmpegLog = process.env.FFMPEG_INVOCATIONS_FILE;

    process.env.MIOFIVE_FFPROBE_PATH = mockFfprobe;
    process.env.MIOFIVE_FFMPEG_PATH = mockFfmpeg;
    process.env.PROBE_PID_FILE = probePidFile;
    process.env.PROBE_DESCENDANT_PID_FILE = descendantPidFile;
    process.env.PROBE_PIDS_LOG = probePidsLog;
    process.env.PROBE_INVOCATIONS_FILE = probeInvocationsFile;
    process.env.FFMPEG_INVOCATIONS_FILE = ffmpegInvocationsFile;

    const {server, port} = await startServer({port: 0, host: '127.0.0.1', silent: true});

    try {
        const clientRequest = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        });
        clientRequest.on('error', () => {});
        clientRequest.write(JSON.stringify({
            files: dummyVideos,
            outputPath: outputFile,
        }));
        clientRequest.end();

        let probePid = null;
        let descendantPid = null;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                probePid = Number(await fs.readFile(probePidFile, 'utf8'));
                descendantPid = Number(await fs.readFile(descendantPidFile, 'utf8'));
                if (probePid && descendantPid) break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        assert.ok(probePid, 'mock ffprobe did not start in time');
        assert.ok(descendantPid, 'mock ffprobe descendant did not start in time');
        assert.doesNotThrow(() => process.kill(probePid, 0), 'mock ffprobe should be running');
        assert.doesNotThrow(() => process.kill(descendantPid, 0), 'mock ffprobe descendant should be running');

        clientRequest.destroy();

        let pids = [];
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                const content = await fs.readFile(probePidsLog, 'utf8');
                pids = content.trim().split('\n').filter(Boolean).map(JSON.parse);
                if (pids.length > 0) break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        assert.ok(pids.length > 0, 'no probe PIDs recorded');

        for (const item of pids) {
            let probeTerminated = false;
            let descendantTerminated = false;
            for (let attempt = 0; attempt < 40; attempt++) {
                try {
                    process.kill(item.pid, 0);
                } catch (err) {
                    if (err.code === 'ESRCH') probeTerminated = true;
                }
                try {
                    process.kill(item.descendantPid, 0);
                } catch (err) {
                    if (err.code === 'ESRCH') descendantTerminated = true;
                }
                if (probeTerminated && descendantTerminated) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (!probeTerminated || !descendantTerminated) {
                try { process.kill(-item.pid, 'SIGKILL'); } catch { /* ignore cleanup error */ }
                try { process.kill(item.pid, 'SIGKILL'); } catch { /* ignore cleanup error */ }
                try { process.kill(item.descendantPid, 'SIGKILL'); } catch { /* ignore cleanup error */ }
            }
            assert.equal(probeTerminated, true, `probe PID ${item.pid} was not killed on disconnect`);
            assert.equal(descendantTerminated, true, `descendant PID ${item.descendantPid} was not killed on disconnect`);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));

        const invocations = (await fs.readFile(probeInvocationsFile, 'utf8')).trim().split('\n').filter(Boolean);
        assert.ok(invocations.length <= 4, `queued probes should have been stopped, but saw ${invocations.length} invocations`);
        assert.ok(invocations.length < dummyVideos.length, `all files were probed despite abort`);

        await assert.rejects(() => fs.access(ffmpegInvocationsFile), {code: 'ENOENT'});
        await assert.rejects(() => fs.access(outputFile), {code: 'ENOENT'});

        process.env.MIOFIVE_FFMPEG_PATH = path.join(directory, 'absent-tool');
        const probeResponse = await request({
            port,
            requestPath: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({files: dummyVideos, outputPath: outputFile}),
        });
        assert.equal(probeResponse.status, 400);
        assert.match(JSON.parse(probeResponse.body).error, /FFmpeg is not available/);
    } finally {
        if (prevFfprobePath !== undefined) process.env.MIOFIVE_FFPROBE_PATH = prevFfprobePath;
        else delete process.env.MIOFIVE_FFPROBE_PATH;
        if (prevFfmpegPath !== undefined) process.env.MIOFIVE_FFMPEG_PATH = prevFfmpegPath;
        else delete process.env.MIOFIVE_FFMPEG_PATH;
        if (prevProbePidFile !== undefined) process.env.PROBE_PID_FILE = prevProbePidFile;
        else delete process.env.PROBE_PID_FILE;
        if (prevDescendantPidFile !== undefined) process.env.PROBE_DESCENDANT_PID_FILE = prevDescendantPidFile;
        else delete process.env.PROBE_DESCENDANT_PID_FILE;
        if (prevProbePidsLog !== undefined) process.env.PROBE_PIDS_LOG = prevProbePidsLog;
        else delete process.env.PROBE_PIDS_LOG;
        if (prevInvocationsFile !== undefined) process.env.PROBE_INVOCATIONS_FILE = prevInvocationsFile;
        else delete process.env.PROBE_INVOCATIONS_FILE;
        if (prevFfmpegLog !== undefined) process.env.FFMPEG_INVOCATIONS_FILE = prevFfmpegLog;
        else delete process.env.FFMPEG_INVOCATIONS_FILE;

        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('client HTTP disconnect during audio probe terminates ffprobe process group, stops queued audio probes, prevents FFmpeg launch, and frees mutex', {
    skip: process.platform === 'win32',
}, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-audio-probe-abort-'));
    const mockFfprobe = path.join(directory, 'mock-ffprobe');
    const mockFfmpeg = path.join(directory, 'mock-ffmpeg');
    const audioProbePidFile = path.join(directory, 'audio-probe.pid');
    const audioDescendantPidFile = path.join(directory, 'audio-probe-descendant.pid');
    const audioPidsLog = path.join(directory, 'audio-pids.jsonl');
    const audioInvocationsFile = path.join(directory, 'audio-invocations.log');
    const ffmpegInvocationsFile = path.join(directory, 'ffmpeg-invocations.log');
    const outputFile = path.join(directory, 'output.mp4');

    const dummyVideos = [];
    const mvhdPayload = Buffer.alloc(20);
    mvhdPayload.writeUInt8(0, 0);
    mvhdPayload.writeUInt32BE(1000, 12);
    mvhdPayload.writeUInt32BE(5000, 16);
    const validMp4 = Buffer.concat([atom('moov', atom('mvhd', mvhdPayload))]);

    for (let i = 1; i <= 6; i++) {
        const dummyPath = path.join(directory, `video${i}.MP4`);
        await fs.writeFile(dummyPath, validMp4);
        dummyVideos.push(dummyPath);
    }

    const ffprobeScript = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const {spawn} = require('node:child_process');",
        "if (process.argv.includes('-version')) {",
        "    process.stdout.write('ffprobe version 7.0\\n');",
        '    process.exit(0);',
        '}',
        "if (process.argv.includes('format=duration')) {",
        "    process.stdout.write('5.0\\n');",
        '    process.exit(0);',
        '}',
        "if (process.argv.includes('-select_streams')) {",
        '    const invocationsFile = process.env.AUDIO_INVOCATIONS_FILE;',
        '    const filePath = process.argv[process.argv.length - 1];',
        "    if (invocationsFile) fs.appendFileSync(invocationsFile, filePath + '\\n');",
        '    const pidFile = process.env.AUDIO_PROBE_PID_FILE;',
        '    const descendantPidFile = process.env.AUDIO_DESCENDANT_PID_FILE;',
        '    const pidsLog = process.env.AUDIO_PIDS_LOG;',
        "    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "        stdio: ['ignore', 'pipe', 'pipe'],",
        '    });',
        '    if (pidFile) fs.writeFileSync(pidFile, String(process.pid));',
        '    if (descendantPidFile) fs.writeFileSync(descendantPidFile, String(descendant.pid));',
        "    if (pidsLog) fs.appendFileSync(pidsLog, JSON.stringify({ pid: process.pid, descendantPid: descendant.pid }) + '\\n');",
        '    setInterval(() => {}, 1000);',
        '}',
    ].join('\n');

    const ffmpegScript = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "if (process.argv.includes('-version')) {",
        "    process.stdout.write('ffmpeg version 7.0\\n');",
        '    process.exit(0);',
        '}',
        'const ffmpegLog = process.env.FFMPEG_INVOCATIONS_FILE;',
        "if (ffmpegLog) fs.appendFileSync(ffmpegLog, 'ffmpeg was spawned\\n');",
        'process.exit(0);',
    ].join('\n');

    await fs.writeFile(mockFfprobe, ffprobeScript, {mode: 0o755});
    await fs.writeFile(mockFfmpeg, ffmpegScript, {mode: 0o755});

    const prevFfprobePath = process.env.MIOFIVE_FFPROBE_PATH;
    const prevFfmpegPath = process.env.MIOFIVE_FFMPEG_PATH;
    const prevAudioPidFile = process.env.AUDIO_PROBE_PID_FILE;
    const prevDescendantPidFile = process.env.AUDIO_DESCENDANT_PID_FILE;
    const prevAudioPidsLog = process.env.AUDIO_PIDS_LOG;
    const prevAudioInvocations = process.env.AUDIO_INVOCATIONS_FILE;
    const prevFfmpegLog = process.env.FFMPEG_INVOCATIONS_FILE;

    process.env.MIOFIVE_FFPROBE_PATH = mockFfprobe;
    process.env.MIOFIVE_FFMPEG_PATH = mockFfmpeg;
    process.env.AUDIO_PROBE_PID_FILE = audioProbePidFile;
    process.env.AUDIO_DESCENDANT_PID_FILE = audioDescendantPidFile;
    process.env.AUDIO_PIDS_LOG = audioPidsLog;
    process.env.AUDIO_INVOCATIONS_FILE = audioInvocationsFile;
    process.env.FFMPEG_INVOCATIONS_FILE = ffmpegInvocationsFile;

    const {server, port} = await startServer({port: 0, host: '127.0.0.1', silent: true});

    try {
        const clientRequest = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        });
        clientRequest.on('error', () => {});
        clientRequest.write(JSON.stringify({
            files: dummyVideos,
            outputPath: outputFile,
        }));
        clientRequest.end();

        let probePid = null;
        let descendantPid = null;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                probePid = Number(await fs.readFile(audioProbePidFile, 'utf8'));
                descendantPid = Number(await fs.readFile(audioDescendantPidFile, 'utf8'));
                if (probePid && descendantPid) break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        assert.ok(probePid, 'mock ffprobe audio probe did not start in time');
        assert.ok(descendantPid, 'mock ffprobe descendant did not start in time');
        assert.doesNotThrow(() => process.kill(probePid, 0), 'mock ffprobe audio probe should be running');
        assert.doesNotThrow(() => process.kill(descendantPid, 0), 'mock ffprobe descendant should be running');

        clientRequest.destroy();

        let pids = [];
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                const content = await fs.readFile(audioPidsLog, 'utf8');
                pids = content.trim().split('\n').filter(Boolean).map(JSON.parse);
                if (pids.length > 0) break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        assert.ok(pids.length > 0, 'no audio probe PIDs recorded');

        for (const item of pids) {
            let probeTerminated = false;
            let descendantTerminated = false;
            for (let attempt = 0; attempt < 40; attempt++) {
                try {
                    process.kill(item.pid, 0);
                } catch (err) {
                    if (err.code === 'ESRCH') probeTerminated = true;
                }
                try {
                    process.kill(item.descendantPid, 0);
                } catch (err) {
                    if (err.code === 'ESRCH') descendantTerminated = true;
                }
                if (probeTerminated && descendantTerminated) break;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (!probeTerminated || !descendantTerminated) {
                try { process.kill(-item.pid, 'SIGKILL'); } catch { /* ignore cleanup error */ }
                try { process.kill(item.pid, 'SIGKILL'); } catch { /* ignore cleanup error */ }
                try { process.kill(item.descendantPid, 'SIGKILL'); } catch { /* ignore cleanup error */ }
            }
            assert.equal(probeTerminated, true, `audio probe PID ${item.pid} was not killed on disconnect`);
            assert.equal(descendantTerminated, true, `descendant PID ${item.descendantPid} was not killed on disconnect`);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));

        const invocations = (await fs.readFile(audioInvocationsFile, 'utf8')).trim().split('\n').filter(Boolean);
        assert.ok(invocations.length <= 4, `queued audio probes should have been stopped, but saw ${invocations.length} invocations`);
        assert.ok(invocations.length < dummyVideos.length, `all files were audio-probed despite abort`);

        await assert.rejects(() => fs.access(ffmpegInvocationsFile), {code: 'ENOENT'});
        await assert.rejects(() => fs.access(outputFile), {code: 'ENOENT'});

        process.env.MIOFIVE_FFMPEG_PATH = path.join(directory, 'absent-tool');
        const probeResponse = await request({
            port,
            requestPath: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({files: dummyVideos, outputPath: outputFile}),
        });
        assert.equal(probeResponse.status, 400);
        assert.match(JSON.parse(probeResponse.body).error, /FFmpeg is not available/);
    } finally {
        if (prevFfprobePath !== undefined) process.env.MIOFIVE_FFPROBE_PATH = prevFfprobePath;
        else delete process.env.MIOFIVE_FFPROBE_PATH;
        if (prevFfmpegPath !== undefined) process.env.MIOFIVE_FFMPEG_PATH = prevFfmpegPath;
        else delete process.env.MIOFIVE_FFMPEG_PATH;
        if (prevAudioPidFile !== undefined) process.env.AUDIO_PROBE_PID_FILE = prevAudioPidFile;
        else delete process.env.AUDIO_PROBE_PID_FILE;
        if (prevDescendantPidFile !== undefined) process.env.AUDIO_DESCENDANT_PID_FILE = prevDescendantPidFile;
        else delete process.env.AUDIO_DESCENDANT_PID_FILE;
        if (prevAudioPidsLog !== undefined) process.env.AUDIO_PIDS_LOG = prevAudioPidsLog;
        else delete process.env.AUDIO_PIDS_LOG;
        if (prevAudioInvocations !== undefined) process.env.AUDIO_INVOCATIONS_FILE = prevAudioInvocations;
        else delete process.env.AUDIO_INVOCATIONS_FILE;
        if (prevFfmpegLog !== undefined) process.env.FFMPEG_INVOCATIONS_FILE = prevFfmpegLog;
        else delete process.env.FFMPEG_INVOCATIONS_FILE;

        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('mapWithConcurrency awaits settlement of delayed second worker before error propagation', async () => {
    const controller = new AbortController();
    let worker1CleanedUp = false;
    let worker1Started = false;

    await assert.rejects(async () => {
        await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
            if (value === 1) {
                while (!worker1Started) {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                }
                controller.abort(new Error('worker 1 requested abort'));
                throw new Error('worker 1 failed');
            }
            if (value === 2) {
                worker1Started = true;
                await new Promise((resolve) => {
                    if (controller.signal.aborted) resolve();
                    else controller.signal.addEventListener('abort', resolve, {once: true});
                });
                await new Promise((resolve) => setTimeout(resolve, 50));
                worker1CleanedUp = true;
                return 'worker 2 done';
            }
            return value;
        }, controller.signal);
    }, /worker 1/);

    assert.equal(worker1CleanedUp, true, 'mapWithConcurrency must wait for all started workers to settle before rejecting');
});

test('positive real HTTP export request succeeds and normal JSON request does not trigger spurious disconnect', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-export-positive-'));
    const mockFfmpeg = path.join(directory, 'mock-ffmpeg');
    const outputFile = path.join(directory, 'positive-output.mp4');
    const sampleVideo = path.resolve('test-data', 'Normal', '010125_100000_010125_050000_000001A.MP4');

    const scriptContent = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "if (process.argv.includes('-version')) {",
        "    process.stdout.write('ffmpeg version 7.0\\n');",
        '    process.exit(0);',
        '}',
        'const outPath = process.argv[process.argv.length - 1];',
        "if (outPath && outPath.endsWith('.mp4')) fs.writeFileSync(outPath, 'valid output data');",
        'process.exit(0);',
    ].join('\n');

    await fs.writeFile(mockFfmpeg, scriptContent, {mode: 0o755});

    const previousFfmpegPath = process.env.MIOFIVE_FFMPEG_PATH;
    process.env.MIOFIVE_FFMPEG_PATH = mockFfmpeg;

    const {server, port} = await startServer({port: 0, host: '127.0.0.1', silent: true});

    try {
        const response = await request({
            port,
            requestPath: '/export',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                files: [sampleVideo],
                outputPath: outputFile,
                rangeStart: 0,
                rangeEnd: 1,
            }),
        });

        assert.equal(response.status, 200, `export failed: ${response.body.toString()}`);
        const parsed = JSON.parse(response.body);
        assert.equal(parsed.success, true);
        assert.equal(parsed.output, await fs.realpath(outputFile));

        const stat = await fs.stat(outputFile);
        assert.ok(stat.size > 0, 'output file should exist and have content');
    } finally {
        if (previousFfmpegPath !== undefined) process.env.MIOFIVE_FFMPEG_PATH = previousFfmpegPath;
        else delete process.env.MIOFIVE_FFMPEG_PATH;

        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await fs.rm(directory, {recursive: true, force: true});
    }
});
