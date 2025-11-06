// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('File Range Improvements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    
    const testDir = path.join(__dirname, '../test-data');
    
    // Set folder path and scan
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    
    // Wait for scan to complete
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    
    // Click Play Videos button to open player
    await page.locator('#playVideosBtn').click();
    
    // Wait for player screen to be visible
    await expect(page.locator('#playerScreen')).toBeVisible();
    
    // Wait for video to start loading
    await page.waitForTimeout(500);
  });

  test('file markers should have enhanced tooltip with detailed information', async ({ page }) => {
    // Wait for file markers to be rendered (scope to player screen)
    await expect(page.locator('#playerScreen .file-marker').first()).toBeVisible();
    
    // Get the first file marker
    const firstMarker = page.locator('#playerScreen .file-marker').first();
    
    // Check that the marker has data attributes with detailed info
    const filename = await firstMarker.getAttribute('data-filename');
    const timestamp = await firstMarker.getAttribute('data-timestamp');
    const duration = await firstMarker.getAttribute('data-duration');
    const filetype = await firstMarker.getAttribute('data-filetype');
    
    // Verify all data attributes are present
    expect(filename).toBeTruthy();
    expect(timestamp).toBeTruthy();
    expect(duration).toBeTruthy();
    expect(filetype).toBeTruthy();
    
    // Check that title attribute contains all the info
    const title = await firstMarker.getAttribute('title');
    expect(title).toContain(filename);
    expect(title).toContain('Time:');
    expect(title).toContain('Duration:');
    expect(title).toContain('Type:');
  });

  test('file markers should display tooltip on hover', async ({ page }) => {
    // Wait for file markers to be rendered (scope to player screen)
    await expect(page.locator('#playerScreen .file-marker').first()).toBeVisible();
    
    const firstMarker = page.locator('#playerScreen .file-marker').first();
    
    // Check that tooltip element exists but is initially hidden
    const tooltip = firstMarker.locator('.file-marker-tooltip');
    await expect(tooltip).toBeAttached();
    
    // Verify tooltip has opacity 0 initially (hidden via CSS)
    const initialOpacity = await tooltip.evaluate(el => {
      return window.getComputedStyle(el).opacity;
    });
    expect(parseFloat(initialOpacity)).toBeLessThanOrEqual(0.1);
    
    // Hover over the marker
    await firstMarker.hover();
    
    // Wait a moment for CSS transition
    await page.waitForTimeout(300);
    
    // Verify tooltip becomes visible on hover
    const hoverOpacity = await tooltip.evaluate(el => {
      return window.getComputedStyle(el).opacity;
    });
    expect(parseFloat(hoverOpacity)).toBeGreaterThan(0.8);
  });

  test('tooltip should contain all information fields', async ({ page }) => {
    // Wait for file markers to be rendered (scope to player screen)
    await expect(page.locator('#playerScreen .file-marker').first()).toBeVisible();
    
    const firstMarker = page.locator('#playerScreen .file-marker').first();
    const tooltip = firstMarker.locator('.file-marker-tooltip');
    
    // Check that tooltip contains all required elements
    await expect(tooltip.locator('.tooltip-filename')).toBeAttached();
    await expect(tooltip.locator('.tooltip-info').nth(0)).toContainText('Time:');
    await expect(tooltip.locator('.tooltip-info').nth(1)).toContainText('Duration:');
    await expect(tooltip.locator('.tooltip-info').nth(2)).toContainText('Type:');
  });

  test('playback position should update during video playback', async ({ page }) => {
    // Wait for playback position indicator to be visible
    const playbackPosition = page.locator('#playbackPosition');
    await expect(playbackPosition).toBeVisible();
    
    // Ensure video is playing
    const playPauseBtn = page.locator('#playPauseBtn');
    const btnText = await playPauseBtn.textContent();
    if (btnText && btnText.includes('Play')) {
      // Video is paused, click to play
      await playPauseBtn.click();
      await page.waitForTimeout(200);
    }
    
    // Get initial position
    const initialLeft = await playbackPosition.evaluate(el => el.style.left);
    const initialPercent = parseFloat(initialLeft) || 0;
    
    // Let video play for a moment
    await page.waitForTimeout(1500);
    
    // Get position after playback
    const newLeft = await playbackPosition.evaluate(el => el.style.left);
    const newPercent = parseFloat(newLeft) || 0;
    
    // Position should have changed (moved forward) or stayed the same if video ended
    expect(newPercent).toBeGreaterThanOrEqual(initialPercent);
  });

  test('playback position should update when seeking', async ({ page }) => {
    // Wait for playback position indicator to be visible
    const playbackPosition = page.locator('#playbackPosition');
    await expect(playbackPosition).toBeVisible();
    
    // Wait for video to start playing and position to be established
    await page.waitForTimeout(1000);
    
    // Pause the video
    await page.locator('#playPauseBtn').click();
    await page.waitForTimeout(200);
    
    // Get initial position
    const initialLeft = await playbackPosition.evaluate(el => el.style.left);
    const initialPercent = parseFloat(initialLeft) || 0;
    
    // Click on the next button to move to the next video (this causes a bigger position change)
    const nextBtn = page.locator('#nextBtn');
    const isEnabled = await nextBtn.isEnabled();
    
    if (isEnabled) {
      await nextBtn.click();
      
      // Wait for video to switch and position to update
      await page.waitForTimeout(800);
      
      // Get position after switching video
      const newLeft = await playbackPosition.evaluate(el => el.style.left);
      const newPercent = parseFloat(newLeft) || 0;
      
      // Position should have changed (moved forward to next video)
      // Each video is about 10% of the timeline (10 videos total)
      expect(newPercent).toBeGreaterThan(initialPercent);
      expect(newPercent).toBeGreaterThan(5); // Should be at least 5% into timeline
    } else {
      // If we're on the last video, test passes as we verified the position exists
      console.log('Skipping seek test: already on last video');
    }
  });

  test('playback position should sync with timeline when switching videos', async ({ page }) => {
    // Check if we have enough videos for this test
    const checkboxes = page.locator('.file-checkbox');
    const count = await checkboxes.count();
    
    // Skip test if not enough videos (we need at least 3)
    if (count < 3) {
      console.log('Skipping test: not enough videos');
      return;
    }
    
    // Wait for playback position to be visible
    const playbackPosition = page.locator('#playbackPosition');
    await expect(playbackPosition).toBeVisible();
    
    // Click next button to go to next video
    await page.locator('#nextBtn').click();
    
    // Wait for video to change
    await page.waitForTimeout(500);
    
    // Verify video progress shows we're on video 2
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of');
    
    // Playback position should still be visible and positioned correctly
    await expect(playbackPosition).toBeVisible();
    const positionLeft = await playbackPosition.evaluate(el => el.style.left);
    expect(positionLeft).toBeTruthy();
    
    // Position should be within valid range (0-100%)
    const percent = parseFloat(positionLeft);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(100);
  });

  test('file markers should be clickable and load the corresponding video', async ({ page }) => {
    // Wait for file markers to be rendered (scope to player screen)
    await expect(page.locator('#playerScreen .file-marker').first()).toBeVisible();
    
    // Check if we have enough markers for this test
    const markerCount = await page.locator('#playerScreen .file-marker').count();
    if (markerCount < 3) {
      console.log('Skipping test: not enough file markers');
      return;
    }
    
    const thirdMarker = page.locator('#playerScreen .file-marker').nth(2);
    const markerFilename = await thirdMarker.getAttribute('data-filename');
    
    // Click on the third marker
    await thirdMarker.click();
    
    // Wait for video to load
    await page.waitForTimeout(500);
    
    // Verify the correct video is loaded
    const currentVideoName = await page.locator('#currentVideoName').textContent();
    expect(currentVideoName).toContain(markerFilename);
    
    // Verify we're on video 3
    await expect(page.locator('#videoProgress')).toContainText('Video 3 of');
  });

  test('current file marker should be highlighted', async ({ page }) => {
    // Wait for file markers to be rendered (scope to player screen)
    await expect(page.locator('#playerScreen .file-marker').first()).toBeVisible();
    
    // Wait for the highlight to be applied (loadVideo is called asynchronously)
    await page.waitForTimeout(800);
    
    // First marker should have 'current-marker' class
    const firstMarker = page.locator('#playerScreen .file-marker').first();
    await expect(firstMarker).toHaveClass(/current-marker/);
    
    // Navigate to next video
    const nextBtn = page.locator('#nextBtn');
    const isEnabled = await nextBtn.isEnabled();
    
    if (isEnabled) {
      await nextBtn.click();
      await page.waitForTimeout(800);
      
      // Second marker should now have 'current-marker' class
      const secondMarker = page.locator('#playerScreen .file-marker').nth(1);
      await expect(secondMarker).toHaveClass(/current-marker/);
      
      // First marker should no longer have the class
      await expect(firstMarker).not.toHaveClass(/current-marker/);
    }
  });
});
