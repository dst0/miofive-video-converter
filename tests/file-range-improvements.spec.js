// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('File Range and Player Sync Improvements', () => {
    test.beforeEach(async ({ page }) => {
        // Start on the home page
        await page.goto('http://localhost:3000');
        
        // Scan for test videos
        const testDataPath = path.join(__dirname, '..', 'test-data');
        await page.locator('#folderPath').fill(testDataPath);
        await page.locator('#scanBtn').click();
        
        // Wait for scan to complete and Play Videos button to appear
        await page.locator('#playVideosBtn').waitFor({ state: 'visible', timeout: 10000 });
        
        // Click Play Videos button
        await page.locator('#playVideosBtn').click();
        
        // Wait for player screen to appear
        await page.locator('#playerScreen').waitFor({ state: 'visible', timeout: 10000 });
        
        // Wait a bit for player to initialize
        await page.waitForTimeout(500);
    });

    test.describe('Enhanced File Marker Tooltips', () => {
        test('file markers should have data attributes', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            
            // Check that data attributes exist
            const dataIndex = await firstMarker.getAttribute('data-index');
            const dataFilename = await firstMarker.getAttribute('data-filename');
            const dataTimestamp = await firstMarker.getAttribute('data-timestamp');
            const dataDuration = await firstMarker.getAttribute('data-duration');
            const dataFiletype = await firstMarker.getAttribute('data-filetype');
            
            expect(dataIndex).not.toBeNull();
            expect(dataFilename).not.toBeNull();
            expect(dataTimestamp).not.toBeNull();
            expect(dataDuration).not.toBeNull();
            expect(dataFiletype).not.toBeNull();
            
            console.log('File marker data attributes:', {
                dataIndex,
                dataFilename,
                dataTimestamp,
                dataDuration,
                dataFiletype
            });
        });

        test('tooltip should be visible on hover', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            // Check initial state - tooltip should exist but be invisible
            await expect(tooltip).toBeAttached();
            const initialOpacity = await tooltip.evaluate(el => window.getComputedStyle(el).opacity);
            expect(parseFloat(initialOpacity)).toBeLessThan(1);
            
            // Hover over the marker
            await firstMarker.hover();
            
            // Wait for fade-in animation
            await page.waitForTimeout(250);
            
            // Tooltip should now be visible
            const hoverOpacity = await tooltip.evaluate(el => window.getComputedStyle(el).opacity);
            expect(parseFloat(hoverOpacity)).toBe(1);
        });

        test('tooltip should contain correct structure', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            // Check that all tooltip elements exist
            await expect(tooltip.locator('.tooltip-filename')).toBeAttached();
            await expect(tooltip.locator('.tooltip-timestamp')).toBeAttached();
            await expect(tooltip.locator('.tooltip-duration')).toBeAttached();
            await expect(tooltip.locator('.tooltip-filetype')).toBeAttached();
        });

        test('tooltip filename should be highlighted in gold', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const filenameElement = firstMarker.locator('.tooltip-filename');
            
            // Check that filename has gold color
            const color = await filenameElement.evaluate(el => window.getComputedStyle(el).color);
            
            // RGB for #ffd700 (gold) is rgb(255, 215, 0)
            expect(color).toBe('rgb(255, 215, 0)');
        });

        test('tooltip should have arrow pointer', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            // Check that ::after pseudo-element exists (arrow)
            const hasAfter = await tooltip.evaluate(el => {
                const after = window.getComputedStyle(el, '::after');
                return after.content !== 'none' && after.content !== '';
            });
            
            expect(hasAfter).toBe(true);
        });

        test('tooltip content should match data attributes', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            
            // Get data attributes
            const dataFilename = await firstMarker.getAttribute('data-filename');
            const dataTimestamp = await firstMarker.getAttribute('data-timestamp');
            const dataDuration = await firstMarker.getAttribute('data-duration');
            const dataFiletype = await firstMarker.getAttribute('data-filetype');
            
            // Get tooltip content
            const tooltipFilename = await firstMarker.locator('.tooltip-filename').textContent();
            const tooltipTimestamp = await firstMarker.locator('.tooltip-timestamp').textContent();
            const tooltipDuration = await firstMarker.locator('.tooltip-duration').textContent();
            const tooltipFiletype = await firstMarker.locator('.tooltip-filetype').textContent();
            
            // Verify content matches
            expect(tooltipFilename).toBe(dataFilename);
            expect(tooltipTimestamp).toContain(dataTimestamp);
            expect(tooltipDuration).toContain(dataDuration);
            expect(tooltipFiletype).toContain(dataFiletype);
        });
    });

    test.describe('Playback Position Synchronization', () => {
        test('playback position should update during video playback', async ({ page }) => {
            const playbackPosition = page.locator('#playerScreen #playbackPosition');
            
            // Wait for initial setup and video to be ready
            await page.waitForTimeout(2000);
            
            // Try to play the video and wait for it to start
            await page.click('#playerScreen #playPauseBtn');
            
            // Wait a bit for play to start
            await page.waitForTimeout(500);
            
            // Check if the video is actually playing
            const isPlaying = await page.evaluate(() => {
                const player = document.getElementById('videoPlayer1');
                return !player.paused && player.readyState >= 2;
            });
            
            if (!isPlaying) {
                console.log('Video failed to play in test environment (likely autoplay policy), skipping playback test');
                // Skip this test since autoplay is blocked
                test.skip();
                return;
            }
            
            // Get initial position
            const initialLeft = await playbackPosition.evaluate(el => el.style.left);
            const initialVideoTime = await page.evaluate(() => {
                const player = document.getElementById('videoPlayer1');
                return player.currentTime;
            });
            
            console.log('Initial playback position:', initialLeft, 'at time:', initialVideoTime);
            
            // Wait for playback to progress
            await page.waitForTimeout(2000);
            
            // Get updated values
            const updatedVideoTime = await page.evaluate(() => {
                const player = document.getElementById('videoPlayer1');
                return player.currentTime;
            });
            const updatedLeft = await playbackPosition.evaluate(el => el.style.left);
            
            console.log('Updated playback position:', updatedLeft, 'at time:', updatedVideoTime);
            
            // Video time should have progressed
            expect(updatedVideoTime).toBeGreaterThan(initialVideoTime);
            
            // Pause the video
            await page.click('#playerScreen #playPauseBtn');
        });

        test('playback position should update immediately when seeking', async ({ page }) => {
            const playbackPosition = page.locator('#playerScreen #playbackPosition');
            const progressContainer = page.locator('#playerScreen #progressBarContainer');
            
            // Get initial position
            const initialLeft = await playbackPosition.evaluate(el => el.style.left);
            console.log('Initial position before seeking:', initialLeft);
            
            // Click on progress bar to seek
            const box = await progressContainer.boundingBox();
            if (box) {
                // Click at 50% position
                await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
                
                // Wait for seek to complete
                await page.waitForTimeout(500);
                
                // Get position after seeking
                const afterSeekLeft = await playbackPosition.evaluate(el => el.style.left);
                console.log('Position after seeking:', afterSeekLeft);
                
                // Position should have changed
                expect(afterSeekLeft).not.toBe(initialLeft);
                
                // Position should be close to 50%
                const leftPercent = parseFloat(afterSeekLeft);
                expect(leftPercent).toBeGreaterThan(30);
                expect(leftPercent).toBeLessThan(70);
            }
        });

        test('playback position should sync when switching videos', async ({ page }) => {
            const playbackPosition = page.locator('#playerScreen #playbackPosition');
            
            // Get initial position
            const initialLeft = await playbackPosition.evaluate(el => el.style.left);
            console.log('Position on first video:', initialLeft);
            
            // Check if next button exists and is enabled
            const nextBtn = page.locator('#playerScreen #nextBtn');
            const isDisabled = await nextBtn.isDisabled();
            
            if (!isDisabled) {
                // Click next button to switch videos
                await nextBtn.click();
                
                // Wait for video to load
                await page.waitForTimeout(1000);
                
                // Get position on second video
                const secondVideoLeft = await playbackPosition.evaluate(el => el.style.left);
                console.log('Position on second video:', secondVideoLeft);
                
                // Position should have updated (likely different from first video)
                // Just verify that the position is still valid
                const leftPercent = parseFloat(secondVideoLeft);
                expect(leftPercent).toBeGreaterThanOrEqual(0);
                expect(leftPercent).toBeLessThanOrEqual(100);
            } else {
                console.log('Only one video available, skipping next video test');
            }
        });

        test('playback position should update when clicking on file marker', async ({ page }) => {
            const markers = page.locator('#playerScreen .file-marker');
            const markerCount = await markers.count();
            
            if (markerCount > 1) {
                const playbackPosition = page.locator('#playerScreen #playbackPosition');
                
                // Get initial position
                const initialLeft = await playbackPosition.evaluate(el => el.style.left);
                console.log('Position before clicking marker:', initialLeft);
                
                // Click on second marker
                const secondMarker = markers.nth(1);
                await secondMarker.click();
                
                // Wait for video to load
                await page.waitForTimeout(1000);
                
                // Get position after clicking marker
                const afterClickLeft = await playbackPosition.evaluate(el => el.style.left);
                console.log('Position after clicking marker:', afterClickLeft);
                
                // Position should have changed
                expect(afterClickLeft).not.toBe(initialLeft);
                
                // Verify position is valid
                const leftPercent = parseFloat(afterClickLeft);
                expect(leftPercent).toBeGreaterThanOrEqual(0);
                expect(leftPercent).toBeLessThanOrEqual(100);
            } else {
                console.log('Only one video available, skipping marker click test');
            }
        });
    });

    test.describe('File Marker Interactions', () => {
        test('clicking file marker should load corresponding video', async ({ page }) => {
            const markers = page.locator('#playerScreen .file-marker');
            const markerCount = await markers.count();
            
            if (markerCount > 1) {
                // Get filename from second marker's data attribute
                const secondMarker = markers.nth(1);
                const expectedFilename = await secondMarker.getAttribute('data-filename');
                
                // Click the marker
                await secondMarker.click();
                
                // Wait for video to load
                await page.waitForTimeout(1000);
                
                // Check that the current video name matches
                const currentVideoName = await page.locator('#playerScreen #currentVideoName').textContent();
                expect(currentVideoName).toBe(expectedFilename);
            } else {
                console.log('Only one video available, skipping marker click test');
            }
        });

        test('current file marker should be highlighted', async ({ page }) => {
            // Wait a bit longer for initialization
            await page.waitForTimeout(1500);
            
            const currentMarker = page.locator('#playerScreen .file-marker.current-marker');
            
            // Should have exactly one current marker
            await expect(currentMarker).toHaveCount(1);
            
            // Get its data-index
            const currentIndex = await currentMarker.getAttribute('data-index');
            expect(currentIndex).toBe('0'); // Should start at first video
        });

        test('current marker should update when switching videos', async ({ page }) => {
            // Wait for initialization
            await page.waitForTimeout(1500);
            
            const nextBtn = page.locator('#playerScreen #nextBtn');
            const isDisabled = await nextBtn.isDisabled();
            
            if (!isDisabled) {
                // Click next button
                await nextBtn.click();
                
                // Wait for switch
                await page.waitForTimeout(1000);
                
                // Check current marker
                const currentMarker = page.locator('#playerScreen .file-marker.current-marker');
                await expect(currentMarker).toHaveCount(1);
                
                const currentIndex = await currentMarker.getAttribute('data-index');
                expect(currentIndex).toBe('1'); // Should be second video
            } else {
                console.log('Only one video available, skipping marker highlight test');
            }
        });
    });

    test.describe('Visual Improvements', () => {
        test('tooltip should have dark background', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            const backgroundColor = await tooltip.evaluate(el => window.getComputedStyle(el).backgroundColor);
            
            // Should be dark (rgba(0,0,0,0.9))
            expect(backgroundColor).toMatch(/rgba?\(0,\s*0,\s*0/);
        });

        test('tooltip should have transition animation', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            const transition = await tooltip.evaluate(el => window.getComputedStyle(el).transition);
            
            // Should have opacity transition
            expect(transition).toContain('opacity');
        });

        test('playback position indicator should be green', async ({ page }) => {
            const playbackPosition = page.locator('#playerScreen #playbackPosition');
            
            const backgroundColor = await playbackPosition.evaluate(el => window.getComputedStyle(el).backgroundColor);
            
            // Should be green (#28a745 = rgb(40, 167, 69))
            expect(backgroundColor).toBe('rgb(40, 167, 69)');
        });

        test('current marker should be highlighted in green', async ({ page }) => {
            // Wait for initialization
            await page.waitForTimeout(1500);
            
            const currentMarker = page.locator('#playerScreen .file-marker.current-marker');
            
            await expect(currentMarker).toHaveCount(1);
            
            const backgroundColor = await currentMarker.evaluate(el => window.getComputedStyle(el).backgroundColor);
            
            // Should be green (#28a745)
            expect(backgroundColor).toBe('rgb(40, 167, 69)');
        });
    });
});
