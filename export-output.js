const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');

const unsupportedLinkCodes = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);

async function cleanupExportOutput(output) {
    if (!output) return;
    let current;
    try { current = await fs.lstat(output.stagingDirectory); } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    if (!current.isDirectory() || current.dev !== output.identity.dev || current.ino !== output.identity.ino) {
        throw new Error('Export staging directory identity changed; cleanup refused');
    }
    // Only remove our two known entries, never recursively erase an arbitrary
    // output directory. The canonical parent must remain trusted during export.
    for (const name of ['encoded.mp4', '.link-check']) {
        try { await fs.unlink(path.join(output.stagingDirectory, name)); } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    await fs.rmdir(output.stagingDirectory);
}

async function prepareExportOutput(requestedPath) {
    if (typeof requestedPath !== 'string' || !requestedPath.trim()) throw new Error('Output path is required');
    const parsed = path.parse(path.resolve(requestedPath));
    if (parsed.ext.toLowerCase() !== '.mp4') throw new Error('Output filename must use the .mp4 extension');
    const directory = await fs.realpath(parsed.dir);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('Output folder is not a directory');
    const stagingDirectory = await fs.mkdtemp(path.join(directory, '.miofive-export-'));
    const output = {
        stagingDirectory,
        stagingPath: path.join(stagingDirectory, 'encoded.mp4'),
        requestedPath: path.join(directory, parsed.base),
        identity: await fs.lstat(stagingDirectory),
    };
    try {
        const handle = await fs.open(output.stagingPath, 'wx', 0o600);
        await handle.close();
        // Check the selected filesystem before a potentially long transcode.
        // link is atomic and no-clobber; rename/copyFile(EXCL) are not substitutes.
        await fs.link(output.stagingPath, path.join(stagingDirectory, '.link-check'));
        await fs.unlink(path.join(stagingDirectory, '.link-check'));
        return output;
    } catch (error) {
        await cleanupExportOutput(output);
        if (unsupportedLinkCodes.has(error.code)) {
            throw new Error('Output folder filesystem does not support safe no-overwrite export. Choose a folder on a local disk that supports hard links (for example APFS).', {cause: error});
        }
        throw error;
    }
}

async function publishExportOutput(output, signal) {
    // Complete, regular bytes are flushed before making a public name visible.
    const handle = await fs.open(output.stagingPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size === 0) throw new Error('Export did not produce a complete file');
        await handle.sync();
    } finally {
        await handle.close();
    }
    const parsed = path.parse(output.requestedPath);
    for (let counter = 0; counter <= 9999; counter++) {
        signal?.throwIfAborted();
        const candidate = counter === 0 ? output.requestedPath
            : path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`);
        try {
            await fs.link(output.stagingPath, candidate);
            // Publication is the commit point. A subsequent disconnect must not
            // unlink an already completed result, or any replacement of its name.
            return candidate;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
    throw new Error('Too many files with the same name. Please choose a different filename.');
}

module.exports = {prepareExportOutput, publishExportOutput, cleanupExportOutput};
