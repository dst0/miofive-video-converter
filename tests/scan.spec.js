// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

test.describe('Scan Functionality Tests', () => {
  let testDir;

  test.beforeEach(async ({ page }) => {
    // Create a temporary test directory with mock video files
    testDir = path.join(os.tmpdir(), `test-videos-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Create mock video files with proper naming convention
    // Format: {MMDDYY}_{HHMMSS}_{MMDDYY}_{HHMMSS}_{dddddd}{C}.MP4
    const mockFiles = [
      '010125_143052_010125_093052_000001A.MP4',
      '010125_143152_010125_093152_000002A.MP4',
      '010125_143252_010125_093252_000003A.MP4',
      '010125_143052_010125_093052_000001B.MP4',
      '010125_143152_010125_093152_000002B.MP4',
    ];
    
    for (const filename of mockFiles) {
      await fs.writeFile(path.join(testDir, filename), 'mock video content');
    }
    
    // Navigate to page - needed because tests modify channel states
    await page.goto('/');
  });

  test.afterEach(async () => {
    // Clean up test directory
    if (testDir) {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to cleanup test directory:', err);
      }
    }
  });

  test('should scan folder and find video files', async ({ page }) => {
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete
    await page.waitForSelector('.results', { timeout: 10000 });
    
    // Check that files were found
    const countDiv = page.locator('.count');
    await expect(countDiv).toBeVisible();
    const countText = await countDiv.textContent();
    expect(countText).toContain('Found');
    expect(countText).toContain('file(s)');
  });

  test('should filter by channel A only', async ({ page }) => {
    
    // Uncheck channel B
    await page.locator('#channelB').uncheck();
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete
    await page.waitForSelector('.results', { timeout: 10000 });
    
    // Check count - should find only A files (3 files)
    const countText = await page.locator('.count').textContent();
    expect(countText).toContain('Found 3 file(s)');
  });

  test('should filter by channel B only', async ({ page }) => {
    
    // Uncheck channel A
    await page.locator('#channelA').uncheck();
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete
    await page.waitForSelector('.results', { timeout: 10000 });
    
    // Check count - should find only B files (2 files)
    const countText = await page.locator('.count').textContent();
    expect(countText).toContain('Found 2 file(s)');
  });

  test('should display file list after scanning', async ({ page }) => {
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for results
    await page.waitForSelector('.file-list', { timeout: 10000 });
    
    // Check file list contains items
    const fileItems = page.locator('.file-item');
    const count = await fileItems.count();
    expect(count).toBeGreaterThan(0);
    
    // Check that each file has a checkbox
    const checkboxes = page.locator('.file-checkbox');
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toEqual(count);
  });

  test('should have all files checked by default after scan', async ({ page }) => {
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for results
    await page.waitForSelector('.file-list', { timeout: 10000 });
    
    // Check that all checkboxes are checked
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('should show timeline after scanning', async ({ page }) => {
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for timeline to appear
    await page.waitForSelector('.timeline-section', { timeout: 10000 });
    
    // Check timeline elements
    await expect(page.locator('.timeline-container')).toBeVisible();
    await expect(page.locator('.timeline-track')).toBeVisible();
    await expect(page.locator('.range-start')).toBeVisible();
    await expect(page.locator('.range-end')).toBeVisible();
  });

  test('should show combine section after scanning', async ({ page }) => {
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for combine section
    await page.waitForSelector('.combine-section', { timeout: 10000 });
    
    // Check combine elements
    await expect(page.locator('#outputPath')).toBeVisible();
    await expect(page.locator('#combineBtn')).toBeVisible();
    await expect(page.locator('#combineBtn')).toHaveText('Combine');
  });

  test('should toggle select all checkbox', async ({ page }) => {
    
    // Set the test folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for results
    await page.waitForSelector('.file-list', { timeout: 10000 });
    
    // Get select all checkbox
    const selectAll = page.locator('#selectAll');
    await expect(selectAll).toBeChecked();
    
    // Uncheck select all
    await selectAll.uncheck();
    
    // Verify all file checkboxes are unchecked
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
    
    // Check select all again
    await selectAll.check();
    
    // Verify all file checkboxes are checked
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('should handle invalid folder path', async ({ page }) => {
    
    // Set an invalid folder path
    await page.locator('#folderPath').fill('/nonexistent/path/that/does/not/exist');
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for error message
    await expect(page.locator('#results .error')).toBeVisible();
    await expect(page.locator('#results .error')).toContainText('Invalid folder path');
  });

  test('should persist folder path in localStorage', async ({ page }) => {
    
    // Set folder path
    await page.locator('#folderPath').fill(testDir);
    
    // Reload page
    await page.reload();
    
    // Check that folder path is still there
    await expect(page.locator('#folderPath')).toHaveValue(testDir);
  });
});
