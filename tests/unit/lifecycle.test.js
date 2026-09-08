const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const test = require('node:test');
const {hasAudioStream} = require('../../index');

const entry = path.resolve(__dirname, '../../index.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventually(check, message) {
    for (let attempt = 0; attempt < 750; attempt++) {
        if (await check()) return;
        await delay(20);
    }
    assert.fail(message);
}

async function isRunning(pid) {
    try {
        process.kill(pid, 0);
        // Linux may retain a dead orphan until init reaps it. A zombie cannot
        // execute work or retain pipes; do not confuse it with a surviving worker.
        if (process.platform === 'linux') {
            const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
            if (!stat || /\) Z /.test(stat)) return false;
        }
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

async function scanFixture(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-scan-lifecycle-'));
    const media = path.join(directory, 'media');
    const log = path.join(directory, 'probes.jsonl');
    const probe = path.join(directory, 'probe.js');
    await fs.mkdir(media);
    for (let i = 0; i < 8; i++) {
        await fs.writeFile(path.join(media, `010125_10000${i}_010125_05000${i}_000001A.MP4`), 'synthetic invalid MP4');
    }
    await fs.writeFile(probe, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const {spawn} = require('node:child_process');",
        "if (process.argv.includes('-version')) { console.log('ffprobe version test'); process.exit(0); }",
        "const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {stdio:['ignore','inherit','inherit']});",
        `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({pid:process.pid,child:child.pid})+${JSON.stringify('\n')});`,
        "setTimeout(()=>{console.log('2');},10000);",
    ].join('\n'), {mode: 0o700});
    assert.equal(spawnSync(process.execPath, ['--check', probe]).status, 0, 'invalid fixture source');
    const server = spawn(process.execPath, ['-e', `require(${JSON.stringify(entry)}).startServer({port:0,silent:true}).then(({port})=>console.log('PORT='+port));`], {
        env: {...process.env, DEMO_MODE: 'false', MIOFIVE_FFMPEG_PATH: probe, MIOFIVE_FFPROBE_PATH: probe,
            PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    server.stdout.on('data', (chunk) => { stdout += chunk; });
    server.stderr.resume();
    let request;
    const records = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
    try {
        await eventually(() => /PORT=\d+/.test(stdout), 'fixture server did not start');
        const port = Number(/PORT=(\d+)/.exec(stdout)[1]);
        request = http.request({hostname: '127.0.0.1', port, path: '/scan', method: 'POST', headers: {'Content-Type': 'application/json'}});
        request.on('error', () => {});
        request.on('response', (response) => response.resume());
        request.end(JSON.stringify({folderPath: media, channels: ['A']}));
        await eventually(async () => (await records()).length === 4, 'four active probes did not start');
        await callback({server, port, request, records, media});
    } finally {
        request?.destroy();
        if (server.exitCode === null && server.signalCode === null) {
            server.kill('SIGTERM');
            await once(server, 'exit');
        }
        for (const {pid, child} of await records()) {
            for (const ownedPid of [pid, child]) {
                if (await isRunning(ownedPid)) process.kill(ownedPid, 'SIGKILL');
            }
        }
        await fs.rm(directory, {recursive: true, force: true});
    }
}

test('scan cancellation stops queued probes and descendants, releases pipes and permits a new scan', {skip: process.platform === 'win32'}, async () => {
    await scanFixture(async ({port, request, records, media}) => {
        request.destroy();
        await eventually(async () => (await Promise.all((await records()).flatMap(({pid, child}) => [isRunning(pid), isRunning(child)]))).every((alive) => !alive), 'scan processes survived cancellation');
        let response;
        await eventually(async () => {
            response = await fetch(`http://127.0.0.1:${port}/scan`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({folderPath: media, includeDurations: false}),
            });
            if (response.status === 409) { await response.text(); return false; }
            return true;
        }, 'scan mutex was not released');
        assert.equal(response.status, 200);
        assert.equal((await response.json()).count, 8);
        assert.equal((await records()).length, 4, 'queued probes must not start after cancellation');
    });
});

test('shutdown stops the scan queue before killing children and leaves no detached descendants', {skip: process.platform === 'win32'}, async () => {
    await scanFixture(async ({server, records}) => {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        const [code, signal] = await exited;
        assert.equal(code, 0, `server failed graceful shutdown: ${signal || code}`);
        assert.equal((await records()).length, 4, 'queued probes started during shutdown');
        await eventually(async () => (await Promise.all((await records()).flatMap(({pid, child}) => [isRunning(pid), isRunning(child)]))).every((alive) => !alive), 'detached descendants survived shutdown');
    });
});

test('camera civil date validation and serialization do not depend on viewer DST rules', () => {
    for (const timezone of ['UTC', 'America/New_York', 'Australia/Brisbane']) {
        const result = spawnSync(process.execPath, ['-e', `const x=require(${JSON.stringify(entry)}).parseFilename('030826_073000_030826_023000_000001A.MP4');console.log(JSON.stringify({valid:x.isValid,local:x.localTimestamp?.toISOString()}));`], {
            env: {...process.env, TZ: timezone}, encoding: 'utf8', timeout: 5000,
        });
        assert.equal(result.status, 0);
        assert.deepEqual(JSON.parse(result.stdout), {valid: true, local: '2026-03-08T02:30:00.000Z'}, timezone);
    }
});

test('audio probe errors are not evidence of a silent clip', {skip: process.platform === 'win32'}, async () => {
    const previous = process.env.MIOFIVE_FFPROBE_PATH;
    try {
        process.env.MIOFIVE_FFPROBE_PATH = '/usr/bin/false';
        await assert.rejects(() => hasAudioStream('synthetic.mp4'), /failed with exit code/);
        process.env.MIOFIVE_FFPROBE_PATH = '/usr/bin/true';
        assert.equal(await hasAudioStream('synthetic.mp4'), false);
    } finally {
        if (previous === undefined) delete process.env.MIOFIVE_FFPROBE_PATH;
        else process.env.MIOFIVE_FFPROBE_PATH = previous;
    }
});
