// server
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const {exec, spawn} = require('child_process');
const {promisify} = require('util');

const execPromise = promisify(exec);
const app = express();
const PORT = 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');

// Simple in-memory rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 100; // Max requests per window

function checkRateLimit(clientId) {
    const now = Date.now();
    const clientData = rateLimitMap.get(clientId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    
    if (now > clientData.resetTime) {
        clientData.count = 0;
        clientData.resetTime = now + RATE_LIMIT_WINDOW;
    }
    
    clientData.count++;
    rateLimitMap.set(clientId, clientData);
    
    return clientData.count <= MAX_REQUESTS;
}

function runStream(command, { cwd, env } = {}) {
    // Stream output live; support shell pipes/&& via shell:true
    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, stdio: 'inherit', cwd, env });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Command failed: ${command} (exit ${code})`))));
    });
}

app.use(express.json());

// Serve static assets (index.html, etc.)
app.use(express.static(PUBLIC_DIR));

// Check if FFmpeg is available
async function checkFFmpeg() {
    try {
        await execPromise('ffmpeg -version');
        return true;
    } catch {
        return false;
    }
}

// Parse filename to extract UTC and local timestamps
function parseFilename(filename) {
    // Pattern: {MMDDYY}_{HHMMSS}_{MMDDYY}_{HHMMSS}_{dddddd(A|B)}.MP4
    const pattern = /(\d{6})_(\d{6})_(\d{6})_(\d{6})_(\d{6}[AB])\.MP4$/i;
    const match = filename.match(pattern);
    if (!match) return null;

    const [, utcDate, utcTime, localDate, localTime, sequence] = match;

    // UTC datetime
    const utcMonth = utcDate.substring(0, 2);
    const utcDay = utcDate.substring(2, 4);
    const utcYear = '20' + utcDate.substring(4, 6);
    const utcHour = utcTime.substring(0, 2);
    const utcMin = utcTime.substring(2, 4);
    const utcSec = utcTime.substring(4, 6);
    const utcTimestamp = new Date(`${utcYear}-${utcMonth}-${utcDay}T${utcHour}:${utcMin}:${utcSec}Z`);

    // Local datetime
    const localYear = '20' + localDate.substring(0, 2);
    const localMonth = localDate.substring(2, 4);
    const localDay = localDate.substring(4, 6);
    const localHour = localTime.substring(0, 2);
    const localMin = localTime.substring(2, 4);
    const localSec = localTime.substring(4, 6);
    let localDateTimeString = `${localYear}-${localMonth}-${localDay}T${localHour}:${localMin}:${localSec}`;
    const localTimestamp = new Date(localDateTimeString);

    return {
        utcTimestamp,
        localTimestamp,
        sequence,
        isValid: !isNaN(utcTimestamp.getTime()) && !isNaN(localTimestamp.getTime())
    };
}

// Extract file type from path (Normal, Emr, Park, or Other)
function getFileType(filePath) {
    const pathUpper = filePath.toUpperCase();
    if (pathUpper.includes('/EMR') || pathUpper.includes('\\EMR')) {
        return 'Emr';
    } else if (pathUpper.includes('/NORMAL') || pathUpper.includes('\\NORMAL')) {
        return 'Normal';
    } else if (pathUpper.includes('/PARK') || pathUpper.includes('\\PARK')) {
        return 'Park';
    }
    return 'Other';
}

// Recursively scan directory
async function scanDirectory(dirPath, startTime, endTime) {
    const results = [];
    try {
        const entries = await fs.readdir(dirPath, {withFileTypes: true});
        for (const entry of entries) {
            // Skip hidden files/directories (starting with .)
            if (entry.name.startsWith('.')) {
                continue;
            }
            
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const subResults = await scanDirectory(fullPath, startTime, endTime);
                results.push(...subResults);
            } else if (entry.isFile()) {
                const upperName = entry.name.toUpperCase();
                if (upperName.endsWith('A.MP4') || upperName.endsWith('B.MP4')) {
                    const parsed = parseFilename(entry.name);
                    if (parsed && parsed.isValid) {
                        const timestamp = parsed.utcTimestamp.getTime();
                        if (startTime && timestamp < startTime) continue;
                        if (endTime && timestamp > endTime) continue;
                        results.push({
                            path: fullPath,
                            filename: entry.name,
                            utcTime: parsed.utcTimestamp.toISOString(),
                            localTime: parsed.localTimestamp.toISOString(),
                            timestamp,
                            fileType: getFileType(fullPath)
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Error scanning ${dirPath}:`, err.message);
    }
    return results.sort((a, b) => a.timestamp - b.timestamp);
}

// Root: serve the HTML file explicitly (nice fallback)
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Check FFmpeg availability
app.get('/check-ffmpeg', async (req, res) => {
    const available = await checkFFmpeg();
    res.json({available});
});

// List directories endpoint
app.post('/list-directories', async (req, res) => {
    // Rate limiting check
    const clientId = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientId)) {
        return res.status(429).json({error: 'Too many requests. Please try again later.'});
    }
    
    const {path: dirPath} = req.body;
    
    try {
        // If no path provided, list root/common directories based on platform
        if (!dirPath) {
            const os = require('os');
            const platform = os.platform();
            let locations = [];
            
            if (platform === 'win32') {
                // Windows: List available drives
                try {
                    const {stdout} = await execPromise('wmic logicaldisk get name');
                    const drives = stdout.split('\n')
                        .map(line => line.trim())
                        .filter(line => line && line !== 'Name' && line.match(/^[A-Z]:/))
                        .map(drive => ({name: drive + '\\', path: drive + '\\', type: 'drive'}));
                    
                    if (drives.length > 0) {
                        locations.push(...drives);
                    } else {
                        locations.push({name: 'C:\\', path: 'C:\\', type: 'drive'});
                    }
                } catch (error) {
                    locations.push({name: 'C:\\', path: 'C:\\', type: 'drive'});
                }
                
                // Add common Windows folders
                const homeDir = os.homedir();
                const commonFolders = [
                    {name: 'Desktop', path: path.join(homeDir, 'Desktop'), type: 'common'},
                    {name: 'Documents', path: path.join(homeDir, 'Documents'), type: 'common'},
                    {name: 'Downloads', path: path.join(homeDir, 'Downloads'), type: 'common'},
                    {name: 'Pictures', path: path.join(homeDir, 'Pictures'), type: 'common'},
                    {name: 'Videos', path: path.join(homeDir, 'Videos'), type: 'common'},
                ];
                
                // Only add folders that exist
                for (const folder of commonFolders) {
                    try {
                        await fs.access(folder.path);
                        locations.push(folder);
                    } catch (err) {
                        // Folder doesn't exist, skip it
                    }
                }
                
                res.json({directories: locations});
                return;
            } else {
                // Unix-like: Start from home directory and common places
                const homeDir = os.homedir();
                locations.push({name: '~ (Home)', path: homeDir, type: 'common'});
                
                // Add common Unix folders
                const commonFolders = [
                    {name: 'Desktop', path: path.join(homeDir, 'Desktop'), type: 'common'},
                    {name: 'Documents', path: path.join(homeDir, 'Documents'), type: 'common'},
                    {name: 'Downloads', path: path.join(homeDir, 'Downloads'), type: 'common'},
                    {name: 'Pictures', path: path.join(homeDir, 'Pictures'), type: 'common'},
                    {name: 'Videos', path: path.join(homeDir, 'Videos'), type: 'common'},
                ];
                
                // Only add folders that exist
                for (const folder of commonFolders) {
                    try {
                        await fs.access(folder.path);
                        locations.push(folder);
                    } catch (err) {
                        // Folder doesn't exist, skip it
                    }
                }
                
                // Add system locations for Unix/macOS
                if (platform === 'darwin') {
                    // macOS: Add /Volumes for external drives
                    try {
                        await fs.access('/Volumes');
                        locations.push({name: '/Volumes (External Drives)', path: '/Volumes', type: 'system'});
                    } catch (err) {
                        // /Volumes doesn't exist or not accessible
                    }
                } else {
                    // Linux: Add /media for external drives
                    try {
                        await fs.access('/media');
                        locations.push({name: '/media (External Drives)', path: '/media', type: 'system'});
                    } catch (err) {
                        // /media doesn't exist or not accessible
                    }
                    
                    // Linux: Add /mnt for mounted drives
                    try {
                        await fs.access('/mnt');
                        locations.push({name: '/mnt (Mounted Drives)', path: '/mnt', type: 'system'});
                    } catch (err) {
                        // /mnt doesn't exist or not accessible
                    }
                }
                
                // Add root directory
                locations.push({name: '/ (Root)', path: '/', type: 'system'});
                
                res.json({directories: locations});
                return;
            }
        }
        
        // Normalize and resolve the path to prevent directory traversal attacks
        const normalizedPath = path.resolve(dirPath);
        
        // Verify the path exists and is accessible
        await fs.access(normalizedPath);
        const stat = await fs.stat(normalizedPath);
        
        if (!stat.isDirectory()) {
            return res.status(400).json({error: 'Path is not a directory'});
        }
        
        // Read directory contents
        const entries = await fs.readdir(normalizedPath, {withFileTypes: true});
        
        // Filter for directories only, exclude hidden directories
        const directories = entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => ({
                name: entry.name,
                path: path.join(normalizedPath, entry.name),
                type: 'folder'
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({directories});
    } catch (err) {
        res.status(400).json({error: 'Unable to access directory', message: err.message});
    }
});

// Scan endpoint
app.post('/scan', async (req, res) => {
    const {folderPath, startTime, endTime, channels} = req.body;
    if (!folderPath) return res.status(400).json({error: 'Folder path is required'});
    const includeA = channels?.includes('A');
    const includeB = channels?.includes('B');

    try {
        await fs.access(folderPath);
        const startTs = startTime ? new Date(startTime).getTime() : null;
        const endTs = endTime ? new Date(endTime).getTime() : null;
        let files = await scanDirectory(folderPath, startTs, endTs);
        files = files.filter(f => {
            const name = f.filename.toUpperCase();
            return (includeA && name.endsWith('A.MP4')) || (includeB && name.endsWith('B.MP4'));
        });
        res.json({files, count: files.length});
    } catch (err) {
        res.status(400).json({error: 'Invalid folder path or access denied', message: err.message});
    }
});


// Combine endpoint
app.post('/combine', async (req, res) => {
    const {files, outputPath} = req.body;
    if (!files || files.length === 0) {
        return res.status(400).json({error: 'No files to combine'});
    }
    if (!outputPath) {
        return res.status(400).json({error: 'Output path is required'});
    }

    const hasFFmpeg = await checkFFmpeg();
    if (!hasFFmpeg) {
        return res.status(400).json({error: 'FFmpeg is not installed. Run: npm run install-ffmpeg'});
    }

    try {
        // Check if file exists and add counter if needed
        let finalOutputPath = outputPath;
        const parsedPath = path.parse(outputPath);
        let counter = 1;
        const MAX_COUNTER = 9999; // Prevent infinite loops
        
        // Check if the file already exists
        try {
            await fs.access(finalOutputPath);
            // File exists, add counter
            while (counter <= MAX_COUNTER) {
                finalOutputPath = path.join(parsedPath.dir, `${parsedPath.name}_${counter}${parsedPath.ext}`);
                try {
                    await fs.access(finalOutputPath);
                    counter++;
                } catch {
                    // File doesn't exist, we can use this name
                    break;
                }
            }
            
            if (counter > MAX_COUNTER) {
                throw new Error('Too many files with the same name. Please choose a different filename.');
            }
        } catch (err) {
            if (err.message && err.message.includes('Too many files')) {
                throw err;
            }
            // File doesn't exist, use original path
        }

        const listPath = path.join(__dirname, 'filelist.txt');
        console.log('Creating file with input file list: ' + listPath);
        const fileListContent = files.map(f => `file '${String(f).replace(/'/g, "'\\''")}'`).join('\n');
        await fs.writeFile(listPath, fileListContent);
        console.log('File with input file list is successfully created\n');

        console.log('Combining videos using ffmpeg tool...');
        const command = [
            'ffmpeg',
            '-hide_banner', '-loglevel', 'info', '-stats', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', `"${listPath}"`,
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', '+faststart',
            `"${finalOutputPath}"`
        ].join(' ');
        await runStream(command);
        await fs.unlink(listPath);

        console.log('Videos combined successfully to:', finalOutputPath);
        res.json({success: true, message: 'Videos combined successfully', output: finalOutputPath});
    } catch (err) {
        console.error('Failed to combine videos:', err.message);
        res.status(500).json({error: `Failed to combine videos: ${err.message}`});
    }
});

// Start server
async function startServer() {
    const hasFFmpeg = await checkFFmpeg();
    app.listen(PORT, () => {
        console.log(`\n✅ Server running at http://localhost:${PORT}\n`);
        if (hasFFmpeg) {
            console.log('✅ FFmpeg is installed and ready');
        } else {
            console.log('⚠️  FFmpeg is NOT installed');
            console.log('   Video combining will not work');
            console.log('   Run: npm run install-ffmpeg');
        }
        console.log('\nPress Ctrl+C to stop the server\n');
    });
}

startServer();