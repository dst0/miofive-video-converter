/**
 * Demo API Mock Module
 * Provides mock implementations of all backend API calls for GitHub Pages deployment
 */

// Check if we're running on GitHub Pages
export function isGitHubPages() {
    // More secure check: hostname must END with .github.io
    return window.location.hostname.endsWith('.github.io');
}

// Mock test data - simulating the test-data folder structure
const DEMO_BASE_PATH = 'test-data';
const DEMO_NORMAL_PATH = `${DEMO_BASE_PATH}/Normal`;

// Mock video files list (matching actual test-data/Normal folder)
const MOCK_VIDEO_FILES = [
    {
        filename: '010125_100000_010125_050000_000001A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100000_010125_050000_000001A.MP4`,
        utcTime: '2025-01-01T10:00:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100100_010125_050100_000002A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100100_010125_050100_000002A.MP4`,
        utcTime: '2025-01-01T10:01:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100200_010125_050200_000003A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100200_010125_050200_000003A.MP4`,
        utcTime: '2025-01-01T10:02:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100300_010125_050300_000004A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100300_010125_050300_000004A.MP4`,
        utcTime: '2025-01-01T10:03:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100400_010125_050400_000005A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100400_010125_050400_000005A.MP4`,
        utcTime: '2025-01-01T10:04:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100500_010125_050500_000006A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100500_010125_050500_000006A.MP4`,
        utcTime: '2025-01-01T10:05:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100600_010125_050600_000007A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100600_010125_050600_000007A.MP4`,
        utcTime: '2025-01-01T10:06:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100700_010125_050700_000008A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100700_010125_050700_000008A.MP4`,
        utcTime: '2025-01-01T10:07:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100800_010125_050800_000009A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100800_010125_050800_000009A.MP4`,
        utcTime: '2025-01-01T10:08:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    },
    {
        filename: '010125_100900_010125_050900_000010A.MP4',
        path: `${DEMO_NORMAL_PATH}/010125_100900_010125_050900_000010A.MP4`,
        utcTime: '2025-01-01T10:09:00.000Z',
        fileType: 'Normal',
        channel: 'A',
        duration: 2
    }
];

/**
 * Mock API class that mimics backend endpoints
 */
export class DemoAPI {
    /**
     * Mock /demo-mode endpoint
     */
    static async demoMode() {
        return {
            enabled: true,
            demoPath: DEMO_BASE_PATH
        };
    }

    /**
     * Mock /check-ffmpeg endpoint
     */
    static async checkFFmpeg() {
        return {
            available: false // FFmpeg not available in demo mode
        };
    }

    /**
     * Mock /list-directories endpoint
     */
    static async listDirectories(data) {
        const { currentPath = '' } = data;

        // Root level - show test-data
        if (!currentPath || currentPath === '') {
            return {
                directories: [
                    {
                        name: 'test-data',
                        path: 'test-data',
                        fullPath: 'test-data'
                    }
                ],
                currentPath: '',
                parentPath: null
            };
        }

        // test-data level - show Normal folder
        if (currentPath === 'test-data') {
            return {
                directories: [
                    {
                        name: 'Normal',
                        path: 'test-data/Normal',
                        fullPath: 'test-data/Normal'
                    }
                ],
                currentPath: 'test-data',
                parentPath: ''
            };
        }

        // Normal folder - no subdirectories
        if (currentPath === 'test-data/Normal') {
            return {
                directories: [],
                currentPath: 'test-data/Normal',
                parentPath: 'test-data'
            };
        }

        // Default - no directories
        return {
            directories: [],
            currentPath: currentPath,
            parentPath: ''
        };
    }

    /**
     * Mock /scan endpoint
     */
    static async scan(data) {
        const { channels = ['A', 'B'], startTime, endTime } = data;

        // Filter files by channel
        let files = MOCK_VIDEO_FILES.filter(file => {
            return channels.includes(file.channel);
        });

        // Filter by date range if provided
        if (startTime) {
            const start = new Date(startTime).getTime();
            files = files.filter(file => new Date(file.utcTime).getTime() >= start);
        }

        if (endTime) {
            const end = new Date(endTime).getTime();
            files = files.filter(file => new Date(file.utcTime).getTime() <= end);
        }

        return {
            count: files.length,
            files: files
        };
    }

    /**
     * Mock /combine endpoint - always fails in demo mode
     */
    static async combine(data) {
        // Combining is disabled in demo mode
        throw new Error('Video combining is disabled in demo mode. Download the full application to use this feature.');
    }

    /**
     * Mock /video endpoint - returns relative path to video file
     */
    static videoUrl(path) {
        // In GitHub Pages, videos are served as static files
        // We need to construct the relative URL
        return path;
    }
}

/**
 * Intercept fetch calls and route to mock API when on GitHub Pages
 */
export function setupDemoMode() {
    if (!isGitHubPages()) {
        return; // Not on GitHub Pages, use real API
    }

    // Store original fetch
    const originalFetch = window.fetch;

    // Override fetch to intercept API calls
    window.fetch = async function(url, options) {
        // Only intercept relative URLs (API calls)
        if (typeof url === 'string' && url.startsWith('/')) {
            try {
                // Route to appropriate mock endpoint
                if (url === '/demo-mode') {
                    const data = await DemoAPI.demoMode();
                    return new Response(JSON.stringify(data), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                if (url === '/check-ffmpeg') {
                    const data = await DemoAPI.checkFFmpeg();
                    return new Response(JSON.stringify(data), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                if (url === '/list-directories' && options?.method === 'POST') {
                    const body = JSON.parse(options.body || '{}');
                    const data = await DemoAPI.listDirectories(body);
                    return new Response(JSON.stringify(data), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                if (url === '/scan' && options?.method === 'POST') {
                    const body = JSON.parse(options.body || '{}');
                    const data = await DemoAPI.scan(body);
                    return new Response(JSON.stringify(data), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                if (url === '/combine' && options?.method === 'POST') {
                    try {
                        await DemoAPI.combine(options.body ? JSON.parse(options.body) : {});
                    } catch (error) {
                        return new Response(JSON.stringify({ error: error.message }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    // If combine succeeds, return a 200 OK response
                    return new Response(JSON.stringify({ success: true }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                // Video streaming - handled differently
                if (url.startsWith('/video?')) {
                    // In demo mode, videos are served as static files
                    // Extract the 'path' query parameter
                    const urlObj = new URL(url, window.location.origin);
                    const videoPath = urlObj.searchParams.get('path');
                    if (videoPath) {
                        return originalFetch(videoPath, options);
                    } else {
                        return new Response(JSON.stringify({ error: 'Missing video path' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                }
            } catch (error) {
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // For all other requests, use original fetch
        return originalFetch(url, options);
    };
}
