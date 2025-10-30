// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs').promises;
const path = require('path');

test.describe('Video Player - API Tests', () => {
  test('GET /player should serve video player page', async ({ request }) => {
    const response = await request.get('/player');
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/html');
    
    const body = await response.text();
    expect(body).toContain('Video Player');
    expect(body).toContain('videoPlayer');
    expect(body).toContain('Back to Main');
  });

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

test.describe('Video Player - UI Tests', () => {
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

  test('should have all player UI elements', async ({ page }) => {
    // Navigate directly to player with test data
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const files = [
      {
        path: testVideoPath,
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      }
    ];
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Check main UI elements
    await expect(page.locator('h1')).toContainText('Video Player');
    await expect(page.locator('#backBtn')).toBeVisible();
    await expect(page.locator('#backBtn')).toContainText('Back to Main');
    
    // Check video player
    await expect(page.locator('#videoPlayer')).toBeVisible();
    await expect(page.locator('#videoSource')).toBeVisible();
    
    // Check video info
    await expect(page.locator('#currentVideoName')).toBeVisible();
    await expect(page.locator('#videoProgress')).toBeVisible();
    
    // Check timeline
    await expect(page.locator('.timeline-section')).toBeVisible();
    await expect(page.locator('#timelineTrack')).toBeVisible();
    await expect(page.locator('#fileMarkers')).toBeVisible();
    await expect(page.locator('#playbackPosition')).toBeVisible();
    
    // Check controls
    await expect(page.locator('#prevBtn')).toBeVisible();
    await expect(page.locator('#playPauseBtn')).toBeVisible();
    await expect(page.locator('#nextBtn')).toBeVisible();
    await expect(page.locator('#speedControl')).toBeVisible();
  });

  test('should display correct video information', async ({ page }) => {
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const files = [
      {
        path: testVideoPath,
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      }
    ];
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for video info to be populated
    await page.waitForTimeout(1000);
    
    // Check video name is displayed
    await expect(page.locator('#currentVideoName')).toContainText('010125_100000_010125_050000_000001A.MP4');
    
    // Check video progress shows "Video 1 of 1"
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of 1');
  });

  test('should have working playback controls', async ({ page }) => {
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const files = [
      {
        path: testVideoPath,
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      }
    ];
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for video to load
    await page.waitForTimeout(1000);
    
    // Previous button should be disabled (first video)
    await expect(page.locator('#prevBtn')).toBeDisabled();
    
    // Next button should be disabled (only one video)
    await expect(page.locator('#nextBtn')).toBeDisabled();
    
    // Play/Pause button should be visible and clickable
    await expect(page.locator('#playPauseBtn')).toBeEnabled();
    
    // Speed control should be visible and have default value
    await expect(page.locator('#speedControl')).toBeVisible();
    await expect(page.locator('#speedControl')).toHaveValue('1');
  });

  test('should navigate between multiple videos', async ({ page }) => {
    // Create multiple test video entries
    const files = [
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4'),
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      },
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100100_010125_050100_000002A.MP4'),
        filename: '010125_100100_010125_050100_000002A.MP4',
        utcTime: '2025-01-01T10:01:00.000Z',
        localTime: '2025-01-01T05:01:00.000Z',
        timestamp: 1735725660000,
        fileType: 'Normal'
      },
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100200_010125_050200_000003A.MP4'),
        filename: '010125_100200_010125_050200_000003A.MP4',
        utcTime: '2025-01-01T10:02:00.000Z',
        localTime: '2025-01-01T05:02:00.000Z',
        timestamp: 1735725720000,
        fileType: 'Normal'
      }
    ];
    
    // Check if test videos exist
    try {
      await fs.access(files[0].path);
    } catch {
      test.skip();
      return;
    }
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for video to load
    await page.waitForTimeout(1000);
    
    // Should start with first video
    await expect(page.locator('#currentVideoName')).toContainText('000001A.MP4');
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of 3');
    
    // Previous should be disabled
    await expect(page.locator('#prevBtn')).toBeDisabled();
    
    // Next should be enabled
    await expect(page.locator('#nextBtn')).toBeEnabled();
    
    // Click next
    await page.locator('#nextBtn').click();
    await page.waitForTimeout(500);
    
    // Should now show second video
    await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of 3');
    
    // Both prev and next should be enabled
    await expect(page.locator('#prevBtn')).toBeEnabled();
    await expect(page.locator('#nextBtn')).toBeEnabled();
    
    // Click previous
    await page.locator('#prevBtn').click();
    await page.waitForTimeout(500);
    
    // Should be back to first video
    await expect(page.locator('#currentVideoName')).toContainText('000001A.MP4');
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of 3');
  });

  test('should change playback speed', async ({ page }) => {
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const files = [
      {
        path: testVideoPath,
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      }
    ];
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for video to load
    await page.waitForTimeout(1000);
    
    // Change speed to 2x
    await page.locator('#speedControl').selectOption('2');
    
    // Verify the playback rate is set
    const playbackRate = await page.locator('#videoPlayer').evaluate(el => el.playbackRate);
    expect(playbackRate).toBe(2);
    
    // Change speed to 0.5x
    await page.locator('#speedControl').selectOption('0.5');
    
    // Verify the playback rate is set
    const playbackRate2 = await page.locator('#videoPlayer').evaluate(el => el.playbackRate);
    expect(playbackRate2).toBe(0.5);
  });

  test('should display timeline with file markers', async ({ page }) => {
    const files = [
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4'),
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      },
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100100_010125_050100_000002A.MP4'),
        filename: '010125_100100_010125_050100_000002A.MP4',
        utcTime: '2025-01-01T10:01:00.000Z',
        localTime: '2025-01-01T05:01:00.000Z',
        timestamp: 1735725660000,
        fileType: 'Normal'
      },
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100200_010125_050200_000003A.MP4'),
        filename: '010125_100200_010125_050200_000003A.MP4',
        utcTime: '2025-01-01T10:02:00.000Z',
        localTime: '2025-01-01T05:02:00.000Z',
        timestamp: 1735725720000,
        fileType: 'Normal'
      }
    ];
    
    // Check if test videos exist
    try {
      await fs.access(files[0].path);
    } catch {
      test.skip();
      return;
    }
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for timeline to render
    await page.waitForTimeout(500);
    
    // Check timeline labels
    await expect(page.locator('#timelineStart')).toBeVisible();
    await expect(page.locator('#timelineEnd')).toBeVisible();
    
    // Check file markers are present
    const markers = page.locator('.file-marker');
    await expect(markers).toHaveCount(3);
    
    // Check that markers are visible
    for (let i = 0; i < 3; i++) {
      await expect(markers.nth(i)).toBeVisible();
    }
  });

  test('should navigate by clicking file markers', async ({ page }) => {
    const files = [
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4'),
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      },
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100100_010125_050100_000002A.MP4'),
        filename: '010125_100100_010125_050100_000002A.MP4',
        utcTime: '2025-01-01T10:01:00.000Z',
        localTime: '2025-01-01T05:01:00.000Z',
        timestamp: 1735725660000,
        fileType: 'Normal'
      },
      {
        path: path.join(__dirname, '../test-data/Normal/010125_100200_010125_050200_000003A.MP4'),
        filename: '010125_100200_010125_050200_000003A.MP4',
        utcTime: '2025-01-01T10:02:00.000Z',
        localTime: '2025-01-01T05:02:00.000Z',
        timestamp: 1735725720000,
        fileType: 'Normal'
      }
    ];
    
    // Check if test videos exist
    try {
      await fs.access(files[0].path);
    } catch {
      test.skip();
      return;
    }
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for timeline to render
    await page.waitForTimeout(500);
    
    // Should start at video 1
    await expect(page.locator('#videoProgress')).toContainText('Video 1 of 3');
    
    // Click on the third file marker
    const markers = page.locator('.file-marker');
    await markers.nth(2).click();
    await page.waitForTimeout(500);
    
    // Should jump to video 3
    await expect(page.locator('#currentVideoName')).toContainText('000003A.MP4');
    await expect(page.locator('#videoProgress')).toContainText('Video 3 of 3');
    
    // Click on the second file marker
    await markers.nth(1).click();
    await page.waitForTimeout(500);
    
    // Should jump to video 2
    await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of 3');
  });

  test('should return to main page when clicking back button', async ({ page }) => {
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const files = [
      {
        path: testVideoPath,
        filename: '010125_100000_010125_050000_000001A.MP4',
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      }
    ];
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Click back button
    await page.locator('#backBtn').click();
    
    // Should navigate to main page
    await expect(page).toHaveURL('/');
    await expect(page.locator('h1')).toContainText('MP4 Video Combiner');
  });

  test('should show alert when no video files provided', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    
    await page.goto('/player');
    
    // Should redirect to main page after alert
    await page.waitForURL('/');
  });

  test('should escape HTML in video filenames to prevent XSS', async ({ page }) => {
    const maliciousFilename = '<script>alert("XSS")</script>.MP4';
    const testVideoPath = path.join(__dirname, '../test-data/Normal/010125_100000_010125_050000_000001A.MP4');
    
    // Check if test video exists
    try {
      await fs.access(testVideoPath);
    } catch {
      test.skip();
      return;
    }

    const files = [
      {
        path: testVideoPath,
        filename: maliciousFilename,
        utcTime: '2025-01-01T10:00:00.000Z',
        localTime: '2025-01-01T05:00:00.000Z',
        timestamp: 1735725600000,
        fileType: 'Normal'
      }
    ];
    
    await page.goto(`/player?files=${encodeURIComponent(JSON.stringify(files))}`);
    
    // Wait for page to load
    await page.waitForTimeout(500);
    
    // Check that the malicious script is not executed
    // The filename should be displayed as text, not executed
    const videoNameText = await page.locator('#currentVideoName').textContent();
    expect(videoNameText).toContain('<script>');
    expect(videoNameText).toContain('</script>');
    
    // Verify no scripts were executed by checking page title
    await expect(page).toHaveTitle(/Video Player/);
  });
});
