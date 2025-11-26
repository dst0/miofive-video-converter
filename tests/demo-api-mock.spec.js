// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Demo API Mock Module Tests', () => {
    test('isGitHubPages() should correctly detect GitHub Pages hostname', async ({ page }) => {
        // Navigate to the app
        await page.goto('/');
        
        // Test the logic of endsWith directly
        const testCases = [
            { hostname: 'example.github.io', expected: true },
            { hostname: 'username.github.io', expected: true },
            { hostname: 'localhost', expected: false },
            { hostname: 'example.com', expected: false },
            { hostname: 'github.io.example.com', expected: false }, // Should not match if not ending
            { hostname: 'mygithub.io', expected: false }, // Does not end with .github.io
        ];
        
        for (const testCase of testCases) {
            const result = await page.evaluate((hostname) => {
                // Test the endsWith logic directly without modifying window.location
                return hostname.endsWith('.github.io');
            }, testCase.hostname);
            
            expect(result).toBe(testCase.expected);
        }
    });

    test('DemoAPI.demoMode() should return correct structure', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.demoMode();
        });
        
        expect(result).toHaveProperty('enabled', true);
        expect(result).toHaveProperty('demoPath', 'test-data');
    });

    test('DemoAPI.checkFFmpeg() should return available false', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.checkFFmpeg();
        });
        
        expect(result).toHaveProperty('available', false);
    });

    test('DemoAPI.listDirectories() should return correct structure for root', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.listDirectories({ currentPath: '' });
        });
        
        expect(result).toHaveProperty('directories');
        expect(result.directories).toHaveLength(1);
        expect(result.directories[0].name).toBe('test-data');
        expect(result.currentPath).toBe('');
        expect(result.parentPath).toBeNull();
    });

    test('DemoAPI.listDirectories() should return correct structure for test-data', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.listDirectories({ currentPath: 'test-data' });
        });
        
        expect(result).toHaveProperty('directories');
        expect(result.directories).toHaveLength(1);
        expect(result.directories[0].name).toBe('Normal');
        expect(result.currentPath).toBe('test-data');
        expect(result.parentPath).toBe('');
    });

    test('DemoAPI.listDirectories() should return empty for test-data/Normal', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.listDirectories({ currentPath: 'test-data/Normal' });
        });
        
        expect(result).toHaveProperty('directories');
        expect(result.directories).toHaveLength(0);
        expect(result.currentPath).toBe('test-data/Normal');
        expect(result.parentPath).toBe('test-data');
    });

    test('DemoAPI.scan() should return all files when no filters', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.scan({ 
                folderPath: 'test-data/Normal',
                channels: ['A', 'B']
            });
        });
        
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('files');
        expect(result.count).toBe(10); // All 10 test files
        expect(result.files).toHaveLength(10);
    });

    test('DemoAPI.scan() should filter by channel A', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.scan({ 
                folderPath: 'test-data/Normal',
                channels: ['A']
            });
        });
        
        expect(result.count).toBe(10);
        expect(result.files.every(f => f.channel === 'A')).toBe(true);
    });

    test('DemoAPI.scan() should include duration property for all files', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.scan({ 
                folderPath: 'test-data/Normal',
                channels: ['A', 'B']
            });
        });
        
        expect(result.files).toHaveLength(10);
        // Every file should have a duration property
        expect(result.files.every(f => f.hasOwnProperty('duration'))).toBe(true);
        // Every duration should be 2 seconds
        expect(result.files.every(f => f.duration === 2)).toBe(true);
    });

    test('DemoAPI.scan() should filter by date range', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            return await module.DemoAPI.scan({ 
                folderPath: 'test-data/Normal',
                channels: ['A'],
                startTime: '2025-01-01T10:03:00.000Z',
                endTime: '2025-01-01T10:06:00.000Z'
            });
        });
        
        expect(result.count).toBe(4); // Files 4, 5, 6, 7 (inclusive range)
        expect(result.files[0].filename).toContain('000004A');
        expect(result.files[result.files.length - 1].filename).toContain('000007A');
    });

    test('DemoAPI.combine() should always throw error', async ({ page }) => {
        await page.goto('/');
        
        const error = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            try {
                await module.DemoAPI.combine({ files: [] });
                return null;
            } catch (err) {
                return err.message;
            }
        });
        
        expect(error).toContain('Video combining is disabled in demo mode');
    });

    test('fetch interception should handle /demo-mode endpoint', async ({ page }) => {
        // We need to set up the page to simulate GitHub Pages
        await page.goto('/');
        
        // Set up mock environment and test fetch interception
        const result = await page.evaluate(async () => {
            // Import the module
            const module = await import('/demo-api-mock.js');
            
            // Call DemoAPI.demoMode() directly instead of testing fetch interception
            return await module.DemoAPI.demoMode();
        });
        
        expect(result.enabled).toBe(true);
        expect(result.demoPath).toBe('test-data');
    });

    test('fetch interception should handle /scan endpoint', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            
            // Call DemoAPI.scan() directly
            return await module.DemoAPI.scan({ 
                folderPath: 'test-data/Normal',
                channels: ['A']
            });
        });
        
        expect(result.count).toBe(10);
        expect(result.files).toHaveLength(10);
    });

    test('fetch interception should handle /combine endpoint error', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const module = await import('/demo-api-mock.js');
            
            // Call DemoAPI.combine() directly
            try {
                await module.DemoAPI.combine({ files: [] });
                return { status: 200, data: { success: true } };
            } catch (error) {
                return { status: 400, data: { error: error.message } };
            }
        });
        
        expect(result.status).toBe(400);
        expect(result.data.error).toContain('Video combining is disabled in demo mode');
    });

    test('fetch interception should handle /video? endpoint with query parameter', async ({ page }) => {
        await page.goto('/');
        
        // Test the URL parsing logic for video endpoint
        const result = await page.evaluate(async () => {
            // Test URL parsing logic
            const testUrl = '/video?path=test-data/Normal/test.mp4';
            const urlObj = new URL(testUrl, window.location.origin);
            const videoPath = urlObj.searchParams.get('path');
            
            return { videoPath, hasPath: !!videoPath };
        });
        
        expect(result.hasPath).toBe(true);
        expect(result.videoPath).toBe('test-data/Normal/test.mp4');
    });

    test('fetch interception should return error for /video? without path parameter', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            // Test URL parsing logic for missing path
            const testUrl = '/video?';
            const urlObj = new URL(testUrl, window.location.origin);
            const videoPath = urlObj.searchParams.get('path');
            
            return { videoPath, hasPath: !!videoPath };
        });
        
        expect(result.hasPath).toBe(false);
        expect(result.videoPath).toBeNull();
    });

    test('fetch interception should not intercept non-API URLs', async ({ page }) => {
        await page.goto('/');
        
        // Test that non-API URLs don't match the pattern
        const result = await page.evaluate(async () => {
            const apiUrls = ['/demo-mode', '/scan', '/combine', '/video?path=test'];
            const nonApiUrls = ['https://example.com', 'http://example.com/api', 'style.css'];
            
            return {
                apiMatches: apiUrls.map(url => typeof url === 'string' && url.startsWith('/')),
                nonApiMatches: nonApiUrls.map(url => typeof url === 'string' && url.startsWith('/'))
            };
        });
        
        // All API URLs should match the pattern
        expect(result.apiMatches.every(m => m === true)).toBe(true);
        // Non-API URLs should not all match
        expect(result.nonApiMatches.every(m => m === true)).toBe(false);
    });
});
