# Test Data

This directory contains minimal test video files for testing the video player and combiner functionality.

## Test Videos

The test videos are located in the `Normal/` subdirectory and follow the Miofive S1 Ultra naming convention:

- `010125_100000_010125_050000_000001A.MP4` - Video 1 (2 seconds, 32KB)
- `010125_100100_010125_050100_000002A.MP4` - Video 2 (2 seconds, 32KB)  
- `010125_100200_010125_050200_000003A.MP4` - Video 3 (2 seconds, 32KB)

### File Details

- **Duration**: 2 seconds each
- **Resolution**: 160x120 (minimal for testing)
- **Frame Rate**: 15 fps
- **File Size**: ~32KB each
- **Format**: H.264 video with AAC audio
- **Timestamps**: 
  - Video 1: 2025-01-01 10:00:00 UTC
  - Video 2: 2025-01-01 10:01:00 UTC
  - Video 3: 2025-01-01 10:02:00 UTC

## Usage

1. **Scan**: Point the application to the `test-data` folder
2. **Select**: Choose channel A (all test videos are channel A)
3. **Play**: Use the "Play Videos" button to test seamless playback
4. **Combine**: Use the "Combine" button to merge videos into a single file

## Features to Test

- Video scanning and file detection
- Timeline visualization with file markers
- Date range filtering
- Seamless video playback across multiple files
- Timeline navigation by clicking on file markers
- Previous/Next video controls
- Automatic transition between videos
- Playback speed control
