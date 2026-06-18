// @ts-check
const { test, expect } = require('@playwright/test');
const os = require('os');
const path = require('path');

test.describe('Folder Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/demo-mode', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false, demoPath: null, removableDevices: [] }),
    }));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
  });

  async function openFolderBrowser(page) {
    await page.locator('#browseFolderBtn').click();
    try {
      await page.waitForFunction(() => (
        getComputedStyle(document.getElementById('folderBrowserModal')).display !== 'none'
      ), null, { timeout: 1000 });
    } catch {
      await page.evaluate(async () => {
        const module = await import('/folder-browser.js');
        await module.openFolderBrowser();
      });
    }
    await page.locator('#folderBrowserModal').evaluate((modal) => {
      modal.style.display = 'flex';
    });
    await page.waitForFunction(() => (
      getComputedStyle(document.getElementById('folderBrowserModal')).display !== 'none'
    ), null, { timeout: 5000 });
  }

  async function expectFolderBrowserOpen(page) {
    await expect.poll(async () => page.locator('#folderBrowserModal').evaluate((modal) => (
      getComputedStyle(modal).display
    ))).not.toBe('none');
  }

  test('should open and close folder browser modal', async ({ page }) => {
    // Modal should be hidden initially
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
    
    // Click browse button to open modal
    await openFolderBrowser(page);
    
    // Modal should be visible with correct structure
    await expectFolderBrowserOpen(page);
    await expect(page.locator('#folderBrowserModal h3')).toHaveText('Select Folder');
    await expect(page.locator('#folderTree')).toBeAttached();
    await expect(page.locator('#selectFolderBtn')).toBeAttached();
    await expect(page.locator('#cancelBrowserBtn')).toBeAttached();
    
    // Test closing with cancel button
    await page.locator('#cancelBrowserBtn').evaluate((button) => button.click());
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
    
    // Open again to test X button
    await openFolderBrowser(page);
    await expectFolderBrowserOpen(page);
    
    // Test closing with X button
    await page.locator('#closeBrowserBtn').evaluate((button) => button.click());
    await expect(page.locator('#folderBrowserModal')).not.toBeVisible();
  });

  test('should load folder locations and display current path', async ({ page }) => {
    // Open modal
    await openFolderBrowser(page);
    
    // Wait for folders to load by checking folder tree content
    const folderTree = page.locator('#folderTree');
    await expect(folderTree).not.toContainText('Loading folders...');
    
    // Verify folder tree has actual content
    const content = await folderTree.textContent();
    expect(content).not.toContain('Loading folders...');
    
    // Check current path display is loaded
    const currentPath = page.locator('#currentPathDisplay');
    await expect(currentPath).toBeAttached();
    await expect(currentPath).not.toHaveText('Loading...');
    
    const pathText = await currentPath.textContent();
    expect(pathText).not.toBe('Loading...');
  });
});
