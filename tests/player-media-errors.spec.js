const {test, expect} = require('@playwright/test');
const path = require('node:path');

const mediaPath = path.join(__dirname, '..', 'test-data', 'Normal');

test('real failed /video request for active media pauses playback and displays inline recovery guidance', async ({page}) => {
    await page.route('**/video?*', (route) => route.abort());
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
});

test('active error after initial readiness pauses playback, updates UI, and displays inline guidance', async ({page}) => {
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#playPauseBtn')).toHaveText('⏸ Pause');
    await expect(page.locator('#playerErrorMessage')).toBeHidden();

    // Trigger an error event on the active video element during active playback
    await page.locator('video.active-player').evaluate((v) => v.dispatchEvent(new Event('error')));

    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
});

test('failed cross-clip readiness during seek clears pending seek and pauses UI', async ({page}) => {
    let secondClipRequested = false;
    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (filePath.includes('000002A.MP4')) {
            secondClipRequested = true;
            return route.abort();
        }
        return route.continue();
    });

    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

    // Seek into the second clip (3.0s is 1.0s into clip 2) using exact module export
    await page.evaluate(async () => {
        const {seekToGlobalTime} = await import('/player.js?v=export-range-1');
        seekToGlobalTime(3.0);
    });

    await expect.poll(() => secondClipRequested).toBe(true);
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of 10');
    await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');
});

test('readiness timeout on hung source request triggers recovery without relying on player.error', async ({page}) => {
    let clip10Requested = false;
    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (filePath.includes('000010A.MP4')) {
            clip10Requested = true;
            // Hold request indefinitely without sending error or data
            return;
        }
        return route.continue();
    });

    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

    // Install clock before seek so we can advance time deterministically
    await page.clock.install();

    // Seek to clip 10 (~18.5s)
    await page.evaluate(async () => {
        const {seekToGlobalTime} = await import('/player.js?v=export-range-1');
        seekToGlobalTime(18.5);
    });

    await expect.poll(() => clip10Requested).toBe(true);

    // Advance 10.5s to trigger the 10s readiness timeout deterministically
    await page.clock.fastForward(10500);

    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
    await expect(page.locator('#videoProgress')).toContainText('Video 10 of 10');
    await expect(page.locator('#currentVideoName')).toContainText('000010A.MP4');
});

test('paused Next into held source times out and displays recovery without autoplay', async ({page}) => {
    let secondClipRequested = false;
    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (filePath.includes('000002A.MP4')) {
            secondClipRequested = true;
            // Hold request indefinitely without returning data or error
            return;
        }
        return route.continue();
    });

    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

    // Wait for preloader to request second clip
    await expect.poll(() => secondClipRequested).toBe(true);

    // Pause active playback
    await page.locator('#playPauseBtn').click();
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);

    // Install clock to control timeout deterministically
    await page.clock.install();

    // User navigates to next video while paused
    await page.locator('#nextBtn').click();

    // Paused intent is preserved (does not autoplay)
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');

    // Advance 10.5s to trigger the 10s readiness timeout deterministically
    await page.clock.fastForward(10500);

    // Bounded wait timeout triggers recovery guidance without autoplay
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of 10');
    await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');
});

test('preloader child-source error with absent video.error then paused Next eventually shows recovery without autoplay', async ({page}) => {
    let secondClipRequested = false;
    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (filePath.includes('000002A.MP4')) {
            secondClipRequested = true;
            return route.abort();
        }
        return route.continue();
    });

    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

    // Wait for preloader request for second clip to abort
    await expect.poll(() => secondClipRequested).toBe(true);

    // Confirm child-source error occurred on inactive preloader with absent video.error
    const preloaderState = await page.locator('video:not(.active-player)').evaluate((v) => {
        v.querySelector('source')?.dispatchEvent(new Event('error'));
        return {videoError: v.error, readyState: v.readyState};
    });
    expect(preloaderState.videoError).toBeNull();
    expect(preloaderState.readyState).toBeLessThan(2);

    // Pause active playback
    await page.locator('#playPauseBtn').click();
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);

    // Install clock to control timeout deterministically
    await page.clock.install();

    // User navigates to next video while paused
    await page.locator('#nextBtn').click();

    // Paused intent is preserved (does not autoplay)
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');

    // Advance 10.5s to trigger the 10s readiness timeout deterministically
    await page.clock.fastForward(10500);

    // Bounded wait timeout triggers recovery guidance without autoplay
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of 10');
    await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');
});

test('recycled source stale callback does not cancel or display error on newer selected video', async ({page}) => {
    let clip3Requested = false;
    let clip3Release;
    const clip3Held = new Promise((resolve) => { clip3Release = resolve; });

    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (filePath.includes('000003A.MP4')) {
            clip3Requested = true;
            await clip3Held;
            return route.abort();
        }
        return route.continue();
    });

    try {
        await page.goto('/');
        await page.locator('#folderPath').fill(mediaPath);
        await page.locator('#scanBtn').click();
        await expect(page.locator('.file-list')).toBeVisible();

        await page.locator('#playVideosBtn').click();
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

        // Pause to control test flow deterministically
        await page.locator('#playPauseBtn').click();
        await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');

        // Seek to clip 3 (000003A.MP4, index 2), whose request is held
        await page.evaluate(async () => {
            const {seekToGlobalTime} = await import('/player.js?v=export-range-1');
            seekToGlobalTime(4.5);
        });

        // Prove held request occurred
        await expect.poll(() => clip3Requested).toBe(true);
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.dataset.videoIndex)).toBe('2');

        // While clip 3 request is still held on active player, recycle active player by seeking to clip 5 (000005A.MP4, index 4)
        await page.evaluate(async () => {
            const {seekToGlobalTime} = await import('/player.js?v=export-range-1');
            seekToGlobalTime(8.5);
        });

        // Prove old source was actually recycled to clip 5 (index 4)
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.dataset.videoIndex)).toBe('4');

        // Now release held clip 3 request to fail (stale callback from recycled source)
        clip3Release();

        // Verify clip 5 achieves readiness and plays without being interrupted or showing clip 3's error
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
        await expect(page.locator('#playerErrorMessage')).toBeHidden();

        // Start playback on clip 5
        await page.locator('#playPauseBtn').click();
        await expect(page.locator('#playPauseBtn')).toHaveText('⏸ Pause');
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(false);
        await expect(page.locator('#playerErrorMessage')).toBeHidden();
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.dataset.videoIndex)).toBe('4');
    } finally {
        clip3Release?.();
    }
});

test('stale errors from inactive preloader do not interrupt active playback or display guidance', async ({page}) => {
    let preloadAborted = false;
    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        // Preload of second video fails
        if (filePath.includes('000002A.MP4')) {
            await route.abort();
            preloadAborted = true;
            return;
        }
        return route.continue();
    });

    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#playPauseBtn')).toHaveText('⏸ Pause');

    // Wait for actual preload request abort observation instead of fixed 500ms sleep
    await expect.poll(() => preloadAborted).toBe(true);
    await expect(page.locator('#playPauseBtn')).toHaveText('⏸ Pause');
    await expect(page.locator('#playerErrorMessage')).toBeHidden();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(false);
});

test('stale errors after Back to Main do not display guidance or interrupt app', async ({page}) => {
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect(page.locator('#playerScreen')).toBeVisible();

    await page.locator('#backBtn').click();
    await expect(page.locator('#mainScreen')).toBeVisible();
    await expect(page.locator('#playerScreen')).toBeHidden();

    // Dispatch error events on both video elements after navigation back
    await page.evaluate(() => {
        document.getElementById('videoPlayer1')?.dispatchEvent(new Event('error'));
        document.getElementById('videoPlayer2')?.dispatchEvent(new Event('error'));
    });

    await expect(page.locator('#playerErrorMessage')).toBeHidden();
    await expect(page.locator('#mainScreen')).toBeVisible();
});

test('same-clip seeks while pending retain latest intent with paused control', async ({page}) => {
    let secondClipRequested = false;
    let secondClipRelease;
    const secondClipHeld = new Promise((resolve) => { secondClipRelease = resolve; });

    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (filePath.includes('000002A.MP4')) {
            secondClipRequested = true;
            await secondClipHeld;
        }
        return route.continue();
    });

    try {
        await page.goto('/');
        await page.locator('#folderPath').fill(mediaPath);
        await page.locator('#scanBtn').click();
        await expect(page.locator('.file-list')).toBeVisible();

        await page.locator('#playVideosBtn').click();
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

        // Pause to avoid 2-second playback races and freeze progression
        await page.locator('#playPauseBtn').click();
        await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');

        // First seek to second clip at offset 2.5s (0.5s into clip 2)
        await page.evaluate(async () => {
            const {seekToGlobalTime} = await import('/player.js?v=export-range-1');
            seekToGlobalTime(2.5);
        });

        await expect.poll(() => secondClipRequested).toBe(true);

        // While pending readiness of clip 2, seek again to 3.5s (1.5s into clip 2)
        await page.evaluate(async () => {
            const {seekToGlobalTime} = await import('/player.js?v=export-range-1');
            seekToGlobalTime(3.5);
        });

        // Release the held request
        secondClipRelease();

        // Once ready, the player should be paused with currentTime close to 1.5s (not 0.5s)
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
        await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);

        // Use expect.poll for final exact same-clip seek target
        await expect.poll(async () => {
            const ct = await page.locator('video.active-player').evaluate((v) => v.currentTime);
            return Math.abs(ct - 1.5);
        }).toBeLessThan(0.1);
    } finally {
        secondClipRelease?.();
    }
});

test('subsequent valid selection clears obsolete error guidance and resumes normal playback under paused-intent', async ({page}) => {
    let blockFirstClip = true;
    await page.route('**/video?*', async (route) => {
        const url = new URL(route.request().url());
        const filePath = url.searchParams.get('path') || '';
        if (blockFirstClip && filePath.includes('000001A.MP4')) {
            return route.abort();
        }
        return route.continue();
    });

    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    // First clip fails to load
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');

    // Allow second clip and navigate to it via next button
    blockFirstClip = false;
    await page.locator('#nextBtn').click();

    // Paused-intent: Next while paused remains paused, error guidance is cleared
    await expect(page.locator('#playerErrorMessage')).toBeHidden();
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');

    // User explicitly presses Play
    await page.locator('#playPauseBtn').click();
    await expect(page.locator('#playPauseBtn')).toHaveText('⏸ Pause');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(false);
    await expect(page.locator('#playerErrorMessage')).toBeHidden();
});

test('paused Next with inactive already-ready player and modeled error shows recovery guidance without autoplay', async ({page}) => {
    await page.goto('/');
    await page.locator('#folderPath').fill(mediaPath);
    await page.locator('#scanBtn').click();
    await expect(page.locator('.file-list')).toBeVisible();

    await page.locator('#playVideosBtn').click();
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

    // Wait until inactive preloader has buffered frames and reached readyState >= HAVE_CURRENT_DATA (2)
    await expect.poll(() => page.locator('video:not(.active-player)').evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(2);

    // Pause active playback
    await page.locator('#playPauseBtn').click();
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);

    // Model network error on inactive buffered player via test-local native property override (retaining readyState >= 2)
    await page.locator('video:not(.active-player)').evaluate((v) => {
        Object.defineProperty(v, 'error', {
            configurable: true,
            get: () => ({code: MediaError.MEDIA_ERR_NETWORK, message: 'Network error after buffering'}),
        });
    });

    // Verify readyState >= 2 and error is present on inactive player before switching
    const preloaderState = await page.locator('video:not(.active-player)').evaluate((v) => ({
        readyState: v.readyState,
        hasError: Boolean(v.error),
    }));
    expect(preloaderState.readyState).toBeGreaterThanOrEqual(2);
    expect(preloaderState.hasError).toBe(true);

    // Paused Next navigation: old fast path would consider readyState >= 2 sufficient and ignore error when paused
    await page.locator('#nextBtn').click();

    // With !newActivePlayer.error in ready check, switchToNextVideo diverts to waitForPlayerSource which takes onFailure
    await expect(page.locator('#playerErrorMessage')).toBeVisible();
    await expect(page.locator('#playerErrorMessage')).toContainText('Playback unavailable');
    await expect(page.locator('#playPauseBtn')).toHaveText('▶ Play');
    await expect.poll(() => page.locator('video.active-player').evaluate((v) => v.paused)).toBe(true);
    await expect(page.locator('#videoProgress')).toContainText('Video 2 of 10');
    await expect(page.locator('#currentVideoName')).toContainText('000002A.MP4');
});
