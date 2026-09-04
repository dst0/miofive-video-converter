// @ts-check
const {test, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const PROJECT_PATH = '/miofive-video-converter/';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CONTENT_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

test('GitHub Pages project-scope shell reloads offline with versioned assets', async ({browser}) => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (!pathname.startsWith(PROJECT_PATH)) {
        response.writeHead(404).end();
        return;
      }
      const relativePath = pathname.slice(PROJECT_PATH.length) || 'index.html';
      const filePath = path.resolve(PUBLIC_DIR, relativePath);
      if (path.dirname(filePath) !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const context = await browser.newContext({serviceWorkers: 'allow'});
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  try {
    await page.goto(`http://demo.localhost:${port}${PROJECT_PATH}`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(page.locator('#mainScreen h1')).toHaveText('Miofive Video Converter');

    // 1. Verify JavaScript initialization & meaningful offline UI interaction
    const enableFilters = page.locator('#enablePreScanFilters');
    const filterControls = page.locator('#preScanFilterControls');
    await expect(filterControls).toBeHidden();
    await enableFilters.click();
    await expect(filterControls).toBeVisible();

    // Verify preset date button interaction
    await page.locator('.preset-btn[data-preset="today"]').click();
    const startTimeValue = await page.locator('#preScanStartTime').inputValue();
    expect(startTimeValue).toBeTruthy();

    // Verify scan client-side validation works offline
    await page.locator('#scanBtn').click();
    await expect(page.locator('#results .error')).toHaveText('Please select a folder');

    // The shared dialog module must also be available from the offline shell.
    await page.locator('#browseFolderBtn').click();
    await expect(page.getByRole('dialog', {name: 'Select Folder'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#productDialog')).toBeHidden();

    // 2. Verify project-scope isolation
    const registrationScope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? new URL(reg.scope).pathname : null;
    });
    expect(registrationScope).toBe(PROJECT_PATH);

    // Verify out-of-scope requests are not intercepted/handled by project service worker
    const outOfScopeResult = await page.evaluate(async () => {
      try {
        const res = await fetch('/outside-project-scope');
        return `status:${res.status}`;
      } catch {
        return 'network_error';
      }
    });
    expect(outOfScopeResult).toBe('network_error');

    // 3. Reject any runtime page errors
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
