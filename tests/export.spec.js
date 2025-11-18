/**
 * Tests for Video Player Export Functionality
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs').promises;

const TEST_DATA_PATH = path.join(__dirname, '..', 'test-data', 'Normal');
const TEST_OUTPUT_DIR = path.join(__dirname, '..', 'test-output');

test.describe('Video Player Export Functionality', () => {
    let baseURL;

    test.beforeAll(async () => {
        // Ensure test output directory exists
        try {
            await fs.mkdir(TEST_OUTPUT_DIR, { recursive: true });
        } catch (err) {
            // Directory already exists
        }
    });

    test.beforeEach(async ({ page, baseURL: url }) => {
        baseURL = url || 'http://localhost:3000';
        await page.goto(baseURL);
        await page.waitForLoadState('networkidle');
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
        }, TEST_OUTPUT_DIR);

        // Clear filename
        await page.fill('#exportOutputFilename', '');

        // Click export button
        await page.click('#exportConfirmBtn');

        // Verify error message
        await page.waitForSelector('#exportStatus .error');
        const errorText = await page.locator('#exportStatus .error').textContent();
        expect(errorText).toContain('filename');
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
        }, TEST_OUTPUT_DIR);

        // Set filename
        const testFilename = 'test_export.mp4';
        await page.fill('#exportOutputFilename', testFilename);

        // Click export button
        await page.click('#exportConfirmBtn');

        // Wait for modal to close and snackbar to appear
        await page.waitForSelector('#exportModal', { state: 'hidden', timeout: 5000 });
        await page.waitForSelector('#snackbar.show.success', { timeout: 30000 });
        const snackbarText = await page.locator('#snackbar').textContent();
        expect(snackbarText).toContain('Export successful');

        // Verify file was created
        const outputPath = path.join(TEST_OUTPUT_DIR, testFilename);
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
        }, TEST_OUTPUT_DIR);

        // Set filename
        await page.fill('#exportOutputFilename', 'test_export_localStorage.mp4');

        // Click export button
        await page.click('#exportConfirmBtn');

        // Wait for modal to close and snackbar to appear
        await page.waitForSelector('#exportModal', { state: 'hidden', timeout: 5000 });
        await page.waitForSelector('#snackbar.show.success', { timeout: 30000 });

        // Verify localStorage was updated
        const savedFolder = await page.evaluate(() => {
            return localStorage.getItem('mp4-combiner-output-folder');
        });
        expect(savedFolder).toBe(TEST_OUTPUT_DIR);

        // Clean up
        const outputPath = path.join(TEST_OUTPUT_DIR, 'test_export_localStorage.mp4');
        await fs.unlink(outputPath).catch(() => {});
    });
});
