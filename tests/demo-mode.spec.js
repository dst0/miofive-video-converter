const { test, expect } = require('@playwright/test');

test.describe('Demo Mode API Tests', () => {
    // These tests verify the demo mode API endpoints exist and work correctly
    // They don't test demo mode enabled behavior, as the default test server runs without DEMO_MODE
    
    test('GET /demo-mode endpoint exists and returns status', async ({ request }) => {
        const response = await request.get('http://localhost:3000/demo-mode');
        expect(response.ok()).toBeTruthy();
        
        const data = await response.json();
        expect(data).toHaveProperty('enabled');
        expect(data).toHaveProperty('demoPath');
        // In normal test mode, demo should be disabled
        expect(data.enabled).toBe(false);
    });
});
