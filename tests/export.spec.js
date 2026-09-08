/**
 * Tests for Video Player Export Functionality
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const TEST_DATA_PATH = path.join(__dirname, '..', 'test-data', 'Normal');

test.describe('Video Player Export Functionality', () => {
    let baseURL;
    let testOutputDir;

    test.beforeEach(async ({ page, baseURL: url }) => {
        testOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-ui-export-'));
        baseURL = url || 'http://localhost:3000';
        await page.goto(baseURL);
        await page.waitForLoadState('networkidle');
    });

    test.afterEach(async () => {
        if (testOutputDir) {
            await fs.rm(testOutputDir, { recursive: true, force: true });
            testOutputDir = undefined;
        }
    });

    test('should show export button in player screen', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Verify export button exists
        const exportBtn = await page.locator('#exportVideosBtn');
        await expect(exportBtn).toBeVisible();
        await expect(exportBtn).toHaveText('💾 Export Videos');
    });

    test('should open export modal when export button is clicked', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');

        // Verify modal is visible
        const modal = await page.locator('#exportModal');
        await expect(modal).toBeVisible();

        // Verify modal title
        await expect(page.locator('#exportModal h3')).toHaveText('Export Videos');
    });

    test('should display video count and total duration in export modal', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Check video count (should be 10 videos in test data)
        const videoCount = await page.locator('#exportVideoCount').textContent();
        expect(parseInt(videoCount)).toBeGreaterThan(0);

        // Check total duration is displayed
        const totalDuration = await page.locator('#exportTotalDuration').textContent();
        expect(totalDuration).toMatch(/\d{2}:\d{2}/);
    });

    test('should show precise range, speed, quality, and estimate controls', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await expect(page.locator('#exportRangeStart')).toHaveValue('00:00.000');
        await expect(page.locator('#exportRangeEnd')).toHaveValue('00:20.000');
        await expect(page.locator('#exportSpeed')).toHaveValue('1');
        await expect(page.locator('#exportQuality')).toHaveValue('max');
        await expect(page.locator('#exportSelectedDuration')).toHaveText('00:20.000');
        await expect(page.locator('#exportOutputDuration')).toHaveText('00:20.000');
        await expect(page.locator('#exportProcessingEstimate')).toContainText('~');
    });

    test('should use selected scan timeline range when opening export from playback', async ({ page }) => {
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });
        await page.waitForFunction(() => document.getElementById('manualStartTime')?.value);

        await page.evaluate(() => {
            const startInput = document.getElementById('manualStartTime');
            const endInput = document.getElementById('manualEndTime');
            const startDate = new Date(startInput.value);
            const endDate = new Date(startDate.getTime() + 1000);
            const pad = (value, length = 2) => String(value).padStart(length, '0');
            endInput.value =
                `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}` +
                `T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}.` +
                pad(endDate.getMilliseconds(), 3);
            endInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect(page.locator('.count')).toContainText('1 in selected range');

        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await expect(page.locator('#exportRangeStart')).toHaveValue('00:00.000');
        await expect(page.locator('#exportRangeEnd')).toHaveValue('00:01.000');
        await expect(page.locator('#exportSelectedDuration')).toHaveText('00:01.000');
    });

    test('should keep adjusted export range when export modal is reopened', async ({ page }) => {
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await page.fill('#exportRangeStart', '00:03.000');
        await page.fill('#exportRangeEnd', '00:07.000');
        await expect(page.locator('#exportSelectedDuration')).toHaveText('00:04.000');

        await page.click('#exportCancelBtn');
        await expect(page.locator('#exportModal')).toBeHidden();

        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await expect(page.locator('#exportRangeStart')).toHaveValue('00:03.000');
        await expect(page.locator('#exportRangeEnd')).toHaveValue('00:07.000');
        await expect(page.locator('#exportSelectedDuration')).toHaveText('00:04.000');
    });

    test('should send millisecond precise export range values', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await page.evaluate((outputDir) => {
            document.getElementById('exportOutputFolder').value = outputDir;
        }, testOutputDir);
        await page.fill('#exportOutputFilename', 'millisecond_range.mp4');
        await page.fill('#exportRangeStart', '00:00.500');
        await page.fill('#exportRangeEnd', '00:02.250');

        await page.route('**/export', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    output: path.join(testOutputDir, 'millisecond_range.mp4'),
                    details: {
                        rangeStart: 0.5,
                        rangeEnd: 2.25,
                        selectedDuration: 1.75,
                    },
                }),
            });
        });

        const requestPromise = page.waitForRequest((request) =>
            request.url().endsWith('/export') && request.method() === 'POST'
        );

        await page.click('#exportConfirmBtn');
        const request = await requestPromise;
        const body = request.postDataJSON();

        expect(body.rangeStart).toBe(0.5);
        expect(body.rangeEnd).toBe(2.25);
        expect(body.speed).toBe(1);
        expect(body.quality).toBe('max');
        expect(body.outputFolder).toBe(testOutputDir);
        expect(body.outputFilename).toBe('millisecond_range.mp4');
        expect(body.outputPath).toBeUndefined();
    });

    test('should have output folder and filename inputs', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Verify folder input exists
        const folderInput = await page.locator('#exportOutputFolder');
        await expect(folderInput).toBeVisible();

        // Verify filename input exists
        const filenameInput = await page.locator('#exportOutputFilename');
        await expect(filenameInput).toBeVisible();

        // Verify default filename is generated
        const filename = await filenameInput.inputValue();
        expect(filename).toMatch(/^exported_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.mp4$/);
    });

    test('should have browse button for folder selection', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Verify browse button exists
        const browseBtn = await page.locator('#exportBrowseFolderBtn');
        await expect(browseBtn).toBeVisible();
        await expect(browseBtn).toHaveText('Browse');
    });

    test('should close modal when cancel button is clicked', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Click cancel button
        await page.click('#exportCancelBtn');

        // Verify modal is hidden
        const modal = await page.locator('#exportModal');
        await expect(modal).not.toBeVisible();
    });

    test('should close modal when close button (×) is clicked', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Click close button
        await page.click('#closeExportModalBtn');

        // Verify modal is hidden
        const modal = await page.locator('#exportModal');
        await expect(modal).not.toBeVisible();
    });

    test('should show error when exporting without output folder', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Clear output folder if any using JavaScript
        await page.evaluate(() => {
            document.getElementById('exportOutputFolder').value = '';
        });

        // Click export button
        await page.click('#exportConfirmBtn');

        // Verify error message
        await page.waitForSelector('#exportStatus .error');
        const errorText = await page.locator('#exportStatus .error').textContent();
        expect(errorText).toContain('output folder');
    });

    test('should show error when exporting without filename', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Set output folder
        await page.evaluate((outputDir) => {
            document.getElementById('exportOutputFolder').value = outputDir;
        }, testOutputDir);

        // Clear filename
        await page.fill('#exportOutputFilename', '');

        // Click export button
        await page.click('#exportConfirmBtn');

        // Verify error message
        await page.waitForSelector('#exportStatus .error');
        const errorText = await page.locator('#exportStatus .error').textContent();
        expect(errorText).toContain('filename');
    });

    test('should reject folder traversal in the filename field', async ({page}) => {
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', {timeout: 10000});
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', {state: 'visible', timeout: 5000});
        await page.click('#exportVideosBtn');
        await page.evaluate((outputDir) => {
            document.getElementById('exportOutputFolder').value = outputDir;
        }, testOutputDir);
        await page.fill('#exportOutputFilename', '../outside.mp4');
        await page.click('#exportConfirmBtn');

        await expect(page.locator('#exportStatus .error')).toContainText('plain filename');
        await expect(page.locator('#exportConfirmBtn')).toBeEnabled();
    });

    test('should validate export range before sending request', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        await page.evaluate((outputDir) => {
            document.getElementById('exportOutputFolder').value = outputDir;
        }, testOutputDir);
        await page.fill('#exportOutputFilename', 'invalid_range.mp4');
        await page.fill('#exportRangeStart', '00:10');
        await page.fill('#exportRangeEnd', '00:05');
        await page.click('#exportConfirmBtn');

        await page.waitForSelector('#exportStatus .error');
        const errorText = await page.locator('#exportStatus .error').textContent();
        expect(errorText).toContain('End time must be after start time');
    });

    test('should successfully export videos', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Set output folder
        await page.evaluate((outputDir) => {
            document.getElementById('exportOutputFolder').value = outputDir;
        }, testOutputDir);

        // Set filename
        const testFilename = 'test_export.mp4';
        await page.fill('#exportOutputFilename', testFilename);

        // Click export button
        await page.click('#exportConfirmBtn');

        // Wait for modal to close and snackbar to appear
        await page.waitForSelector('#exportModal', { state: 'hidden', timeout: 30000 });
        await page.waitForSelector('#snackbar.show.success', { timeout: 30000 });
        const snackbarText = await page.locator('#snackbar').textContent();
        expect(snackbarText).toContain('Export successful');

        // Verify file was created
        const outputPath = path.join(testOutputDir, testFilename);
        const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
        expect(fileExists).toBeTruthy();

        // Clean up
        if (fileExists) {
            await fs.unlink(outputPath).catch(() => {});
        }
    });

    test('should save output folder to localStorage', async ({ page }) => {
        // Scan for videos
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });

        // Click Play Videos
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });

        // Click export button
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Set output folder
        await page.evaluate((outputDir) => {
            document.getElementById('exportOutputFolder').value = outputDir;
        }, testOutputDir);

        // Set filename
        await page.fill('#exportOutputFilename', 'test_export_localStorage.mp4');

        // Click export button
        await page.click('#exportConfirmBtn');

        // Wait for modal to close and snackbar to appear
        await page.waitForSelector('#exportModal', { state: 'hidden', timeout: 30000 });
        await page.waitForSelector('#snackbar.show.success', { timeout: 30000 });

        // Verify localStorage was updated
        const savedFolder = await page.evaluate(() => {
            return localStorage.getItem('mp4-combiner-output-folder');
        });
        expect(savedFolder).toBe(testOutputDir);

        // Clean up
        const outputPath = path.join(testOutputDir, 'test_export_localStorage.mp4');
        await fs.unlink(outputPath).catch(() => {});
    });
});
