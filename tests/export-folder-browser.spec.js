/**
 * Tests for Export Folder Browser Functionality
 * 
 * Regression tests for competing export/folder modal boundaries
 * and end-to-end flow tests for the export browse button.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs').promises;

const TEST_DATA_PATH = path.join(__dirname, '..', 'test-data', 'Normal');
const TEST_OUTPUT_DIR = path.join(__dirname, '..', 'test-output');

test.describe('Export Modal - Folder Browser Integration', () => {
    test.beforeAll(async () => {
        try {
            await fs.mkdir(TEST_OUTPUT_DIR, { recursive: true });
        } catch (err) {
            // Directory already exists
        }
    });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    /**
     * Helper: Navigate to player screen with export modal open
     */
    async function openExportModal(page) {
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#scanBtn');
        await page.waitForSelector('.file-list', { timeout: 10000 });
        await page.click('#playVideosBtn');
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });
    }

    test('should show browse button in export output folder section', async ({ page }) => {
        await openExportModal(page);

        // Verify the browse button exists in the export dialog
        const browseBtn = page.locator('#exportBrowseFolderBtn');
        await expect(browseBtn).toBeVisible();
        await expect(browseBtn).toHaveText('Browse');
    });

    test('should open folder browser modal when export browse button is clicked', async ({ page }) => {
        await openExportModal(page);

        // Both modals should be in the expected initial state
        await expect(page.locator('#exportModal')).toBeVisible();
        await expect(page.locator('#folderBrowserModal')).not.toBeVisible();

        // Click the browse button in export dialog
        await page.click('#exportBrowseFolderBtn');

        // Folder browser modal should now be visible (regression: z-index was wrong before)
        await page.waitForSelector('#folderBrowserModal', { state: 'visible', timeout: 5000 });

        // Retain the form without exposing a second active modal panel.
        await expect(page.locator('#exportModal')).toBeAttached();
        await expect(page.locator('#exportModal')).toBeHidden();
    });

    test('should allow navigating up from a folder with no subdirectories', async ({ page }) => {
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#browseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible', timeout: 5000 });

        await expect(page.locator('#folderTree .empty-folder-message')).toContainText('No subdirectories found');
        const parentFolder = page.locator('#folderTree .parent-folder');
        await expect(parentFolder).toBeVisible();

        await parentFolder.click();

        await expect(page.locator('#currentPathDisplay')).toHaveText(path.dirname(TEST_DATA_PATH));
        await expect(page.locator('#folderTree .folder-item').filter({ hasText: path.basename(TEST_DATA_PATH) })).toBeVisible();
    });

    test('folder browser owns the shared modal while the export panel is inactive', async ({ page }) => {
        await openExportModal(page);
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible', timeout: 5000 });

        await expect(page.getByRole('dialog', { name: 'Select Folder' })).toBeVisible();
        await expect(page.locator('dialog:modal')).toHaveCount(1);
        await expect(page.locator('#exportModal')).toBeHidden();
        await expect(page.locator('#exportModal')).toHaveJSProperty('inert', true);
        await expect(page.locator('#closeBrowserBtn')).toBeFocused();
    });

    test('should populate export output folder after selecting a folder in browser', async ({ page }) => {
        await openExportModal(page);

        // Get initial value (may be pre-populated from removable device detection)
        const exportOutputFolder = page.locator('#exportOutputFolder');
        const initialValue = await exportOutputFolder.inputValue();

        // Open folder browser
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible', timeout: 5000 });

        // Wait for folder tree to load and populate
        await expect(page.locator('#folderTree').locator('.folder-item').first()).toBeVisible({ timeout: 10000 });

        // Look for a folder to navigate to
        const folders = page.locator('#folderTree').locator('.folder-item');
        const folderCount = await folders.count();
        expect(folderCount).toBeGreaterThan(0);

        // Select the first available folder
        await folders.first().click();

        // Click select button
        await page.click('#selectFolderBtn');

        // Folder browser should close
        await page.waitForSelector('#folderBrowserModal', { state: 'hidden' });

        // Export output folder should now be populated with the selected path
        const selectedPath = await exportOutputFolder.inputValue();
        expect(selectedPath).not.toBe('');
        expect(selectedPath).toContain('/');
        // Should be different from initial (unless user selects same folder)
        if (initialValue === '') {
            // Was empty, now should have value
            expect(selectedPath).not.toBe('');
        }
    });

    test('export browse should start from the export output folder', async ({ page }) => {
        await openExportModal(page);
        await page.evaluate((dir) => {
            document.getElementById('exportOutputFolder').value = dir;
        }, TEST_OUTPUT_DIR);
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });
        await expect(page.locator('#currentPathDisplay')).toHaveText(TEST_OUTPUT_DIR);
    });

    test('cancelling export browse resets the next browser to scan purpose', async ({ page }) => {
        await openExportModal(page);
        await page.evaluate((dir) => {
            document.getElementById('exportOutputFolder').value = dir;
        }, TEST_OUTPUT_DIR);
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });
        await page.click('#cancelBrowserBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'hidden' });
        await page.click('#exportCancelBtn');
        await page.click('#backBtn');
        await page.fill('#folderPath', TEST_DATA_PATH);
        await page.click('#browseFolderBtn');
        await expect(page.locator('#currentPathDisplay')).toHaveText(TEST_DATA_PATH);
    });

    test('should close export modal with Escape without opening folder browser', async ({ page }) => {
        await openExportModal(page);

        // Press Escape to close
        await page.keyboard.press('Escape');

        // Export modal should be hidden
        await expect(page.locator('#exportModal')).toBeHidden();
        
        // Folder browser should NOT be open
        await expect(page.locator('#folderBrowserModal')).toBeHidden();
    });

    test('full export flow: browse folder → select range → verify export button state', async ({ page }) => {
        await openExportModal(page);

        // Set export range
        await page.fill('#exportRangeStart', '00:00.000');
        await page.fill('#exportRangeEnd', '00:03.000');

        // Browse for output folder
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible', timeout: 5000 });
        
        // Select first folder
        const folders = page.locator('#folderTree').locator('.folder-item');
        await folders.first().click();
        await page.click('#selectFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'hidden' });

        // Verify output folder is populated
        const outputPath = await page.locator('#exportOutputFolder').inputValue();
        expect(outputPath).not.toBe('');

        // Set output filename
        await page.fill('#exportOutputFilename', 'test_export.mp4');

        // Verify export confirm button is enabled
        const exportBtn = page.locator('#exportConfirmBtn');
        await expect(exportBtn).toBeEnabled();
        await expect(exportBtn).toHaveText('Export');
    });

    test('cancel folder browser should not change export output folder', async ({ page }) => {
        await openExportModal(page);

        // Set a value first
        await page.evaluate((dir) => {
            document.getElementById('exportOutputFolder').value = dir;
        }, TEST_OUTPUT_DIR);
        const initialValue = await page.locator('#exportOutputFolder').inputValue();

        // Open and cancel folder browser
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });
        await page.click('#cancelBrowserBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'hidden' });

        // Value should be unchanged
        const finalValue = await page.locator('#exportOutputFolder').inputValue();
        expect(finalValue).toBe(initialValue);
    });

    test('close folder browser with X should not change export output folder', async ({ page }) => {
        await openExportModal(page);
        await page.evaluate((dir) => {
            document.getElementById('exportOutputFolder').value = dir;
        }, TEST_OUTPUT_DIR);
        const initialValue = await page.locator('#exportOutputFolder').inputValue();

        // Open and close with X
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible' });
        await page.click('#closeBrowserBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'hidden' });

        // Value should be unchanged
        const finalValue = await page.locator('#exportOutputFolder').inputValue();
        expect(finalValue).toBe(initialValue);
    });

    test('reopening export modal should preserve output folder selection', async ({ page }) => {
        await openExportModal(page);

        // Browse and select a folder
        await page.click('#exportBrowseFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'visible', timeout: 5000 });
        const folders = page.locator('#folderTree').locator('.folder-item');
        await folders.first().click();
        await page.click('#selectFolderBtn');
        await page.waitForSelector('#folderBrowserModal', { state: 'hidden' });

        const selectedPath = await page.locator('#exportOutputFolder').inputValue();
        expect(selectedPath).not.toBe('');

        // Close and reopen export modal
        await page.click('#exportCancelBtn');
        await page.waitForSelector('#exportModal', { state: 'hidden' });
        await page.click('#exportVideosBtn');
        await page.waitForSelector('#exportModal', { state: 'visible' });

        // Path should be preserved
        const preservedPath = await page.locator('#exportOutputFolder').inputValue();
        expect(preservedPath).toBe(selectedPath);
    });
});
