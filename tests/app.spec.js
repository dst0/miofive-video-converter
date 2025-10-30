// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Application Basic Tests', () => {
  test('should load the homepage with correct title', async ({ page }) => {
    await page.goto('/');
    
    // Check page title
    await expect(page).toHaveTitle(/MP4 Video Combiner/);
    
    // Check main heading is visible
    const heading = page.locator('h1');
    await expect(heading).toHaveText('MP4 Video Combiner');
    
    // Check subtitle
    const subtitle = page.locator('.subtitle');
    await expect(subtitle).toContainText('Scan folders for timestamped videos');
  });

  test('should have all main UI elements visible', async ({ page }) => {
    await page.goto('/');
    
    // Check channel checkboxes
    await expect(page.locator('#channelA')).toBeVisible();
    await expect(page.locator('#channelB')).toBeVisible();
    
    // Check both channels are checked by default
    await expect(page.locator('#channelA')).toBeChecked();
    await expect(page.locator('#channelB')).toBeChecked();
    
    // Check folder input
    await expect(page.locator('#folderPath')).toBeVisible();
    
    // Check browse button
    await expect(page.locator('#browseFolderBtn')).toBeVisible();
    
    // Check scan button
    await expect(page.locator('#scanBtn')).toBeVisible();
    await expect(page.locator('#scanBtn')).toHaveText('Scan');
  });

  test('should check FFmpeg availability', async ({ page }) => {
    // Listen for the API call
    const responsePromise = page.waitForResponse('/check-ffmpeg');
    
    await page.goto('/');
    
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('available');
  });

  test('should show error when scanning without folder path', async ({ page }) => {
    await page.goto('/');
    
    // Clear folder path if any
    await page.locator('#folderPath').clear();
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for error message
    await expect(page.locator('#results .error')).toBeVisible();
    await expect(page.locator('#results .error')).toContainText('Please select a folder');
  });

  test('should show error when no channels are selected', async ({ page }) => {
    await page.goto('/');
    
    // Set a dummy folder path
    await page.locator('#folderPath').fill('/tmp/test');
    
    // Uncheck both channels
    await page.locator('#channelA').uncheck();
    await page.locator('#channelB').uncheck();
    
    // Click scan button
    await page.locator('#scanBtn').click();
    
    // Wait for error message
    await expect(page.locator('#results .error')).toBeVisible();
    await expect(page.locator('#results .error')).toContainText('Select at least one channel');
  });
});

test.describe('Pre-Scan Filters', () => {
  test('should have pre-scan filter controls', async ({ page }) => {
    await page.goto('/');
    
    // Check filter toggle checkbox
    await expect(page.locator('#enablePreScanFilters')).toBeVisible();
    await expect(page.locator('#enablePreScanFilters')).not.toBeChecked();
    
    // Filter controls should be hidden by default
    await expect(page.locator('#preScanFilterControls')).not.toBeVisible();
  });

  test('should show filter controls when enabled', async ({ page }) => {
    await page.goto('/');
    
    // Enable filters
    await page.locator('#enablePreScanFilters').check();
    
    // Filter controls should be visible
    await expect(page.locator('#preScanFilterControls')).toBeVisible();
    
    // Check filter inputs
    await expect(page.locator('#preScanStartTime')).toBeVisible();
    await expect(page.locator('#preScanEndTime')).toBeVisible();
    
    // Check clear buttons
    await expect(page.locator('#clearStartTime')).toBeVisible();
    await expect(page.locator('#clearEndTime')).toBeVisible();
    
    // Check preset buttons
    await expect(page.locator('[data-preset="today"]')).toBeVisible();
    await expect(page.locator('[data-preset="yesterday"]')).toBeVisible();
    await expect(page.locator('[data-preset="last7days"]')).toBeVisible();
  });

  test('should apply date presets correctly', async ({ page }) => {
    await page.goto('/');
    
    // Enable filters
    await page.locator('#enablePreScanFilters').check();
    
    // Click "Today" preset
    await page.locator('[data-preset="today"]').click();
    
    // Check that start and end times are set
    const startTime = await page.locator('#preScanStartTime').inputValue();
    const endTime = await page.locator('#preScanEndTime').inputValue();
    
    expect(startTime).toBeTruthy();
    expect(endTime).toBeTruthy();
    
    // Verify both times contain today's date
    const today = new Date().toISOString().split('T')[0];
    expect(startTime).toContain(today);
    expect(endTime).toContain(today);
  });

  test('should clear filter values with clear buttons', async ({ page }) => {
    await page.goto('/');
    
    // Enable filters and set a preset
    await page.locator('#enablePreScanFilters').check();
    await page.locator('[data-preset="today"]').click();
    
    // Verify values are set
    await expect(page.locator('#preScanStartTime')).not.toHaveValue('');
    
    // Clear start time
    await page.locator('#clearStartTime').click();
    await expect(page.locator('#preScanStartTime')).toHaveValue('');
    
    // Clear end time
    await page.locator('#clearEndTime').click();
    await expect(page.locator('#preScanEndTime')).toHaveValue('');
  });
});
