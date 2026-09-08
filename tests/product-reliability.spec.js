const {test, expect} = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const http = require('node:http');

const mediaPath = path.join(__dirname, '..', 'test-data', 'Normal');
const sample = {
    filename: '010125_100000_010125_050000_000001A.MP4',
    path: '/synthetic/000001A.MP4', utcTime: '2025-01-01T10:00:00.000Z', duration: 2, fileType: 'Normal',
};

test('a playlist disguised as MP4 cannot make the media tools fetch network content', async ({request}) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-network-boundary-'));
    let fetched = 0;
    const trap = http.createServer((_req, res) => { fetched++; res.writeHead(404); res.end(); });
    await new Promise((resolve) => trap.listen(0, '127.0.0.1', resolve));
    try {
        const input = path.join(directory, '010125_100000_010125_050000_000001A.MP4');
        await fs.writeFile(input, `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttp://127.0.0.1:${trap.address().port}/segment.ts\n#EXT-X-ENDLIST\n`);
        const response = await request.post('/export', {data: {files: [input], outputFolder: directory, outputFilename: 'result.mp4'}});
        expect(response.ok()).toBe(false);
        expect(fetched).toBe(0);
        expect(await fs.readdir(directory)).toEqual([path.basename(input)]);
    } finally {
        await new Promise((resolve) => trap.close(resolve));
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('privacy-blocked storage does not prevent scan, folder selection or successful export feedback', async ({page}) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('Storage is disabled', 'SecurityError'); }});
    });
    await page.route('**/export', (route) => route.fulfill({json: {success: true, output: '/synthetic-output/verified.mp4'}}));
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();
    await page.locator('#exportSelectedBtn').click();
    await page.locator('#exportOutputFolder').fill(mediaPath);
    await page.locator('#exportBrowseFolderBtn').click();
    await expect(page.locator('#selectFolderBtn')).toBeEnabled();
    await page.locator('#selectFolderBtn').click();
    await expect(page.locator('#folderBrowserModal')).toBeHidden();
    await page.locator('#exportConfirmBtn').click();
    await expect(page.locator('#snackbar')).toContainText('Export successful');
    await expect(page.locator('#exportModal')).toBeHidden();
    expect(pageErrors).toEqual([]);
});

test('unknown durations cannot silently become a short exact export', async ({page}) => {
    await page.route('**/scan', (route) => route.fulfill({json: {files: [{...sample, duration: null}], count: 1}}));
    await page.route('**/video?*', (route) => route.abort());
    let exports = 0;
    await page.route('**/export', (route) => { exports++; return route.abort(); });
    await page.goto('/');
    await page.locator('#folderPath').fill('/synthetic');
    await page.locator('#scanBtn').click();
    await page.locator('#exportSelectedBtn').click();
    await page.locator('#exportOutputFolder').fill('/synthetic-output');
    await page.locator('#exportConfirmBtn').click();
    await expect(page.locator('#exportStatus')).toContainText('durations are unavailable');
    expect(exports).toBe(0);
});

test('late media metadata cannot authorize a range built from incomplete scan durations', async ({page}) => {
    const files = [
        {...sample, duration: null},
        {...sample, path: '/synthetic/000002A.MP4', utcTime: '2025-01-01T10:01:00.000Z', duration: 60},
    ];
    await page.route('**/scan', (route) => route.fulfill({json: {files, count: files.length}}));
    let release;
    const metadataAllowed = new Promise((resolve) => { release = resolve; });
    await page.route('**/video?*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('path') !== sample.path) return route.abort();
        await metadataAllowed;
        await route.fulfill({path: path.join(mediaPath, sample.filename), contentType: 'video/mp4'});
    });
    let exports = 0;
    await page.route('**/export', (route) => { exports++; return route.abort(); });
    try {
        await page.goto('/');
        await page.locator('#folderPath').fill('/synthetic');
        await page.locator('#scanBtn').click();
        await page.locator('#exportSelectedBtn').click();
        await expect(page.locator('#exportRangeEnd')).toHaveValue('01:00.000');
        release();
        await expect.poll(() => page.locator('video.active-player').evaluate((video) => video.duration)).toBeGreaterThan(0);
        await expect(page.locator('#exportTotalDuration')).not.toHaveText('01:00.000');
        await page.locator('#exportOutputFolder').fill('/synthetic-output');
        await page.locator('#exportConfirmBtn').click();
        await expect(page.locator('#exportStatus')).toContainText('durations are unavailable');
        expect(exports).toBe(0);
    } finally {
        release();
    }
});

for (const cancelAction of ['cancel', 'toggle filters', 'preset', 'clear']) {
    test(`${cancelAction} invalidates the in-flight scan response`, async ({page}) => {
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        let scanStarted;
        const started = new Promise((resolve) => { scanStarted = resolve; });
        await page.route('**/scan', async (route) => {
            scanStarted();
            await held;
            await route.fulfill({json: {files: [sample], count: 1}}).catch(() => {});
        });
        await page.goto('/');
        await page.locator('#enablePreScanFilters').check();
        await page.locator('#folderPath').fill('/synthetic');
        await page.locator('#scanBtn').click();
        await started;
        await expect(page.locator('#cancelScanBtn')).toBeVisible();
        if (cancelAction === 'cancel') await page.locator('#cancelScanBtn').click();
        if (cancelAction === 'toggle filters') await page.locator('#enablePreScanFilters').uncheck();
        if (cancelAction === 'preset') await page.locator('[data-preset="today"]').click();
        if (cancelAction === 'clear') await page.locator('#clearStartTime').click();
        release();
        await expect(page.locator('#scanBtn')).toBeEnabled();
        await expect(page.locator('#cancelScanBtn')).toBeHidden();
        await expect(page.locator('#results')).toBeEmpty();
    });
}

test('folder browser supports keyboard navigation and restores focus', async ({page}) => {
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#browseFolderBtn').click();
    await expect(page.getByRole('dialog', {name: 'Select Folder'})).toBeVisible();
    await expect(page.locator('#closeBrowserBtn')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#cancelBrowserBtn')).toBeFocused();
    const parent = page.locator('#folderTree .parent-folder');
    await expect(parent).toBeVisible();
    await parent.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#currentPathDisplay')).toHaveText(path.dirname(mediaPath));
    await page.keyboard.press('Escape');
    await expect(page.locator('#folderBrowserModal')).toBeHidden();
    await expect(page.locator('#browseFolderBtn')).toBeFocused();
});

test('folder and export panels share one native modal boundary and retain form state and focus', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('dialog:modal')).toHaveCount(0);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await page.locator('#exportSelectedBtn').click();
    await page.locator('#exportOutputFolder').fill(mediaPath);
    await page.locator('#exportOutputFilename').fill('retained-name.mp4');
    await page.locator('#exportBrowseFolderBtn').click();
    await expect(page.getByRole('dialog', {name: 'Select Folder'})).toBeVisible();
    await expect(page.locator('#productDialog')).toHaveJSProperty('open', true);
    await expect(page.locator('dialog:modal')).toHaveCount(1);
    await expect(page.locator('dialog')).toHaveCount(1);
    await expect(page.locator('#exportModal')).toHaveJSProperty('inert', true);
    await expect(page.locator('#exportModal')).toBeHidden();
    await expect(page.locator('#exportModal')).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#cancelBrowserBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#folderBrowserModal')).toBeHidden();
    await expect(page.getByRole('dialog', {name: 'Export Videos'})).toBeVisible();
    await expect(page.locator('#exportModal')).toHaveJSProperty('inert', false);
    await expect(page.locator('#productDialog')).toHaveJSProperty('open', true);
    await expect(page.locator('#exportOutputFilename')).toHaveValue('retained-name.mp4');
    await expect(page.locator('#exportBrowseFolderBtn')).toBeFocused();
    await page.locator('#exportBrowseFolderBtn').click();
    await page.locator('#selectFolderBtn').click();
    await expect(page.locator('#folderBrowserModal')).toBeHidden();
    await expect(page.getByRole('dialog', {name: 'Export Videos'})).toBeVisible();
    await expect(page.locator('#exportBrowseFolderBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#productDialog')).toHaveJSProperty('open', false);
    await expect(page.locator('dialog:modal')).toHaveCount(0);
});

test('native cancel closes only the active panel and then its parent', async ({page}) => {
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await page.locator('#exportSelectedBtn').click();
    await page.locator('#exportBrowseFolderBtn').click();
    await page.locator('#productDialog').dispatchEvent('cancel', {cancelable: true});
    await expect(page.getByRole('dialog', {name: 'Export Videos'})).toBeVisible();
    await expect(page.locator('#exportBrowseFolderBtn')).toBeFocused();
    await page.locator('#productDialog').dispatchEvent('cancel', {cancelable: true});
    await expect(page.locator('#productDialog')).toBeHidden();
    await expect(page.locator('#productDialog')).toHaveJSProperty('open', false);
});

test('closing an inactive export panel cannot resurrect it or close the folder panel', async ({page}) => {
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await page.locator('#exportSelectedBtn').click();
    await page.locator('#exportBrowseFolderBtn').click();
    // Exercise a lifecycle close, not a pointer click through the inert panel.
    await page.locator('#closeExportModalBtn').evaluate((button) => button.click());
    await expect(page.getByRole('dialog', {name: 'Select Folder'})).toBeVisible();
    await page.locator('#cancelBrowserBtn').click();
    await expect(page.locator('#productDialog')).toBeHidden();
    await expect(page.locator('#productDialog')).toHaveJSProperty('open', false);
    await expect(page.locator('#exportModal')).toBeHidden();
    await expect(page.locator('#videoWrapper')).toBeFocused();
    await page.locator('#exportVideosBtn').click();
    await expect(page.getByRole('dialog', {name: 'Export Videos'})).toBeVisible();
});

test('older-webview dialog fallback retains keyboard cancellation and focus', async ({page}) => {
    await page.addInitScript(() => {
        HTMLDialogElement.prototype.showModal = undefined;
        HTMLDialogElement.prototype.close = undefined;
    });
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#browseFolderBtn').click();
    await expect(page.getByRole('dialog', {name: 'Select Folder'})).toBeVisible();
    await expect(page.locator('#productDialog')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#productDialog')).toHaveAttribute('role', 'dialog');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#cancelBrowserBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#productDialog')).toBeHidden();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await expect(page.locator('#browseFolderBtn')).toBeFocused();
});

for (const outcome of ['success', 'error']) {
    test(`an in-flight export freezes settings and releases them after ${outcome}`, async ({page}) => {
        let release;
        const completed = new Promise((resolve) => { release = resolve; });
        await page.route('**/export', async (route) => {
            await completed;
            await route.fulfill(outcome === 'success'
                ? {json: {success: true, output: '/synthetic-output/result.mp4'}}
                : {status: 500, json: {error: 'Synthetic export failure'}});
        });
        try {
            await page.goto('/');
            await page.locator('#folderPath').fill(mediaPath);
            await page.locator('#scanBtn').click();
            await page.locator('#exportSelectedBtn').click();
            await page.locator('#exportOutputFolder').fill('/synthetic-output');
            await page.locator('#exportConfirmBtn').click();
            for (const id of ['exportBrowseFolderBtn', 'exportOutputFolder', 'exportOutputFilename', 'exportRangeStart', 'exportRangeEnd', 'exportSetStartBtn', 'exportSetEndBtn', 'exportSpeed', 'exportQuality']) {
                await expect(page.locator(`#${id}`)).toBeDisabled();
            }
            await expect(page.locator('#exportCancelBtn')).toBeEnabled();
            await expect(page.locator('#exportCancelBtn')).toBeFocused();
            await expect(page.locator('#folderBrowserModal')).toBeHidden();
            release();
            if (outcome === 'success') {
                await expect(page.locator('#exportModal')).toBeHidden();
                await page.locator('#exportVideosBtn').click();
            } else {
                await expect(page.locator('#exportStatus')).toContainText('Synthetic export failure');
            }
            await expect(page.locator('#exportBrowseFolderBtn')).toBeEnabled();
            await expect(page.locator('#exportOutputFolder')).toBeEnabled();
            await expect(page.locator('#exportConfirmBtn')).toBeEnabled();
        } finally {
            release();
        }
    });
}

test('discovered recording media is not silently selected as an export destination', async ({page}) => {
    await page.route('**/demo-mode', (route) => route.fulfill({json: {enabled: false, removableDevices: [
        {mountPoint: '/synthetic-card', documentsVideoPath: '/synthetic-card/Documents/Video', sizeBytes: 1000},
    ]}}));
    await page.route('**/scan', (route) => route.fulfill({json: {files: [sample], count: 1}}));
    await page.route('**/video?*', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#folderPath')).toHaveValue('/synthetic-card');
    await page.locator('#scanBtn').click();
    await page.locator('#exportSelectedBtn').click();
    await expect(page.locator('#exportOutputFolder')).toHaveValue('');
});

test('Unix folder names containing a backslash keep their literal parent path', async ({page}) => {
    test.skip(process.platform === 'win32');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-literal-path-'));
    const parent = path.join(directory, 'recordings\\literal');
    const child = path.join(parent, 'clips');
    await fs.mkdir(child, {recursive: true});
    try {
        await page.goto('/');
        await page.locator('#folderPath').fill(child);
        await page.locator('#browseFolderBtn').click();
        const parentItem = page.locator('#folderTree .parent-folder');
        await expect(parentItem).toHaveAttribute('data-path', parent);
        await parentItem.click();
        await expect(page.locator('#currentPathDisplay')).toHaveText(parent);
        await expect(page.locator('#folderTree .folder-name').filter({hasText: /^clips$/})).toBeVisible();
    } finally {
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('scrubbing to viewport x=0 seeks to the start without an invalid media time', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    const progress = page.locator('#progressBarContainer');
    await progress.dispatchEvent('mousedown', {clientX: 200, clientY: 100, button: 0});
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', {clientX: 0, clientY: 100, bubbles: true})));
    await expect.poll(() => page.locator('video.active-player').evaluate((video) => video.currentTime)).toBeLessThan(0.1);
    expect(errors).toEqual([]);
});
