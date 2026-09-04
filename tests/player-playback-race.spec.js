// @ts-check
const {test, expect} = require('@playwright/test');
const path = require('path');

test('rapid playback commands ignore expected AbortError races and manual Next stops the old player', async ({page}) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function pauseWithObservation() {
      window.__miofivePausedPlayers = [...(window.__miofivePausedPlayers || []), this.id];
      return originalPause.call(this);
    };
  });

  await page.goto('/');
  await page.locator('#folderPath').fill(path.join(__dirname, '..', 'test-data'));
  await page.locator('#scanBtn').click();
  await expect(page.locator('#playVideosBtn')).toBeVisible({timeout: 10000});
  await page.locator('#playVideosBtn').click();
  await expect(page.locator('#playerScreen')).toBeVisible();

  // Reset to the first file in a paused state so two-second fixture videos cannot
  // auto-advance while the test creates overlapping play/pause requests.
  await page.evaluate(() => {
    document.querySelector('#playerScreen .file-marker').click();
    const playPause = document.getElementById('playPauseBtn');
    for (let index = 0; index < 6; index++) playPause.click();
    document.getElementById('nextBtn').click();
  });
  await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');

  const pausedPlayers = await page.evaluate(() => window.__miofivePausedPlayers || []);
  expect(pausedPlayers).toContain('videoPlayer1');
  expect(consoleErrors.filter((message) => /AbortError|play\(\) request was interrupted/i.test(message))).toEqual([]);
});

test('stale media readiness callbacks cannot control a recycled player source', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 0,
    });
    HTMLMediaElement.prototype.load = function observedLoad() {};
    HTMLMediaElement.prototype.pause = function observedPause() {};
    HTMLMediaElement.prototype.play = function observedPlay() {
      window.__miofivePlayCalls = [...(window.__miofivePlayCalls || []), {
        playerId: this.id,
        videoIndex: Number(this.dataset.videoIndex),
      }];
      return Promise.resolve();
    };
  });

  await page.goto('/');
  await page.locator('#folderPath').fill(path.join(__dirname, '..', 'test-data'));
  await page.locator('#scanBtn').click();
  await expect(page.locator('#playVideosBtn')).toBeVisible({timeout: 10000});
  await page.locator('#playVideosBtn').click();

  await page.evaluate(() => {
    window.__miofivePlayCalls = [];
    document.getElementById('nextBtn').click();
    document.getElementById('nextBtn').click();
    document.getElementById('videoPlayer1').dispatchEvent(new Event('loadeddata'));
    document.getElementById('videoPlayer2').dispatchEvent(new Event('loadeddata'));
  });

  await expect(page.locator('#currentVideoName')).toContainText('000003A.MP4');
  await expect.poll(() => page.evaluate(() => window.__miofivePlayCalls)).toEqual([
    {playerId: 'videoPlayer1', videoIndex: 2},
  ]);

  await page.locator('#backBtn').click();
  const unloaded = await page.evaluate(() => [1, 2].every((number) => {
    const player = document.getElementById(`videoPlayer${number}`);
    const source = document.getElementById(`videoSource${number}`);
    return source.getAttribute('src') === null && player.dataset.videoIndex === undefined;
  }));
  expect(unloaded).toBe(true);

  await page.evaluate(() => {
    document.getElementById('videoPlayer1').dispatchEvent(new Event('loadeddata'));
    document.getElementById('videoPlayer2').dispatchEvent(new Event('loadeddata'));
  });
  expect(await page.evaluate(() => window.__miofivePlayCalls)).toEqual([
    {playerId: 'videoPlayer1', videoIndex: 2},
  ]);
});
