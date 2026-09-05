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
  test.describe.configure({mode: 'serial'});
  test('GET /check-ffmpeg should return availability status', async ({ request }) => {
    const response = await request.get('/check-ffmpeg');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('available');
    expect(typeof data.available).toBe('boolean');
    expect(data).not.toHaveProperty('ffmpegPath');
    expect(data).not.toHaveProperty('ffprobePath');
  });

  test('POST /export never overwrites an existing output file', async ({ request }) => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-no-overwrite-'));
    const outputPath = path.join(outputDir, 'existing.mp4');
    const sentinel = Buffer.from('keep this existing file');

    try {
      await fs.writeFile(outputPath, sentinel);
      const response = await request.post('/export', {
        data: {
          files: [path.join(TEST_DATA_PATH, '010125_100000_010125_050000_000001A.MP4')],
          outputPath,
          quality: 'compact',
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.output).toBe(await fs.realpath(path.join(outputDir, 'existing_1.mp4')));
      expect(await fs.readFile(outputPath)).toEqual(sentinel);
      expect((await fs.stat(data.output)).size).toBeGreaterThan(0);
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  test('POST /export rejects non-MP4 output names', async ({ request }) => {
    const response = await request.post('/export', {
      data: {
        files: [path.join(TEST_DATA_PATH, '010125_100000_010125_050000_000001A.MP4')],
        outputPath: path.join(os.tmpdir(), 'miofive-output.txt'),
      }
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('.mp4');
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
    expect(data).not.toHaveProperty('message');
  });

  test('POST /scan rejects malformed filters', async ({ request }) => {
    const invalidChannels = await request.post('/scan', {
      data: {folderPath: TEST_DATA_PATH, channels: 'AB'}
    });
    expect(invalidChannels.status()).toBe(400);

    const invalidDate = await request.post('/scan', {
      data: {folderPath: TEST_DATA_PATH, channels: ['A'], startTime: 'not-a-date'}
    });
    expect(invalidDate.status()).toBe(400);

    const invalidDurationFlag = await request.post('/scan', {
      data: {folderPath: TEST_DATA_PATH, channels: ['A'], includeDurations: 'yes'}
    });
    expect(invalidDurationFlag.status()).toBe(400);

    const mixedChannels = await request.post('/scan', {
      data: {folderPath: TEST_DATA_PATH, channels: ['A', 'B']}
    });
    expect(mixedChannels.status()).toBe(400);
  });

  test('POST /scan without folder path should return error', async ({ request }) => {
    const response = await request.post('/scan', {
      data: {
        channels: ['A']
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
        channels: ['A']
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
          channels: ['A']
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

  test('POST /scan admits only one duration-probing scan at a time', async ({request}) => {
    const payload = {folderPath: TEST_DATA_PATH, channels: ['A'], includeDurations: true};
    const responses = await Promise.all([
      request.post('/scan', {data: payload}),
      request.post('/scan', {data: payload}),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
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
      expect(data.output).toBe(await fs.realpath(outputPath));
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
      expect(data.output).toBe(await fs.realpath(outputPath));
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

  test('POST /export rejects inherited-property quality names as client input', async ({ request }) => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-quality-input-'));
    try {
      const response = await request.post('/export', {
        data: {
          files: [path.join(TEST_DATA_PATH, '010125_100000_010125_050000_000001A.MP4')],
          outputPath: path.join(outputDir, 'invalid-quality.mp4'),
          quality: 'constructor',
        },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain('quality');
    } finally {
      await fs.rm(outputDir, {recursive: true, force: true});
    }
  });

  test('POST /export rejects mixed simultaneous camera channels', async ({request}) => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-mixed-channels-'));
    const channelA = path.join(outputDir, '010125_100000_010125_050000_000001A.MP4');
    const channelB = path.join(outputDir, '010125_100000_010125_050000_000001B.MP4');
    try {
      const fixture = path.join(TEST_DATA_PATH, '010125_100000_010125_050000_000001A.MP4');
      await Promise.all([fs.copyFile(fixture, channelA), fs.copyFile(fixture, channelB)]);
      const response = await request.post('/export', {
        data: {
          files: [channelA, channelB],
          outputPath: path.join(outputDir, 'mixed.mp4'),
        },
      });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain('Mixed camera channels');
    } finally {
      await fs.rm(outputDir, {recursive: true, force: true});
    }
  });

  test('POST /export strips source metadata from shareable clips', async ({request}) => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miofive-metadata-'));
    const inputPath = path.join(outputDir, 'metadata-source.MP4');
    const outputPath = path.join(outputDir, 'metadata-stripped.mp4');
    try {
      const fixture = path.join(TEST_DATA_PATH, '010125_100000_010125_050000_000001A.MP4');
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', fixture,
        '-map', '0', '-c', 'copy',
        '-metadata', 'comment=sensitive-marker',
        '-metadata', 'location=+12.3400+056.7800/',
        inputPath,
      ], {timeout: 10000});

      const response = await request.post('/export', {
        data: {files: [inputPath], outputPath, quality: 'compact'},
        timeout: 30000,
      });
      expect(response.ok()).toBeTruthy();

      const {stdout} = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries', 'format_tags', '-of', 'json', outputPath,
      ], {timeout: 5000});
      const tags = JSON.parse(stdout).format?.tags || {};
      expect(tags.comment).toBeUndefined();
      expect(tags.location).toBeUndefined();
      expect(tags['location-eng']).toBeUndefined();
    } finally {
      await fs.rm(outputDir, {recursive: true, force: true});
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
