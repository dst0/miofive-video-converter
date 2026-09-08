const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {prepareExportOutput, publishExportOutput, cleanupExportOutput} = require('../../export-output');

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-publication-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    // macOS /var can itself be a symlink; assertions use actual canonical paths.
    const canonical = await fs.realpath(directory);
    return {directory: canonical, requested: path.join(canonical, 'result.mp4')};
}

test('export stages private bytes and publishes a complete no-clobber name at the last moment', async (t) => {
    const {directory, requested} = await fixture(t);
    const output = await prepareExportOutput(requested);
    assert.equal((await fs.readdir(directory)).length, 1, 'no public placeholder');
    if (process.platform !== 'win32') {
        assert.equal((await fs.stat(output.stagingDirectory)).mode & 0o777, 0o700);
        assert.equal((await fs.stat(output.stagingPath)).mode & 0o777, 0o600);
    }
    await fs.writeFile(output.stagingPath, 'complete synthetic video');
    // Another producer uses the requested name during the encode/probe phase.
    await fs.writeFile(requested, 'unrelated user file');
    const published = await publishExportOutput(output);
    assert.equal(published, path.join(directory, 'result_1.mp4'));
    await cleanupExportOutput(output);
    assert.equal(await fs.readFile(requested, 'utf8'), 'unrelated user file');
    assert.equal(await fs.readFile(published, 'utf8'), 'complete synthetic video');
    assert.deepEqual((await fs.readdir(directory)).sort(), ['result.mp4', 'result_1.mp4']);
});

test('a symlink collision created inside the publication syscall is not followed or overwritten', {skip: process.platform === 'win32'}, async (t) => {
    const {directory, requested} = await fixture(t);
    const output = await prepareExportOutput(requested);
    const sentinel = path.join(directory, 'sentinel.txt');
    await fs.writeFile(sentinel, 'unrelated');
    await fs.writeFile(output.stagingPath, 'complete');
    const originalLink = fs.link;
    t.mock.method(fs, 'link', async (source, destination) => {
        if (destination === requested) await fs.symlink(sentinel, destination);
        return originalLink(source, destination);
    });
    assert.equal(await publishExportOutput(output), path.join(directory, 'result_1.mp4'));
    await cleanupExportOutput(output);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated');
    assert.ok((await fs.lstat(requested)).isSymbolicLink());
});

test('retargeting the selected directory alias cannot redirect a prepared export', {skip: process.platform === 'win32'}, async (t) => {
    const {directory} = await fixture(t);
    const original = path.join(directory, 'original');
    const different = path.join(directory, 'different');
    const alias = path.join(directory, 'alias');
    await fs.mkdir(original);
    await fs.mkdir(different);
    await fs.symlink(original, alias);
    const sentinel = path.join(different, 'result.mp4');
    await fs.writeFile(sentinel, 'unrelated');
    const output = await prepareExportOutput(path.join(alias, 'result.mp4'));
    await fs.unlink(alias);
    await fs.symlink(different, alias);
    await fs.writeFile(output.stagingPath, 'complete');
    assert.equal(await publishExportOutput(output), path.join(original, 'result.mp4'));
    await cleanupExportOutput(output);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated');
});

test('cancellation before publication removes private partial bytes but never a competing public file', async (t) => {
    const {directory, requested} = await fixture(t);
    const output = await prepareExportOutput(requested);
    await fs.writeFile(output.stagingPath, 'partial');
    await fs.writeFile(requested, 'unrelated');
    const controller = new AbortController();
    controller.abort(new Error('synthetic disconnect'));
    await assert.rejects(publishExportOutput(output, controller.signal), /synthetic disconnect/);
    await cleanupExportOutput(output);
    assert.deepEqual(await fs.readdir(directory), ['result.mp4']);
    assert.equal(await fs.readFile(requested, 'utf8'), 'unrelated');
});

test('disconnect immediately after successful publication leaves completed output intact', async (t) => {
    const {directory, requested} = await fixture(t);
    const output = await prepareExportOutput(requested);
    await fs.writeFile(output.stagingPath, 'complete');
    const controller = new AbortController();
    const originalLink = fs.link;
    t.mock.method(fs, 'link', async (...args) => {
        await originalLink(...args);
        controller.abort(new Error('synthetic late disconnect'));
    });
    assert.equal(await publishExportOutput(output, controller.signal), requested);
    await cleanupExportOutput(output);
    assert.deepEqual(await fs.readdir(directory), ['result.mp4']);
    assert.equal(await fs.readFile(requested, 'utf8'), 'complete');
});

test('unsupported hard links fail before encoding and leave no public or temporary output', async (t) => {
    const {directory, requested} = await fixture(t);
    t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('unsupported'), {code: 'ENOTSUP'}); });
    await assert.rejects(prepareExportOutput(requested), /Output folder filesystem does not support safe no-overwrite export/);
    assert.deepEqual(await fs.readdir(directory), []);
});

test('empty output fails closed and uncertain directory cleanup preserves unrelated entries', async (t) => {
    const {directory, requested} = await fixture(t);
    const output = await prepareExportOutput(requested);
    await assert.rejects(publishExportOutput(output), /Export did not produce a complete file/);
    await fs.rename(output.stagingDirectory, path.join(directory, 'moved-stage'));
    await fs.mkdir(output.stagingDirectory);
    const sentinel = path.join(output.stagingDirectory, 'encoded.mp4');
    await fs.writeFile(sentinel, 'unrelated replacement');
    await assert.rejects(cleanupExportOutput(output), /identity changed; cleanup refused/);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated replacement');
    await assert.rejects(fs.access(requested), {code: 'ENOENT'});
});
