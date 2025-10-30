// @ts-check
const { test, expect } = require('@playwright/test');
const os = require('os');
const path = require('path');

test.describe('Folder Browser Tests', () => {
  test('should open folder browser modal when clicking browse button', async ({ page }) => {
    await page.goto('/');
    
    // Modal should be hidden initially
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
    
    // Click browse button
    await page.locator('#browseFolderBtn').click();
    
    // Modal should be visible now
    await expect(page.locator('#folderBrowserModal')).toBeVisible();
    
    // Check modal header
    await expect(page.locator('#folderBrowserModal h3')).toHaveText('Select Folder');
    
    // Check modal has folder tree
    await expect(page.locator('#folderTree')).toBeVisible();
    
    // Check buttons
    await expect(page.locator('#selectFolderBtn')).toBeVisible();
    await expect(page.locator('#cancelBrowserBtn')).toBeVisible();
  });

  test('should close modal when clicking cancel button', async ({ page }) => {
    await page.goto('/');
    
    // Open modal
    await page.locator('#browseFolderBtn').click();
    await expect(page.locator('#folderBrowserModal')).toBeVisible();
    
    // Click cancel
    await page.locator('#cancelBrowserBtn').click();
    
    // Modal should be hidden
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
  });

  test('should close modal when clicking X button', async ({ page }) => {
    await page.goto('/');
    
    // Open modal
    await page.locator('#browseFolderBtn').click();
    await expect(page.locator('#folderBrowserModal')).toBeVisible();
    
    // Click close button
    await page.locator('#closeBrowserBtn').click();
    
    // Modal should be hidden
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
  });

  test('should load initial folder locations', async ({ page }) => {
    await page.goto('/');
    
    // Open modal
    await page.locator('#browseFolderBtn').click();
    
    // Wait for folders to load
    await page.waitForTimeout(1000);
    
    // Check that folder tree has content (not just "Loading folders...")
    const folderTree = page.locator('#folderTree');
    const content = await folderTree.textContent();
    
    // Should not show loading message after loading
    expect(content).not.toContain('Loading folders...');
  });

  test('should display current path', async ({ page }) => {
    await page.goto('/');
    
    // Open modal
    await page.locator('#browseFolderBtn').click();
    
    // Wait for current path to load
    await page.waitForTimeout(1000);
    
    // Check current path display exists and has content
    const currentPath = page.locator('#currentPathDisplay');
    await expect(currentPath).toBeVisible();
    
    const pathText = await currentPath.textContent();
    expect(pathText).not.toBe('Loading...');
  });

  test('should preserve selected folder when reopening modal', async ({ page }) => {
    await page.goto('/');
    
    // Manually set a folder path
    const testPath = path.join(os.tmpdir(), 'test');
    await page.locator('#folderPath').fill(testPath);
    
    // Open modal
    await page.locator('#browseFolderBtn').click();
    await expect(page.locator('#folderBrowserModal')).toBeVisible();
    
    // Close modal
    await page.locator('#cancelBrowserBtn').click();
    
    // Verify path is still there
    await expect(page.locator('#folderPath')).toHaveValue(testPath);
  });
});
