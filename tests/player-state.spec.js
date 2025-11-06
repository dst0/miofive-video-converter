// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Video Player - State Management Tests', () => {
  const testDir = path.join(__dirname, '../test-data');

  // Helper function to set up player
  async function setupPlayer(page) {
    await page.goto('/');
    await page.locator('#folderPath').fill(testDir);
    await page.locator('#scanBtn').click();
    await expect(page.locator('#playVideosBtn')).toBeVisible({ timeout: 10000 });
    await page.locator('#playVideosBtn').click();
    await expect(page.locator('#playerScreen')).toBeVisible();
  }

  test.describe('Basic Play/Pause State', () => {
    test('should start playing and show pause button', async ({ page }) => {
      await setupPlayer(page);
      
      // Wait for video to load
      await page.waitForTimeout(1000);
      
      // Check button shows pause (video is playing)
      const playPauseBtn = page.locator('#playPauseBtn');
      await expect(playPauseBtn).toContainText('Pause');
      
      // Check console logs for state
      const logs = [];
      page.on('console', msg => logs.push(msg.text()));
      
      // Verify player is actually playing
      const isPlaying = await page.locator('#videoPlayer1').evaluate(el => !el.paused);
      expect(isPlaying).toBe(true);
    });

    test('should pause when clicking pause button', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Click pause
      await page.locator('#playPauseBtn').click();
      await page.waitForTimeout(300);
      
      // Check button shows play
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
      
      // Verify player is actually paused
      const isPaused = await page.locator('#videoPlayer1').evaluate(el => el.paused);
      expect(isPaused).toBe(true);
    });

    test('should resume playing after pause', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Pause
      await page.locator('#playPauseBtn').click();
      await page.waitForTimeout(300);
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
      
      // Resume
      await page.locator('#playPauseBtn').click();
      await page.waitForTimeout(300);
      await expect(page.locator('#playPauseBtn')).toContainText('Pause');
      
      // Verify playing
      const isPlaying = await page.locator('#videoPlayer1').evaluate(el => !el.paused);
      expect(isPlaying).toBe(true);
    });
  });

  test.describe('Seek/Scroll Pauses Playback', () => {
    test('should pause when dragging progress bar', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Verify playing
      await expect(page.locator('#playPauseBtn')).toContainText('Pause');
      
      // Drag progress bar
      const progressBar = page.locator('#progressBarContainer');
      const box = await progressBar.boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.up();
      
      await page.waitForTimeout(500);
      
      // Should be paused after seeking
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
      const isPaused = await page.locator('#videoPlayer1, #videoPlayer2').first().evaluate(
        el => document.querySelector('#videoPlayer1').classList.contains('active-player') 
          ? document.querySelector('#videoPlayer1').paused 
          : document.querySelector('#videoPlayer2').paused
      );
      expect(isPaused).toBe(true);
    });

    test('should pause when clicking on timeline', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Verify playing
      await expect(page.locator('#playPauseBtn')).toContainText('Pause');
      
      // Click on timeline
      const fileMarker = page.locator('.file-marker').nth(2);
      await fileMarker.click();
      
      await page.waitForTimeout(500);
      
      // Should be paused after clicking timeline
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
    });

    test('should pause when clicking file marker', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Start playing if not already
      const btn = page.locator('#playPauseBtn');
      const btnText = await btn.textContent();
      if (btnText.includes('Play')) {
        await btn.click();
        await page.waitForTimeout(300);
      }
      
      // Click different file marker
      const fileMarker = page.locator('.file-marker').nth(3);
      await fileMarker.click();
      
      await page.waitForTimeout(500);
      
      // Should be paused
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
    });
  });

  test.describe('Video Transition State', () => {
    test('should maintain playing state during automatic video transition', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Ensure playing
      const btn = page.locator('#playPauseBtn');
      const btnText = await btn.textContent();
      if (btnText.includes('Play')) {
        await btn.click();
        await page.waitForTimeout(300);
      }
      
      // Get current video number
      const videoProgress = await page.locator('#videoProgress').textContent();
      const currentVideo = parseInt(videoProgress.match(/Video (\d+)/)[1]);
      
      // Wait for transition (videos are ~2 seconds each)
      await page.waitForTimeout(3000);
      
      // Check we're on next video
      const newVideoProgress = await page.locator('#videoProgress').textContent();
      const newVideo = parseInt(newVideoProgress.match(/Video (\d+)/)[1]);
      
      if (newVideo > currentVideo) {
        // Should still be playing
        await expect(page.locator('#playPauseBtn')).toContainText('Pause');
      }
    });

    test('should maintain paused state when clicking next', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Pause
      await page.locator('#playPauseBtn').click();
      await page.waitForTimeout(300);
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
      
      // Click next (if available)
      const nextBtn = page.locator('#nextBtn');
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(500);
        
        // Should still be paused
        await expect(page.locator('#playPauseBtn')).toContainText('Play');
      }
    });

    test('should maintain paused state when clicking previous', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Go to second video first
      const fileMarker = page.locator('.file-marker').nth(1);
      await fileMarker.click();
      await page.waitForTimeout(500);
      
      // Should be paused (clicking marker pauses)
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
      
      // Click previous
      const prevBtn = page.locator('#prevBtn');
      await prevBtn.click();
      await page.waitForTimeout(500);
      
      // Should still be paused
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle end of last video correctly', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Jump to last video
      const markers = page.locator('.file-marker');
      const count = await markers.count();
      await markers.nth(count - 1).click();
      await page.waitForTimeout(500);
      
      // Play
      await page.locator('#playPauseBtn').click();
      await page.waitForTimeout(300);
      
      // Wait for video to end (2-3 seconds)
      await page.waitForTimeout(4000);
      
      // Should show play button at end
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
    });

    test('should sync overlay button with main button', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Check overlay button
      const overlayBtn = page.locator('#playPauseOverlayBtn .btn-icon');
      await expect(overlayBtn).toContainText('⏸');
      
      // Pause
      await page.locator('#playPauseBtn').click();
      await page.waitForTimeout(300);
      
      // Check both buttons
      await expect(page.locator('#playPauseBtn')).toContainText('Play');
      await expect(overlayBtn).toContainText('▶');
    });

    test('should handle rapid play/pause clicks', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      const btn = page.locator('#playPauseBtn');
      
      // Rapid clicks
      await btn.click();
      await page.waitForTimeout(100);
      await btn.click();
      await page.waitForTimeout(100);
      await btn.click();
      await page.waitForTimeout(500);
      
      // Should end in consistent state
      const btnText = await btn.textContent();
      const activePlayer = await page.evaluate(() => {
        const player1 = document.querySelector('#videoPlayer1');
        const player2 = document.querySelector('#videoPlayer2');
        return player1.classList.contains('active-player') ? player1.paused : player2.paused;
      });
      
      // Button and player should be in sync
      const shouldBePaused = btnText.includes('Play');
      expect(activePlayer).toBe(shouldBePaused);
    });

    test('should handle seek during playback correctly', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Ensure playing
      const btn = page.locator('#playPauseBtn');
      let btnText = await btn.textContent();
      if (btnText.includes('Play')) {
        await btn.click();
        await page.waitForTimeout(300);
      }
      
      // Seek while playing
      const progressBar = page.locator('#progressBarContainer');
      const box = await progressBar.boundingBox();
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
      
      await page.waitForTimeout(500);
      
      // Should be paused after seek
      await expect(btn).toContainText('Play');
      
      // Resume should work
      await btn.click();
      await page.waitForTimeout(300);
      await expect(btn).toContainText('Pause');
    });
  });

  test.describe('State Consistency', () => {
    test('should maintain state consistency across all UI elements', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Check initial state
      const mainBtn = page.locator('#playPauseBtn');
      const overlayBtn = page.locator('#playPauseOverlayBtn .btn-icon');
      
      await expect(mainBtn).toContainText('Pause');
      await expect(overlayBtn).toContainText('⏸');
      
      // Toggle to pause
      await mainBtn.click();
      await page.waitForTimeout(300);
      
      await expect(mainBtn).toContainText('Play');
      await expect(overlayBtn).toContainText('▶');
      
      // Toggle back via overlay button
      await page.locator('#playPauseOverlayBtn').click();
      await page.waitForTimeout(300);
      
      await expect(mainBtn).toContainText('Pause');
      await expect(overlayBtn).toContainText('⏸');
    });

    test('player state should match UI after seeking', async ({ page }) => {
      await setupPlayer(page);
      await page.waitForTimeout(1000);
      
      // Seek
      const fileMarker = page.locator('.file-marker').nth(2);
      await fileMarker.click();
      await page.waitForTimeout(500);
      
      // Check UI
      const btn = page.locator('#playPauseBtn');
      await expect(btn).toContainText('Play');
      
      // Check actual player state
      const isPaused = await page.evaluate(() => {
        const player1 = document.querySelector('#videoPlayer1');
        const player2 = document.querySelector('#videoPlayer2');
        return player1.classList.contains('active-player') ? player1.paused : player2.paused;
      });
      
      expect(isPaused).toBe(true);
    });
  });
});
