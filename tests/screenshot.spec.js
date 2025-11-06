// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Video Player - Screenshot Feature', () => {
  test('should show screenshot button in player controls', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    // Click Play Videos button
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen to be visible
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Check if screenshot button is visible
    await expect(page.locator('#screenshotBtn')).toBeVisible();
    
    // Check button has camera icon
    const buttonText = await page.locator('#screenshotBtn').textContent();
    expect(buttonText).toContain('📷');
    
    // Check button has tooltip
    const tooltip = await page.locator('#screenshotBtn').getAttribute('title');
    expect(tooltip).toContain('Screenshot');
    expect(tooltip).toContain('S');
  });

  test('should download screenshot when clicking screenshot button', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete and click Play Videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    
    // Wait for player to be ready
    await expect(page.locator('#playerScreen')).toBeVisible();
    await page.waitForTimeout(1000); // Wait for video to start loading
    
    // Set up download listener
    const downloadPromise = page.waitForEvent('download');
    
    // Click screenshot button
    await page.locator('#screenshotBtn').click();
    
    // Wait for download
    const download = await downloadPromise;
    
    // Check filename pattern
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^screenshot_.*\.png$/);
    expect(filename).toContain('.png');
  });

  test('should download screenshot when pressing S key', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete and click Play Videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    
    // Wait for player to be ready
    await expect(page.locator('#playerScreen')).toBeVisible();
    await page.waitForTimeout(1000); // Wait for video to start loading
    
    // Set up download listener
    const downloadPromise = page.waitForEvent('download');
    
    // Press 'S' key
    await page.keyboard.press('s');
    
    // Wait for download
    const download = await downloadPromise;
    
    // Check filename pattern
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^screenshot_.*\.png$/);
  });

  test('should show feedback message when screenshot is taken', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete and click Play Videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    
    // Wait for player to be ready
    await expect(page.locator('#playerScreen')).toBeVisible();
    await page.waitForTimeout(1000); // Wait for video to start loading
    
    // Click screenshot button
    await page.locator('#screenshotBtn').click();
    
    // Check for feedback message
    const feedback = page.locator('.screenshot-feedback');
    await expect(feedback).toBeVisible({ timeout: 1000 });
    
    // Check feedback contains success indicator
    const feedbackText = await feedback.textContent();
    expect(feedbackText).toContain('📷');
    expect(feedbackText).toContain('Screenshot saved');
    
    // Feedback should disappear after 2 seconds
    await expect(feedback).not.toBeVisible({ timeout: 3000 });
  });

  test('should not take screenshot when pressing S in input field', async ({ page }) => {
    await page.goto('/');
    
    // Focus on folder path input
    await page.locator('#folderPath').focus();
    
    // Set up download listener that should not trigger
    let downloadTriggered = false;
    page.on('download', () => {
      downloadTriggered = true;
    });
    
    // Type 's' in the input field
    await page.keyboard.press('s');
    
    // Wait a bit to ensure no download is triggered
    await page.waitForTimeout(500);
    
    // Verify no download was triggered
    expect(downloadTriggered).toBe(false);
    
    // Verify 's' was typed in the input
    const inputValue = await page.locator('#folderPath').inputValue();
    expect(inputValue).toContain('s');
  });

  test('should include video name and timestamp in filename', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete and click Play Videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    
    // Wait for player to be ready
    await expect(page.locator('#playerScreen')).toBeVisible();
    await page.waitForTimeout(1000); // Wait for video to start loading
    
    // Get current video name
    const videoNameElement = await page.locator('#currentVideoName').textContent();
    
    // Set up download listener
    const downloadPromise = page.waitForEvent('download');
    
    // Click screenshot button
    await page.locator('#screenshotBtn').click();
    
    // Wait for download
    const download = await downloadPromise;
    
    // Check filename contains video info
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^screenshot_\d{6}_\d{6}_\d{6}_\d{6}_\d{6}[AB]_.*\.png$/);
  });
});
