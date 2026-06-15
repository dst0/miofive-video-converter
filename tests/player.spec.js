// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

async function openPlayer(page, selectedCount) {
  await page.goto('/');

  const testDir = path.join(__dirname, '../test-data');
  await page.locator('#folderPath').fill(testDir);
  await page.locator('#scanBtn').click();
  await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });

  if (selectedCount) {
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    for (let i = selectedCount; i < count; i++) {
      await checkboxes.nth(i).uncheck();
    }
  }

  await page.locator('#playVideosBtn').click();
  await expect(page.locator('#playerScreen')).toBeVisible();
  await expect(page.locator('#currentVideoName')).not.toBeEmpty();
}

test.describe('Video Player - UI Tests (SPA)', () => {
  test('should show Play Videos button after scanning', async ({ page }) => {
    await page.goto('/');
    
    // Create a temporary test directory with mock video files
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path directly
    await page.locator('#folderPath').fill(testDir);
    
    // Scan for videos
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete
    await expect(page.locator('.count')).toBeVisible({ timeout: 10000 });
    
    // Check if Play Videos button appears
    await expect(page.locator('#playVideosBtn')).toBeVisible();
    await expect(page.locator('#playVideosBtn')).toContainText('Play Videos');
  });

  test('should show player screen when clicking Play Videos', async ({ page }) => {
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
    
    // Main screen should be hidden
    await expect(page.locator('#mainScreen')).not.toBeVisible();
    
    // Check player UI elements (scope to player screen)
    await expect(page.locator('#playerScreen h1')).toContainText('Video Player');
    await expect(page.locator('#backBtn')).toBeVisible();
  });

  test('should reset scroll position when opening player screen', async ({ page }) => {
    await page.goto('/');

    const testDir = path.join(__dirname, '../test-data');
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.locator('#playVideosBtn').click();
    await expect(page.locator('#playerScreen')).toBeVisible();

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('should have all player UI elements in SPA mode', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan and click Play Videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Check main UI elements
    await expect(page.locator('#backBtn')).toBeVisible();
    await expect(page.locator('#backBtn')).toContainText('Back to Main');
    
    // Check video player (dual-player architecture - only active player is visible)
    await expect(page.locator('#videoPlayer1')).toBeVisible();
    
    // Wait for video to be loaded (currentVideoName gets populated by loadVideo function)
    await expect(page.locator('#currentVideoName')).not.toBeEmpty();
    
    // Check video info
    await expect(page.locator('#currentVideoName')).toBeVisible();
    await expect(page.locator('#videoProgress')).toBeVisible();
    
    // Check timeline (scope to player screen to avoid duplicate)
    await expect(page.locator('#playerScreen .timeline-section')).toBeVisible();
    await expect(page.locator('#timelineTrack')).toBeVisible();
    // File markers should be present (scope to player screen)
    await expect(page.locator('#playerScreen .file-marker')).toHaveCount(await page.locator('.file-checkbox:checked').count());
    await expect(page.locator('#playbackPosition')).toBeVisible();
    
    // Check controls
    await expect(page.locator('#prevBtn')).toBeVisible();
    await expect(page.locator('#playPauseBtn')).toBeVisible();
    await expect(page.locator('#nextBtn')).toBeVisible();
    // Check speed control elements
    await expect(page.locator('#speedInput')).toBeVisible();
    await expect(page.locator('#speedSlider')).toBeVisible();
  });

  test('should display correct video information', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan and click Play Videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    // Select only first file for simpler test
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    if (count > 1) {
      // Uncheck all except first
      for (let i = 1; i < count; i++) {
        await checkboxes.nth(i).uncheck();
      }
    }
    
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Wait for video name to be displayed
    await expect(page.locator('#currentVideoName')).not.toBeEmpty();
    
    // Check video progress shows "Video 1 of 1"
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of 1');
  });

  test('should have working playback controls', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan and select only first file
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    if (count > 1) {
      for (let i = 1; i < count; i++) {
        await checkboxes.nth(i).uncheck();
      }
    }
    
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Wait for controls to be visible
    await expect(page.locator('#prevBtn')).toBeVisible();
    await expect(page.locator('#playPauseBtn')).toBeVisible();
    await expect(page.locator('#nextBtn')).toBeVisible();
    
    // Previous button should be disabled (first video)
    await expect(page.locator('#prevBtn')).toBeDisabled();
    
    // Next button should be disabled (only one video)
    await expect(page.locator('#nextBtn')).toBeDisabled();
    
    // Play/Pause button should be visible and clickable
    await expect(page.locator('#playPauseBtn')).toBeEnabled();
    
    // Speed control should be visible and have default value
    await expect(page.locator('#speedInput')).toBeVisible();
    await expect(page.locator('#speedInput')).toHaveValue('1.0');
    await expect(page.locator('#speedSlider')).toBeVisible();
    await expect(page.locator('#speedSlider')).toHaveValue('1');
  });

  test('should keep mobile player controls out of the video stage', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlayer(page, 3);

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const buttonRects = (selector) => [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          width: r.width,
          height: r.height,
        };
      });
      const delta = (values) => Math.max(...values) - Math.min(...values);
      const video = rect('#videoPlayer1');
      const overlay = rect('.custom-controls-overlay');
      const wrapper = rect('#videoWrapper');
      const overlayButtons = buttonRects('.control-buttons-row .overlay-btn');
      const playbackButtons = buttonRects('.playback-controls .control-btn');
      const presetButtons = buttonRects('.speed-presets .preset-speed-btn');
      const headerButtons = buttonRects('.player-header-buttons button');

      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overlayStartsAfterVideo: overlay.top >= video.bottom - 1,
        overlayShare: overlay.height / wrapper.height,
        overlayButtonsAreOneRow: delta(overlayButtons.map((button) => button.top)) <= 1,
        overlayButtonHeightDelta: delta(overlayButtons.map((button) => button.height)),
        playbackButtonHeightDelta: delta(playbackButtons.map((button) => button.height)),
        playbackButtonWidthDelta: delta(playbackButtons.map((button) => button.width)),
        presetButtonHeightDelta: delta(presetButtons.map((button) => button.height)),
        presetButtonWidthDelta: delta(presetButtons.map((button) => button.width)),
        headerButtonHeightDelta: delta(headerButtons.map((button) => button.height)),
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.overlayStartsAfterVideo).toBe(true);
    expect(layout.overlayShare).toBeLessThanOrEqual(0.4);
    expect(layout.overlayButtonsAreOneRow).toBe(true);
    expect(layout.overlayButtonHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.playbackButtonHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.playbackButtonWidthDelta).toBeLessThanOrEqual(1);
    expect(layout.presetButtonHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.presetButtonWidthDelta).toBeLessThanOrEqual(1);
    expect(layout.headerButtonHeightDelta).toBeLessThanOrEqual(1);
  });

  test('should keep desktop player controls visually consistent', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPlayer(page, 3);

    const layout = await page.evaluate(() => {
      const buttonRects = (selector) => [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          width: r.width,
          height: r.height,
        };
      });
      const delta = (values) => Math.max(...values) - Math.min(...values);
      const overlayButtons = buttonRects('.control-buttons-row .overlay-btn');
      const playbackButtons = buttonRects('.playback-controls .control-btn');
      const presetButtons = buttonRects('.speed-presets .preset-speed-btn');
      const headerButtons = buttonRects('.player-header-buttons button');

      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overlayButtonHeightDelta: delta(overlayButtons.map((button) => button.height)),
        overlayButtonWidthDelta: delta(overlayButtons.map((button) => button.width)),
        overlayButtonsAreOneRow: delta(overlayButtons.map((button) => button.top)) <= 1,
        playbackButtonHeightDelta: delta(playbackButtons.map((button) => button.height)),
        playbackButtonWidthDelta: delta(playbackButtons.map((button) => button.width)),
        presetButtonHeightDelta: delta(presetButtons.map((button) => button.height)),
        presetButtonWidthDelta: delta(presetButtons.map((button) => button.width)),
        headerButtonHeightDelta: delta(headerButtons.map((button) => button.height)),
      };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.overlayButtonsAreOneRow).toBe(true);
    expect(layout.overlayButtonHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.overlayButtonWidthDelta).toBeLessThanOrEqual(1);
    expect(layout.playbackButtonHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.playbackButtonWidthDelta).toBeLessThanOrEqual(1);
    expect(layout.presetButtonHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.presetButtonWidthDelta).toBeLessThanOrEqual(1);
    expect(layout.headerButtonHeightDelta).toBeLessThanOrEqual(1);
  });

  test('should expose accessible player controls and modal focus behavior', async ({ page }) => {
    await openPlayer(page, 1);

    const videoWrapper = page.locator('#videoWrapper');
    await expect(videoWrapper).toBeFocused();
    await expect(videoWrapper).toHaveAttribute('role', 'region');
    await expect(videoWrapper).toHaveAttribute('aria-describedby', 'videoKeyboardHelp');

    await expect(page.getByRole('button', { name: /pause video|play video/i })).toHaveCount(2);
    await expect(page.getByRole('slider', { name: /seek through selected videos/i })).toBeVisible();
    await expect(page.locator('#progressBarContainer')).toHaveAttribute('aria-valuetext', /of/);
    await expect(page.locator('#muteBtn')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#exportVideosBtn').click();
    await expect(page.getByRole('dialog', { name: 'Export Videos' })).toBeVisible();
    await expect(page.locator('#closeExportModalBtn')).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#exportCancelBtn')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Export Videos' })).not.toBeVisible();
    await expect(page.locator('#exportVideosBtn')).toBeFocused();
  });

  test('should support keyboard shortcuts for video playback', async ({ page }) => {
    await openPlayer(page, 1);

    const videoWrapper = page.locator('#videoWrapper');
    const playPauseBtn = page.locator('#playPauseBtn');
    const progress = page.locator('#progressBarContainer');
    const muteBtn = page.locator('#muteBtn');

    await videoWrapper.focus();
    const beforeSpace = await playPauseBtn.getAttribute('aria-pressed');
    await page.keyboard.press('Space');
    await expect.poll(() => playPauseBtn.getAttribute('aria-pressed')).toBe(
      beforeSpace === 'true' ? 'false' : 'true'
    );

    const beforeK = await playPauseBtn.getAttribute('aria-pressed');
    await page.keyboard.press('k');
    await expect.poll(() => playPauseBtn.getAttribute('aria-pressed')).toBe(
      beforeK === 'true' ? 'false' : 'true'
    );

    const maxDuration = Number(await progress.getAttribute('aria-valuemax'));
    expect(maxDuration).toBeGreaterThan(0);
    const beforeSeek = Number(await progress.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(beforeSeek);

    await page.keyboard.press('m');
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('m');
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('should toggle playback when clicking the video area', async ({ page }) => {
    await openPlayer(page, 1);

    const playPauseBtn = page.locator('#playPauseBtn');
    const beforeClick = await playPauseBtn.getAttribute('aria-pressed');

    await page.locator('#videoWrapper').click({ position: { x: 320, y: 180 } });
    await expect.poll(() => playPauseBtn.getAttribute('aria-pressed')).toBe(
      beforeClick === 'true' ? 'false' : 'true'
    );
  });

  test('should navigate between multiple videos', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan - need at least 3 videos for navigation test
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    // Check if we have enough videos
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    if (count < 3) {
      test.skip();
      return;
    }
    
    // Select only first 3 videos
    if (count > 3) {
      for (let i = 3; i < count; i++) {
        await checkboxes.nth(i).uncheck();
      }
    }
    
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Wait for video to load
    await expect(page.locator('#currentVideoName')).not.toBeEmpty();
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of');
    
    // Previous should be disabled
    await expect(page.locator('#prevBtn')).toBeDisabled();
    
    // Next should be enabled
    await expect(page.locator('#nextBtn')).toBeEnabled();
    
    // Click next
    await page.locator('#nextBtn').click();
    // Wait for video 2 to load by checking progress text changes
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of');
    
    // Both prev and next should be enabled
    await expect(page.locator('#prevBtn')).toBeEnabled();
    await expect(page.locator('#nextBtn')).toBeEnabled();
    
    // Click previous
    await page.locator('#prevBtn').click();
    // Wait for video 1 to load by checking progress text changes
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of');
  });

  test('should change playback speed', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan and select first file
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    if (count > 1) {
      for (let i = 1; i < count; i++) {
        await checkboxes.nth(i).uncheck();
      }
    }
    
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Wait for speed control to be visible
    await expect(page.locator('#speedInput')).toBeVisible();
    
    // Change speed to 2x using input
    await page.locator('#speedInput').fill('2');
    await page.locator('#speedInput').blur();
    
    // Wait a bit for the speed to be applied
    await page.waitForTimeout(100);
    
    // Verify the playback rate is set on the active player
    const playbackRate = await page.locator('#videoPlayer1').evaluate(el => el.playbackRate);
    expect(playbackRate).toBe(2);
    
    // Change speed to 0.5x using slider (use evaluate to set value)
    await page.locator('#speedSlider').evaluate((el) => {
      el.value = '0.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    
    // Wait a bit for the speed to be applied
    await page.waitForTimeout(100);
    
    // Verify the playback rate is set
    const playbackRate2 = await page.locator('#videoPlayer1').evaluate(el => el.playbackRate);
    expect(playbackRate2).toBe(0.5);
  });

  test('should display timeline with file markers', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan - need at least 3 videos
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    if (count < 3) {
      test.skip();
      return;
    }
    
    // Select only first 3 videos
    if (count > 3) {
      for (let i = 3; i < count; i++) {
        await checkboxes.nth(i).uncheck();
      }
    }
    
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Wait for timeline to render
    await expect(page.locator('#timelineStart')).toBeVisible();
    await expect(page.locator('#timelineEnd')).toBeVisible();
    
    // Check file markers are present (scope to player screen)
    const markers = page.locator('#playerScreen .file-marker');
    await expect(markers).toHaveCount(3);
    
    // Check that markers are visible
    for (let i = 0; i < 3; i++) {
      await expect(markers.nth(i)).toBeVisible();
    }
  });

  test('should activate timeline file markers with the keyboard', async ({ page }) => {
    await openPlayer(page, 3);

    const secondMarker = page.locator('#playerScreen .file-marker').nth(1);
    await expect(secondMarker).toHaveAttribute('role', 'button');
    await secondMarker.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#videoProgress')).toContainText('Video 2 of');
    await expect(secondMarker).toHaveAttribute('aria-current', 'true');
  });

  test('should return to main screen when clicking back button', async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan and play
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Click back button
    await page.locator('#backBtn').click();
    
    // Wait a bit for transition
    await page.waitForTimeout(100);
    
    // Should show main screen and hide player screen
    await expect(page.locator('#mainScreen')).toBeVisible();
    await expect(page.locator('#playerScreen')).not.toBeVisible();
    await expect(page.locator('#mainScreen h1')).toContainText('Miofive Video Converter');
  });
});
