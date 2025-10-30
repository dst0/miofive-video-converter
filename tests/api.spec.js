// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

test.describe('API Endpoint Tests', () => {
  test('GET /check-ffmpeg should return availability status', async ({ request }) => {
    const response = await request.get('/check-ffmpeg');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('available');
    expect(typeof data.available).toBe('boolean');
  });

  test('POST /list-directories with no path should return initial locations', async ({ request }) => {
    const response = await request.post('/list-directories', {
      data: {}
    });
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('directories');
    expect(Array.isArray(data.directories)).toBeTruthy();
    expect(data.directories.length).toBeGreaterThan(0);
    
    // Check that each directory has required properties
    for (const dir of data.directories) {
      expect(dir).toHaveProperty('name');
      expect(dir).toHaveProperty('path');
      expect(dir).toHaveProperty('type');
    }
  });

  test('POST /list-directories with invalid path should return error', async ({ request }) => {
    const response = await request.post('/list-directories', {
      data: {
        path: '/nonexistent/invalid/path/12345'
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('POST /scan without folder path should return error', async ({ request }) => {
    const response = await request.post('/scan', {
      data: {
        channels: ['A', 'B']
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Folder path is required');
  });

  test('POST /scan with invalid folder should return error', async ({ request }) => {
    const response = await request.post('/scan', {
      data: {
        folderPath: '/nonexistent/path',
        channels: ['A', 'B']
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('POST /scan with valid folder should return files', async ({ request }) => {
    // Create a temporary test directory with mock video files
    const testDir = path.join(os.tmpdir(), `test-api-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    try {
      // Create mock video files
      const mockFiles = [
        '010125_143052_010125_093052_000001A.MP4',
        '010125_143152_010125_093152_000002A.MP4',
      ];
      
      for (const filename of mockFiles) {
        await fs.writeFile(path.join(testDir, filename), 'mock video content');
      }
      
      const response = await request.post('/scan', {
        data: {
          folderPath: testDir,
          channels: ['A', 'B']
        }
      });
      
      expect(response.ok()).toBeTruthy();
      
      const data = await response.json();
      expect(data).toHaveProperty('files');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.files)).toBeTruthy();
      expect(data.count).toBe(2);
      
      // Check file structure
      for (const file of data.files) {
        expect(file).toHaveProperty('path');
        expect(file).toHaveProperty('filename');
        expect(file).toHaveProperty('utcTime');
        expect(file).toHaveProperty('localTime');
        expect(file).toHaveProperty('timestamp');
      }
    } finally {
      // Clean up
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  test('POST /combine without files should return error', async ({ request }) => {
    const response = await request.post('/combine', {
      data: {
        outputPath: '/tmp/output.mp4'
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('No files to combine');
  });

  test('POST /combine without output path should return error', async ({ request }) => {
    const response = await request.post('/combine', {
      data: {
        files: ['/tmp/test1.mp4', '/tmp/test2.mp4']
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Output path is required');
  });

  test('Root path / should serve HTML content', async ({ request }) => {
    const response = await request.get('/');
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/html');
    
    const body = await response.text();
    expect(body).toContain('MP4 Video Combiner');
    expect(body).toContain('Scan folders for timestamped videos');
  });

  test('Static files should be served', async ({ request }) => {
    const response = await request.get('/styles.css');
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/css');
  });
});
