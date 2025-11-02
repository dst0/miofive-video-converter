# Test Data

This directory contains minimal test video files for testing the video player and combiner functionality.

## Test Videos

The test videos are located in the `Normal/` subdirectory and follow the Miofive S1 Ultra naming convention. Each video displays a large, clear number to make it easy to visually verify that videos are playing in the correct sequence.

- `010125_100000_010125_050000_000001A.MP4` - Video 1 (displays "1")
- `010125_100100_010125_050100_000002A.MP4` - Video 2 (displays "2")
- `010125_100200_010125_050200_000003A.MP4` - Video 3 (displays "3")
- `010125_100300_010125_050300_000004A.MP4` - Video 4 (displays "4")
- `010125_100400_010125_050400_000005A.MP4` - Video 5 (displays "5")
- `010125_100500_010125_050500_000006A.MP4` - Video 6 (displays "6")
- `010125_100600_010125_050600_000007A.MP4` - Video 7 (displays "7")
- `010125_100700_010125_050700_000008A.MP4` - Video 8 (displays "8")
- `010125_100800_010125_050800_000009A.MP4` - Video 9 (displays "9")
- `010125_100900_010125_050900_000010A.MP4` - Video 10 (displays "10")

### File Details

- **Duration**: 2 seconds each
- **Resolution**: 160x120 (minimal for testing)
- **Frame Rate**: 15 fps
- **File Size**: ~5KB each (significantly smaller than previous versions)
- **Format**: H.264 video with AAC audio
- **Visual Content**: Each video displays a large white number on a gray background for easy visual identification
- **Timestamps** (1 minute apart, using future dates to match the Miofive filename format pattern): 
  - Video 1: 2025-01-01 10:00:00 UTC
  - Video 2: 2025-01-01 10:01:00 UTC
  - Video 3: 2025-01-01 10:02:00 UTC
  - ... (continuing sequentially)
  - Video 10: 2025-01-01 10:09:00 UTC

## Usage

1. **Scan**: Point the application to the `test-data` folder
2. **Select**: Choose channel A (all test videos are channel A)
3. **Play**: Use the "Play Videos" button to test seamless playback
4. **Combine**: Use the "Combine" button to merge videos into a single file

## Generating Test Videos

To regenerate the test videos (e.g., to create more videos or modify settings), use the provided generator script:

```bash
node generate-test-videos.js
```

This script creates videos with sequential numbers displayed on them, making it easy to verify correct playback order.

## Features to Test

- Video scanning and file detection
- Timeline visualization with file markers
- Date range filtering
- Seamless video playback across multiple files
- Timeline navigation by clicking on file markers
- Previous/Next video controls
- Automatic transition between videos
- Playback speed control
- Sequential number display verification (numbers should appear in order: 1, 2, 3, ...)
