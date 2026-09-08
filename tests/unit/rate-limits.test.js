const assert = require('node:assert/strict');
const {once} = require('node:events');
const test = require('node:test');
const {setTimeout: delay} = require('node:timers/promises');
const express = require('express');
const {app, createLocalRateLimiter, requestBoundaryGuard} = require('../../index');

async function serve(t, application) {
    const server = application.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

test('rate limiting rejects before work, ignores spoofed identities, and resets its window', {timeout: 10000}, async (t) => {
    const application = express();
    let workCalls = 0;
    application.use(requestBoundaryGuard);
    application.use(createLocalRateLimiter({windowMs: 1000, limit: 2}));
    application.get('/', (_req, res) => { workCalls++; res.json({ok: true}); });
    const base = await serve(t, application);
    // Hostile browser requests must not consume the user's two allowed requests.
    for (let index = 0; index < 3; index++) {
        assert.equal((await fetch(base, {headers: {origin: 'https://untrusted.invalid'}})).status, 403);
    }
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base, {headers: {'x-forwarded-for': '192.0.2.1'}})).status, 200);
    const blocked = await fetch(base, {headers: {'x-forwarded-for': '192.0.2.2'}});
    assert.equal(blocked.status, 429);
    assert.match(blocked.headers.get('retry-after'), /^\d+$/);
    assert.ok(blocked.headers.has('ratelimit'));
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await blocked.json(), {error: 'Too many requests. Please try again later.'});
    assert.equal(workCalls, 2);
    await delay(1100);
    assert.equal((await fetch(base)).status, 200);
    assert.equal(workCalls, 3);
});

test('actual private routes share control quota without exhausting media or static assets', {timeout: 15000}, async (t) => {
    const base = await serve(t, app);
    const request = (route, body = '{}') => fetch(`${base}${route}`, {
        method: 'POST', headers: {'content-type': 'application/json'}, body,
    });
    // Invalid requests are cheap, deterministic and still consume the real budget.
    for (let index = 0; index < 300; index++) {
        const response = await request('/api/validate-path');
        assert.equal(response.status, 400);
        await response.arrayBuffer();
    }
    for (const route of ['/api/validate-path', '/scan', '/SCAN/', '/export', '/list-directories']) {
        // Even malformed JSON cannot reach the body parser after exhaustion.
        assert.equal((await request(route, '{')).status, 429, route);
    }
    for (const route of ['/api/removable-devices', '/check-ffmpeg', '/demo-mode']) {
        assert.equal((await fetch(`${base}${route}`)).status, 429, route);
    }
    const video = await fetch(`${base}/VIDEO/`);
    assert.equal(video.status, 400, 'media has its own unexhausted quota');
    assert.ok(video.headers.has('ratelimit'));
    assert.equal(video.headers.get('cache-control'), 'no-store');
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.equal(page.headers.has('ratelimit'), false, 'static UI remains available');
});
