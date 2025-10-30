// @ts-check
const { test, expect } = require('@playwright/test');
const os = require('os');
const path = require('path');

test.describe('Folder Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should open and close folder browser modal', async ({ page }) => {
    // Modal should be hidden initially
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
    
    // Click browse button to open modal
    await page.locator('#browseFolderBtn').click();
    
    // Modal should be visible with correct structure
    await expect(page.locator('#folderBrowserModal')).toBeVisible();
    await expect(page.locator('#folderBrowserModal h3')).toHaveText('Select Folder');
    await expect(page.locator('#folderTree')).toBeVisible();
    await expect(page.locator('#selectFolderBtn')).toBeVisible();
    await expect(page.locator('#cancelBrowserBtn')).toBeVisible();
    
    // Test closing with cancel button
    await page.locator('#cancelBrowserBtn').click();
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
    
    // Open again to test X button
    await page.locator('#browseFolderBtn').click();
    await expect(page.locator('#folderBrowserModal')).toBeVisible();
    
    // Test closing with X button
    await page.locator('#closeBrowserBtn').click();
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
  });

  test('should load folder locations and display current path', async ({ page }) => {
    // Open modal
    await page.locator('#browseFolderBtn').click();
    
    // Wait for folders to load by checking folder tree content
    const folderTree = page.locator('#folderTree');
    await expect(folderTree).not.toContainText('Loading folders...');
    
    // Verify folder tree has actual content
    const content = await folderTree.textContent();
    expect(content).not.toContain('Loading folders...');
    
    // Check current path display is loaded
    const currentPath = page.locator('#currentPathDisplay');
    await expect(currentPath).toBeVisible();
    await expect(currentPath).not.toHaveText('Loading...');
    
    const pathText = await currentPath.textContent();
    expect(pathText).not.toBe('Loading...');
  });
});
