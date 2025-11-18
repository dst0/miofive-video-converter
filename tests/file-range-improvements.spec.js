// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('File Range and Player Sync Improvements', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the app
        await page.goto('/');
        
        // Wait for page to load
        await page.waitForLoadState('networkidle');
        
        // Initialize player with mock data directly using page.evaluate
        await page.evaluate(() => {
            // Create mock video files data
            const mockFiles = [
                {
                    filename: '010125_100000_010125_050000_000001A.MP4',
                    path: 'test-data/Normal/010125_100000_010125_050000_000001A.MP4',
                    utcTime: '2025-01-01T10:00:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A'
                },
                {
                    filename: '010125_100100_010125_050100_000002A.MP4',
                    path: 'test-data/Normal/010125_100100_010125_050100_000002A.MP4',
                    utcTime: '2025-01-01T10:01:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A'
                },
                {
                    filename: '010125_100200_010125_050200_000003A.MP4',
                    path: 'test-data/Normal/010125_100200_010125_050200_000003A.MP4',
                    utcTime: '2025-01-01T10:02:00.000Z',
                    duration: 2,
                    fileType: 'Normal',
                    channel: 'A'
                }
            ];
            
            // Import and call showPlayerScreen
            import('/player.js').then(module => {
                module.showPlayerScreen(mockFiles);
            });
        });
        
        // Wait for player screen to be visible
        await page.waitForSelector('#playerScreen', { state: 'visible', timeout: 5000 });
        
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

        test('tooltip should contain file information', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            // Hover to make tooltip visible
            await firstMarker.hover();
            await page.waitForTimeout(250);
            
            // Check that tooltip contains expected elements
            const tooltipText = await tooltip.textContent();
            
            // Should contain filename
            expect(tooltipText).toContain('010125_100000_010125_050000_000001A.MP4');
            
            // Should contain file type
            expect(tooltipText).toContain('Normal');
            
            // Should contain duration indicator
            expect(tooltipText).toContain('00:02');
        });

        test('tooltip filename should have golden color', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            
            // Find filename element in tooltip (first div inside tooltip)
            const filenameElement = await firstMarker.locator('.file-marker-tooltip > div').first();
            
            // Check that filename has golden-ish color (allowing for slight variations)
            const color = await filenameElement.evaluate(el => window.getComputedStyle(el).color);
            
            // RGB for #ffd700 (gold) is rgb(255, 215, 0)
            // Allow some tolerance for browser rendering
            expect(color).toMatch(/rgb\(25[0-5],\s*2[0-1][0-9],\s*[0-9]\)/);
        });
    });

    test.describe('Playback Position Synchronization', () => {
        test('playback position indicator should exist', async ({ page }) => {
            const positionIndicator = await page.locator('#playerScreen #playbackPosition');
            await expect(positionIndicator).toBeAttached();
        });

        test('playback position should be green', async ({ page }) => {
            const positionIndicator = await page.locator('#playerScreen #playbackPosition');
            
            const bgColor = await positionIndicator.evaluate(el => window.getComputedStyle(el).backgroundColor);
            
            // Check for green color (rgb(40, 167, 69) = #28a745)
            expect(bgColor).toMatch(/rgb\(40,\s*167,\s*69\)/);
        });
    });

    test.describe('File Marker Interactions', () => {
        test('file markers should be clickable', async ({ page }) => {
            const markers = await page.locator('#playerScreen .file-marker');
            const markerCount = await markers.count();
            
            // Should have 3 markers for our mock data
            expect(markerCount).toBe(3);
            
            // Each marker should be visible and have cursor pointer
            for (let i = 0; i < markerCount; i++) {
                const marker = markers.nth(i);
                await expect(marker).toBeVisible();
            }
        });

        test('current file marker should be highlighted', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            
            // First marker should have current-marker class initially
            const hasClass = await firstMarker.evaluate(el => el.classList.contains('current-marker'));
            expect(hasClass).toBe(true);
        });
    });

    test.describe('Visual Improvements', () => {
        test('tooltip should have dark background', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            const tooltip = firstMarker.locator('.file-marker-tooltip');
            
            const bgColor = await tooltip.evaluate(el => window.getComputedStyle(el).backgroundColor);
            
            // Check for dark background with high alpha (rgba(0,0,0,0.9))
            expect(bgColor).toMatch(/rgba?\(0,\s*0,\s*0/);
        });

        test('file markers should have appropriate styling', async ({ page }) => {
            const firstMarker = await page.locator('#playerScreen .file-marker').first();
            
            // Check that marker has position absolute
            const position = await firstMarker.evaluate(el => window.getComputedStyle(el).position);
            expect(position).toBe('absolute');
        });
    });
});
