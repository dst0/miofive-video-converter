# Miofive Video Converter

A web-based tool to scan, organize, and combine video files from Miofive S1 Ultra dashcam recordings stored on microSD cards.

## Table of Contents

- [Problem Statement](#problem-statement)
- [Miofive S1 Ultra File System](#miofive-s1-ultra-file-system)
- [Solution](#solution)
- [Installation](#installation)
- [Usage](#usage)
- [Features](#features)
- [Requirements](#requirements)

## Problem Statement

The Miofive S1 Ultra dashcam records video footage continuously in short segments (typically 1-5 minutes each) and stores them on a microSD card. This creates several challenges:

1. **Fragmented footage**: A single driving session is split into dozens or hundreds of small video files scattered across the SD card
2. **Dual camera files**: The dashcam records from both front (A) and rear (B) cameras simultaneously, creating separate files for each view
3. **Complex filenames**: Files use a timestamp-based naming scheme that's difficult to parse manually
4. **Manual merging**: Combining these files in chronological order to create a continuous video is tedious and error-prone

This tool solves these problems by automatically scanning the microSD card, identifying all video files, sorting them chronologically, and merging them into a single continuous video file.

## Miofive S1 Ultra File System

### MicroSD Card Folder Structure

When you insert a Miofive S1 Ultra dashcam microSD card into your computer, you'll typically find a structure similar to:

```
/
|── CarDV/                      # Main directory for camera files
|    |── Movie/                 # Recording videos
|    |    |── Emr/                # Emergency recording mode videos (also car start and stop)
|    |    |── Normal/          # Regular recording mode videos
|    |    |── Park/               # Parking recording mode videos (mostly when there is a movement outside)
|    |── Photo/                 # Photo snapshots (if enabled)
|── LOG/                         # System log files
|    |── DEVLOG/                 # Dev logs
|    |── GPSLOG/                 # GPS logs
└── [other root files]       # Other: `.fseventsd`, `.Trashes`, `.Spotlight-V100`
```

**Note**: The exact folder structure may vary depending on firmware version and dashcam settings. Videos may be stored directly in the root, in dated subdirectories, or in other organizational schemes.

### File Naming Convention

Each video file follows a specific naming pattern that encodes timing information:

**Format** (depends on configuration):
  `{MMDDYY}_{HHMMSS}_{MMDDYY}_{HHMMSS}_{dddddd}{C}.MP4`

**Components** (depends on configuration):
- **First timestamp** (`MMDDYY_HHMMSS`): UTC date and time when recording started
- **Second timestamp** (`MMDDYY_HHMMSS`): Local date and time when recording started
- **Sequence number** (`dddddd`): 6-digit sequential counter
- **Camera channel** (`C`): Either `A` (front camera) or `B` (rear camera)

**Note**: Timestamp interpretation may vary depending on firmware version or timezone settings. The tool uses the first timestamp for sorting and filtering.

**Example**: `010125_143052_010125_093052_000001A.MP4`
- UTC time: January 1, 2025, 14:30:52
- Local time: January 1, 2025, 09:30:52 (UTC-5)
- Sequence: 000001
- Camera: A (front)

### Dual Camera Recording

The dashcam records simultaneously from two cameras:
- **Channel A**: Front-facing camera (primary view)
- **Channel B**: Rear-facing or interior camera (secondary view)

Each recording session creates paired files with identical timestamps but different channel suffixes (A/B). These files are synchronized and can be combined separately or together.

## Solution

This tool provides a simple web interface that:

1. **Scans** the microSD card (or any folder) recursively to find all Miofive video files
2. **Parses** the complex filename format to extract timestamps
3. **Filters** videos by date/time range and camera channel
4. **Sorts** files chronologically for seamless playback
5. **Combines** selected videos into a single output file using FFmpeg

The result is a continuous video file that's much easier to review, share, or archive.

## Installation

### Prerequisites

- **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
- **FFmpeg** (automatically installed by the tool)

### Setup Steps

1. **Clone or download this repository**:
   ```bash
   git clone https://github.com/dst0/miofive-video-converter.git
   cd miofive-video-converter
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   
   This will automatically:
   - Install required Node.js packages
   - Download and install FFmpeg (if not already present)

3. **Verify FFmpeg installation**:
   ```bash
   ffmpeg -version
   ```

## Usage

### Running the Application

This server is designed to run on a system where the microSD card from your Miofive S1 Ultra dashcam is inserted (via USB card reader or built-in SD card slot).

1. **Insert the microSD card** into your computer using a card reader

2. **Start the server**:
   ```bash
   npm start
   ```

3. **Open your web browser** and navigate to:
   ```
   http://localhost:3000
   ```

4. **Using the web interface**:
   
   a. **Select folder**: Browse to the microSD card mount point
      - Windows: Usually `D:\`, `E:\`, or similar drive letter
      - macOS: `/Volumes/[card-name]/`
      - Linux: `/media/[user]/[card-name]/` or `/mnt/`
   
   b. **Choose date/time range** (optional): Filter videos by recording time
   
   c. **Select camera channels**: Choose front (A), rear (B), or both cameras
   
   d. **Scan**: Click "Scan" to find all matching video files
   
   e. **Review**: Check the list of found files and their timestamps
   
   f. **Set output path**: Choose where to save the combined video
   
   g. **Combine**: Click "Combine Videos" to merge files into one video

5. **Wait for processing**: FFmpeg will combine the videos (this may take several minutes depending on total file size)

6. **Access your video**: The combined video will be saved to your specified output location

### Tips for Best Results

- **Keep original files**: Always work with a copy or ensure you have backups before processing
- **Large files**: Combining many hours of footage creates large files (gigabytes). Ensure adequate disk space
- **Filter by time**: Use date/time filters to create smaller, more manageable output files
- **One camera at a time**: For easier viewing, process front and rear cameras separately
- **Regular exports**: Export and archive footage regularly to prevent SD card from filling up

## Features

- ✅ Recursive scanning of entire microSD card structure
- ✅ Automatic filename parsing with UTC and local timezone support
- ✅ Date/time range filtering
- ✅ Dual camera channel selection (A/B)
- ✅ Interactive folder browser
- ✅ Chronological sorting
- ✅ FFmpeg-based lossless video merging
- ✅ Real-time progress display
- ✅ Cross-platform support (Windows, macOS, Linux)

## Requirements

- **System**: Windows, macOS, or Linux
- **Node.js**: v14 or higher
- **FFmpeg**: Auto-installed during setup
- **Storage**: Free disk space equal to the size of videos you want to combine
- **Card Reader**: USB card reader or built-in SD card slot to access the microSD card

## License

MIT License - See LICENSE file for details

## Author

dst

## Contributing

Issues and pull requests are welcome!
