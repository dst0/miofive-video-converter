// @ts-check
const {test, expect} = require('@playwright/test');
const path = require('path');

const samplePath = path.join(
  __dirname,
  '..',
  'test-data',
  'Normal',
  '010125_100000_010125_050000_000001A.MP4'
);

test.describe('Untrusted filesystem metadata rendering', () => {
  test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
      window.__miofiveXssTriggered = false;
    });
  });

  test('renders malicious-looking scan metadata as text in results and player', async ({page}) => {
    const filename = '"><img src=x onerror="window.__miofiveXssTriggered=true">.MP4';
    await page.route('**/scan', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        files: [{
          path: samplePath,
          filename,
          utcTime: '2025-01-01T10:00:00.000Z',
          localTime: '2025-01-01T05:00:00.000Z',
          timestamp: Date.parse('2025-01-01T10:00:00.000Z'),
          fileType: 'Normal" autofocus onfocus="window.__miofiveXssTriggered=true',
          duration: 2,
        }],
      }),
    }));

    await page.goto('/');
    await page.locator('#folderPath').fill('/tmp');
    await page.locator('#scanBtn').click();

    await expect(page.locator('.file-path')).toHaveText(filename);
    await expect(page.locator('#results img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__miofiveXssTriggered)).toBe(false);

    await page.locator('#playVideosBtn').click();
    await expect(page.locator('#currentVideoName')).toHaveText(filename);
    await expect(page.locator('#playerScreen img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__miofiveXssTriggered)).toBe(false);
  });

  test('renders malicious-looking folder paths and API errors as text', async ({page}) => {
    const folderName = '"><img src=x onerror="window.__miofiveXssTriggered=true">';
    const folderPath = '/tmp/bad" autofocus onfocus="window.__miofiveXssTriggered=true';
    await page.route('**/list-directories', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({directories: [{name: folderName, path: folderPath, type: 'folder'}]}),
    }));
    await page.route('**/scan', (route) => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({error: folderName}),
    }));

    await page.goto('/');
    await page.locator('#browseFolderBtn').click();
    const item = page.locator('#folderTree .folder-item:not(.parent-folder)').first();
    await expect(item.locator('.folder-name')).toHaveText(folderName);
    expect(await item.getAttribute('data-path')).toBe(folderPath);
    await expect(page.locator('#folderTree img')).toHaveCount(0);

    await page.locator('#closeBrowserBtn').click();
    await page.locator('#folderPath').fill('/tmp');
    await page.locator('#scanBtn').click();
    await expect(page.locator('#results .error')).toHaveText(folderName);
    await expect(page.locator('#results img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__miofiveXssTriggered)).toBe(false);
  });
});