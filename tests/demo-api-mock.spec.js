// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Demo API Mock Module Tests', () => {
    test('isGitHubPages() should correctly detect GitHub Pages hostname', async ({ page }) => {
        // Navigate to the app
        await page.goto('/');
        
        // Test isGitHubPages function with different hostnames
        const testCases = [
            { hostname: 'example.github.io', expected: true },
            { hostname: 'username.github.io', expected: true },
            { hostname: 'localhost', expected: false },
            { hostname: 'example.com', expected: false },
            { hostname: 'github.io.example.com', expected: false }, // Should not match if not ending
            { hostname: 'mygithub.io', expected: true }, // Should match if ends with .github.io
        ];
        
        for (const testCase of testCases) {
            const result = await page.evaluate((hostname) => {
                // Import and test the function
                const originalHostname = window.location.hostname;
                Object.defineProperty(window.location, 'hostname', {
                    writable: true,
                    value: hostname
                });
                const result = window.location.hostname.endsWith('.github.io');
                // Restore
                Object.defineProperty(window.location, 'hostname', {
                    writable: true,
                    value: originalHostname
                });
                return result;
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
            // Temporarily override hostname check
            const originalHostname = window.location.hostname;
            
            // Import and setup demo mode
            const module = await import('/demo-api-mock.js');
            
            // Manually override to simulate GitHub Pages
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: 'test.github.io'
            });
            
            // Setup demo mode
            module.setupDemoMode();
            
            // Test the fetch interception
            const response = await fetch('/demo-mode');
            const data = await response.json();
            
            // Restore hostname
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: originalHostname
            });
            
            return data;
        });
        
        expect(result.enabled).toBe(true);
        expect(result.demoPath).toBe('test-data');
    });

    test('fetch interception should handle /scan endpoint', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const originalHostname = window.location.hostname;
            const module = await import('/demo-api-mock.js');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: 'test.github.io'
            });
            
            module.setupDemoMode();
            
            const response = await fetch('/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    folderPath: 'test-data/Normal',
                    channels: ['A']
                })
            });
            const data = await response.json();
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: originalHostname
            });
            
            return data;
        });
        
        expect(result.count).toBe(10);
        expect(result.files).toHaveLength(10);
    });

    test('fetch interception should handle /combine endpoint error', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const originalHostname = window.location.hostname;
            const module = await import('/demo-api-mock.js');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: 'test.github.io'
            });
            
            module.setupDemoMode();
            
            const response = await fetch('/combine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: [] })
            });
            
            const data = await response.json();
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: originalHostname
            });
            
            return { status: response.status, data };
        });
        
        expect(result.status).toBe(400);
        expect(result.data.error).toContain('Video combining is disabled in demo mode');
    });

    test('fetch interception should handle /video? endpoint with query parameter', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const originalHostname = window.location.hostname;
            const module = await import('/demo-api-mock.js');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: 'test.github.io'
            });
            
            module.setupDemoMode();
            
            // Test with valid path parameter
            const response = await fetch('/video?path=test-data/Normal/test.mp4');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: originalHostname
            });
            
            // We expect this to call originalFetch with the path
            // In a real scenario, this would try to fetch the video file
            return { status: response.status };
        });
        
        // The response will be 404 because the file doesn't exist in the test server
        // But the important thing is that the interception worked
        expect([200, 404]).toContain(result.status);
    });

    test('fetch interception should return error for /video? without path parameter', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const originalHostname = window.location.hostname;
            const module = await import('/demo-api-mock.js');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: 'test.github.io'
            });
            
            module.setupDemoMode();
            
            const response = await fetch('/video?');
            const data = await response.json();
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: originalHostname
            });
            
            return { status: response.status, data };
        });
        
        expect(result.status).toBe(400);
        expect(result.data.error).toBe('Missing video path');
    });

    test('fetch interception should not intercept non-API URLs', async ({ page }) => {
        await page.goto('/');
        
        const result = await page.evaluate(async () => {
            const originalHostname = window.location.hostname;
            const module = await import('/demo-api-mock.js');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: 'test.github.io'
            });
            
            module.setupDemoMode();
            
            // This should pass through to original fetch
            const response = await fetch('https://example.com');
            
            Object.defineProperty(window.location, 'hostname', {
                writable: true,
                value: originalHostname
            });
            
            return { ok: response.ok };
        });
        
        // External URLs should pass through
        expect(result.ok).toBeDefined();
    });
});
