// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs').promises;
const path = require('path');

test.describe('Video Player - API Tests', () => {
  test('GET /video without path should return error', async ({ request }) => {
    const response = await request.get('/video');
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Video path is required');
  });

  test('GET /video with invalid path should return error', async ({ request }) => {
    const response = await request.get('/video?path=/nonexistent/file.mp4');
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('GET /video with non-MP4 file should return error', async ({ request }) => {
    const response = await request.get('/video?path=/etc/passwd');
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Only MP4 files are allowed');
  });

  test('GET /video should support range requests', async ({ request }) => {
    // Use test data video file
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const response = await request.get(`/video?path=${encodeURIComponent(testVideoPath)}`, {
      headers: {
        'Range': 'bytes=0-1023'
      }
    });
    
    expect(response.status()).toBe(206); // Partial Content
    expect(response.headers()['content-type']).toContain('video/mp4');
    expect(response.headers()['content-range']).toBeTruthy();
    expect(response.headers()['accept-ranges']).toBe('bytes');
  });

  test('GET /video should serve full file without range header', async ({ request }) => {
    // Use test data video file
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const response = await request.get(`/video?path=${encodeURIComponent(testVideoPath)}`);
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('video/mp4');
    expect(response.headers()['content-length']).toBeTruthy();
  });

  test('GET /video should be rate limited', async ({ request }) => {
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    // Make many rapid requests to trigger rate limiting
    const requests = [];
    for (let i = 0; i < 150; i++) {
      requests.push(
        request.get(`/video?path=${encodeURIComponent(testVideoPath)}`).catch(() => null)
      );
    }
    
    const responses = await Promise.all(requests);
    
    // At least one response should be rate-limited (429)
    const rateLimited = responses.some(r => r && r.status() === 429);
    expect(rateLimited).toBeTruthy();
  });
});

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
    // Slider value should be '1' regardless of min/max
    const sliderValue = await page.locator('#speedSlider').inputValue();
    expect(parseFloat(sliderValue)).toBe(1);
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
    await expect(page.locator('#mainScreen h1')).toContainText('MP4 Video Combiner');
  });
});
