// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const TEST_DATA_PATH = path.join(__dirname, '..', 'test-data', 'Normal');

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

  test('POST /export without files should return export error', async ({ request }) => {
    const response = await request.post('/export', {
      data: {
        outputPath: '/tmp/output.mp4'
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('No files to export');
  });

  test('POST /export without output path should return error', async ({ request }) => {
    const response = await request.post('/export', {
      data: {
        files: ['/tmp/test1.mp4', '/tmp/test2.mp4']
      }
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Output path is required');
  });

  test('POST /combine should not expose a second export flow', async ({ request }) => {
    const response = await request.post('/combine', {
      data: {
        files: [],
        outputPath: '/tmp/output.mp4'
      }
    });

    expect(response.status()).toBe(404);
  });

  test('POST /export should export a millisecond precise range with speed and quality options', async ({ request }) => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-range-export-'));
    const outputPath = path.join(outputDir, 'range-export.mp4');
    const files = [
      path.join(TEST_DATA_PATH, '010125_100000_010125_050000_000001A.MP4'),
      path.join(TEST_DATA_PATH, '010125_100100_010125_050100_000002A.MP4'),
    ];

    try {
      const response = await request.post('/export', {
        data: {
          files,
          outputPath,
          rangeStart: 0.5,
          rangeEnd: 2.375,
          speed: 2,
          quality: 'compact',
        }
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.success).toBeTruthy();
      expect(data.output).toBe(outputPath);
      expect(data.details.rangeStart).toBe(0.5);
      expect(data.details.rangeEnd).toBe(2.375);
      expect(data.details.selectedDuration).toBeCloseTo(1.875, 3);
      expect(data.details.outputDuration).toBeCloseTo(0.9375, 3);

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=nokey=1:noprint_wrappers=1',
        outputPath,
      ]);
      const outputDuration = Number.parseFloat(stdout.trim());
      expect(outputDuration).toBeGreaterThan(0.5);
      expect(outputDuration).toBeLessThan(1.8);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  test('POST /export should produce a readable MP4 when exporting all scanned files', async ({ request }) => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-full-export-'));
    const outputPath = path.join(outputDir, 'full-export.mp4');

    try {
      const entries = await fs.readdir(TEST_DATA_PATH);
      const files = entries
        .filter((entry) => entry.endsWith('.MP4'))
        .sort()
        .map((entry) => path.join(TEST_DATA_PATH, entry));

      const response = await request.post('/export', {
        data: {
          files,
          outputPath,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.success).toBeTruthy();
      expect(data.output).toBe(outputPath);
      expect(data.details.selectedDuration).toBeCloseTo(20, 1);

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=nokey=1:noprint_wrappers=1',
        outputPath,
      ], { timeout: 5000 });
      const outputDuration = Number.parseFloat(stdout.trim());
      expect(outputDuration).toBeGreaterThan(19);
      expect(outputDuration).toBeLessThan(21);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  test('Root path / should serve HTML content', async ({ request }) => {
    const response = await request.get('/');
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/html');
    
    const body = await response.text();
    expect(body).toContain('Miofive Video Converter');
    expect(body).toContain('Scan timestamped videos');
  });

  test('Static files should be served', async ({ request }) => {
    const response = await request.get('/styles.css');
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/css');
  });
});
