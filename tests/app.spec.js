// @ts-check
const { test, expect } = require('@playwright/test');
const os = require('os');
const path = require('path');

test.describe('Application Basic Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load homepage with correct structure', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/MP4 Video Combiner/);
    
    // Check main heading is visible
    const heading = page.locator('h1');
    await expect(heading).toHaveText('MP4 Video Combiner');
    
    // Check subtitle
    const subtitle = page.locator('.subtitle');
    await expect(subtitle).toContainText('Scan folders for timestamped videos');
    
    // Check all main UI elements are visible
    await expect(page.locator('#channelA')).toBeVisible();
    await expect(page.locator('#channelB')).toBeVisible();
    await expect(page.locator('#channelA')).toBeChecked();
    await expect(page.locator('#channelB')).toBeChecked();
    await expect(page.locator('#folderPath')).toBeVisible();
    await expect(page.locator('#browseFolderBtn')).toBeVisible();
    await expect(page.locator('#scanBtn')).toBeVisible();
    await expect(page.locator('#scanBtn')).toHaveText('Scan');
  });

  test('should check FFmpeg availability', async ({ page }) => {
    // Listen for the API call
    const responsePromise = page.waitForResponse('/check-ffmpeg');
    
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('available');
  });

  test('should show error when scanning without folder path', async ({ page }) => {
    // folderPath field is readonly and starts empty, so just click scan
    await page.locator('#scanBtn').click();
    
    // Wait for error message
    await expect(page.locator('#results .error')).toBeVisible();
    await expect(page.locator('#results .error')).toContainText('Please select a folder');
  });

  test('should show error when no channels are selected', async ({ page }) => {
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
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should have pre-scan filter controls and toggle visibility', async ({ page }) => {
    // Check filter toggle checkbox is visible and unchecked by default
    await expect(page.locator('#enablePreScanFilters')).toBeVisible();
    await expect(page.locator('#enablePreScanFilters')).not.toBeChecked();
    
    // Filter controls should be hidden by default
    await expect(page.locator('#preScanFilterControls')).not.toBeVisible();
    
    // Enable filters
    await page.locator('#enablePreScanFilters').check();
    
    // Filter controls should now be visible
    await expect(page.locator('#preScanFilterControls')).toBeVisible();
    
    // Check all filter UI elements are present
    await expect(page.locator('#preScanStartTime')).toBeVisible();
    await expect(page.locator('#preScanEndTime')).toBeVisible();
    await expect(page.locator('#clearStartTime')).toBeVisible();
    await expect(page.locator('#clearEndTime')).toBeVisible();
    await expect(page.locator('[data-preset="today"]')).toBeVisible();
    await expect(page.locator('[data-preset="yesterday"]')).toBeVisible();
    await expect(page.locator('[data-preset="last7days"]')).toBeVisible();
  });

  test('should apply date presets and clear filters', async ({ page }) => {
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
    
    // Test clearing filters
    await page.locator('#clearStartTime').click();
    await expect(page.locator('#preScanStartTime')).toHaveValue('');
    
    await page.locator('#clearEndTime').click();
    await expect(page.locator('#preScanEndTime')).toHaveValue('');
  });
});
