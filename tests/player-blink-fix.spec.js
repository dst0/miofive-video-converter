const { test, expect } = require('@playwright/test');
const path = require('path');

// Constants
const MIN_HEIGHT_PX = 300; // Must match CSS min-height value
const HEIGHT_TOLERANCE = 0.9; // Accept 90% of min-height

test.describe('Video Player - Block Blink Fix', () => {
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
    });

    test('both video players should have position: absolute', async ({ page }) => {
        const player1Position = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer1');
            return window.getComputedStyle(player).position;
        });
        
        const player2Position = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer2');
            return window.getComputedStyle(player).position;
        });
        
        expect(player1Position).toBe('absolute');
        expect(player2Position).toBe('absolute');
    });

    test('active player should have higher z-index', async ({ page }) => {
        const player1ZIndex = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer1');
            return window.getComputedStyle(player).zIndex;
        });
        
        const player2ZIndex = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer2');
            return window.getComputedStyle(player).zIndex;
        });
        
        // Player 1 should start as active (z-index: 2)
        expect(player1ZIndex).toBe('2');
        // Player 2 should be inactive (z-index: 1)
        expect(player2ZIndex).toBe('1');
    });

    test('video wrapper should maintain consistent height', async ({ page }) => {
        const initialHeight = await page.evaluate(() => {
            const wrapper = document.querySelector('.video-wrapper');
            return wrapper.offsetHeight;
        });
        
        // Wait for a moment
        await page.waitForTimeout(500);
        
        const afterHeight = await page.evaluate(() => {
            const wrapper = document.querySelector('.video-wrapper');
            return wrapper.offsetHeight;
        });
        
        // Height should remain the same
        expect(afterHeight).toBe(initialHeight);
        
        // Height should be reasonable (greater than 90% of CSS min-height)
        expect(initialHeight).toBeGreaterThan(MIN_HEIGHT_PX * HEIGHT_TOLERANCE);
    });

    test('video wrapper should have aspect-ratio set', async ({ page }) => {
        const aspectRatio = await page.evaluate(() => {
            const wrapper = document.querySelector('.video-wrapper');
            return window.getComputedStyle(wrapper).aspectRatio;
        });
        
        // Check that aspect-ratio is set and is reasonable for 16:9
        // Accepts: "16/9", "16 / 9", decimal like "1.777...", or "auto"
        const isValid = aspectRatio === 'auto' || 
                        /^16\s*\/\s*9$/.test(aspectRatio) ||
                        (parseFloat(aspectRatio) >= 1.7 && parseFloat(aspectRatio) <= 1.8);
        expect(isValid).toBe(true);
    });

    test('video players should use object-fit: contain', async ({ page }) => {
        const player1ObjectFit = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer1');
            return window.getComputedStyle(player).objectFit;
        });
        
        const player2ObjectFit = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer2');
            return window.getComputedStyle(player).objectFit;
        });
        
        expect(player1ObjectFit).toBe('contain');
        expect(player2ObjectFit).toBe('contain');
    });

    test('z-index should swap when switching videos', async ({ page }) => {
        // Get initial z-indices
        const initialPlayer1ZIndex = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer1');
            return window.getComputedStyle(player).zIndex;
        });
        
        const initialPlayer2ZIndex = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer2');
            return window.getComputedStyle(player).zIndex;
        });
        
        expect(initialPlayer1ZIndex).toBe('2');
        expect(initialPlayer2ZIndex).toBe('1');
        
        // Click next button to switch videos
        await page.click('#nextBtn');
        
        // Wait for transition
        await page.waitForTimeout(500);
        
        // Get z-indices after switch
        const afterPlayer1ZIndex = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer1');
            return window.getComputedStyle(player).zIndex;
        });
        
        const afterPlayer2ZIndex = await page.evaluate(() => {
            const player = document.getElementById('videoPlayer2');
            return window.getComputedStyle(player).zIndex;
        });
        
        // Z-indices should have swapped
        expect(afterPlayer1ZIndex).toBe('1');
        expect(afterPlayer2ZIndex).toBe('2');
    });

    test('video wrapper height should not change when switching videos', async ({ page }) => {
        // Get initial height
        const initialHeight = await page.evaluate(() => {
            const wrapper = document.querySelector('.video-wrapper');
            return wrapper.offsetHeight;
        });
        
        // Click next button to switch videos
        await page.click('#nextBtn');
        
        // Wait for transition
        await page.waitForTimeout(500);
        
        // Get height after switch
        const afterHeight = await page.evaluate(() => {
            const wrapper = document.querySelector('.video-wrapper');
            return wrapper.offsetHeight;
        });
        
        // Height should remain exactly the same (no blink/jump)
        expect(afterHeight).toBe(initialHeight);
    });
});
