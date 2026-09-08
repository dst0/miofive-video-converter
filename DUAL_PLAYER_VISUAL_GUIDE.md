# Visual Guide: Dual-Player Architecture

> [!WARNING]
> **Historical Design Note (Non-Current):** This visual guide illustrates initial UI mockups from PR #14. It is preserved for reference and does NOT represent current production layout or verification evidence. For canonical contracts, see [`docs/architecture.md`](docs/architecture.md).

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Video Player UI                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Video Player 1 (Active)      ◀── Currently Visible   │    │
│  │  Playing: video1.mp4                                   │    │
│  │  [████████████░░░░░░░░░░░░░░░░░]  50% of video        │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Video Player 2 (Preloading)  ◀── Hidden, Loading Next│    │
│  │  Loaded: video2.mp4 (Ready to play)                   │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────── Custom Controls Overlay ────────────────────┐    │
│  │  ┌──────────────────────────────────────────────────┐  │    │
│  │  │ Progress: [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 5% │  │    │
│  │  │           00:30 / 10:00 (10 videos × 1 min)      │  │    │
│  │  └──────────────────────────────────────────────────┘  │    │
│  │  [⏸] [🔊▬▬▬] Speed: 1.0x [⛶]                          │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  External Controls:                                             │
│  [⏮ Previous] [⏸ Pause] [⏭ Next]                              │
│                                                                 │
│  Speed: [0.1] [────●────────────────] [50]                    │
│  Presets: [0.1x][0.25x][0.5x][1x][2x][5x][10x][25x][50x]     │
└─────────────────────────────────────────────────────────────────┘
```

## Timeline Representation

### Traditional Single Video Progress
```
Video 1 (1 min):  [████████████████████░░░░░░░░░░] 50%
                  0:30 / 1:00
```
Shows 50% after 30 seconds (misleading when playing multiple videos)

### Our Global Timeline Progress
```
All Videos (10 × 1 min = 10 min):

Video 1    Video 2    Video 3    Video 4    Video 5    ...    Video 10
├──────────┼──────────┼──────────┼──────────┼──────────┼───┼──────────┤
[██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 5%
0:30 / 10:00

Currently at 30 seconds = 5% of total 600 seconds
```
Shows 5% after 30 seconds (accurate across all videos)

## Seamless Video Transition

### Step-by-Step Process

```
Time: 0:59 (End of Video 1)
┌─────────────────────┐
│ Player 1 (Active)   │ ← Playing last frames of Video 1
│ Video: video1.mp4   │
│ Time: 0:59          │
└─────────────────────┘
┌─────────────────────┐
│ Player 2 (Ready)    │ ← Already loaded Video 2, ready to play
│ Video: video2.mp4   │
│ Status: Preloaded   │
└─────────────────────┘

       ↓ Video 1 ends (no reload needed!)

Time: 1:00 (Start of Video 2)
┌─────────────────────┐
│ Player 1            │ ← Now preloading Video 3
│ Video: video3.mp4   │
│ Status: Loading...  │
└─────────────────────┘
┌─────────────────────┐
│ Player 2 (Active)   │ ← Instantly becomes visible and plays
│ Video: video2.mp4   │
│ Time: 0:00          │
└─────────────────────┘

Result: NO BLACK SCREEN! Seamless transition!
```

## Speed Control Options

```
Range: 0.1x ────────●──────────────────── 50x

Presets:
┌──────┬──────┬──────┬────┬────┬────┬────┬────┬────┐
│ 0.1x │ 0.25x│ 0.5x │ 1x │ 2x │ 5x │10x │25x │50x │
└──────┴──────┴──────┴────┴────┴────┴────┴────┴────┘
  Slow Motion    Normal    Fast    Super Fast

Use Cases:
• 0.1x - 0.5x : Detailed incident analysis
• 1x          : Normal review
• 2x - 10x    : Quick scan
• 10x - 50x   : Ultra-fast forward through hours of footage
```

## Progress Bar Interaction

```
User clicks here ↓
All Videos: [████████░░░░░░░░░░░░░░░░░░░░░░░] 50%
            ├────────┼────────┼────────┼────────┤
            Vid 1    Vid 5    Vid 8    Vid 10
                        ↑
            Clicked at 50% = 5 minutes into total timeline

System Action:
1. Calculate: 50% × 600 seconds = 300 seconds
2. Find video: 300s = 5 minutes = Video 5 (starts at 4:00)
3. Seek within video: 300s - 240s = 60s into Video 5
4. Result: Instantly jump to Video 5 at 1:00 mark
```

## Key Benefits Visualization

### Without Dual Players (Old Approach)
```
Video 1 Playing → Load Video 2 → ▓▓▓ BLACK SCREEN ▓▓▓ → Video 2 Plays
[─────────────]   [Loading...]     [████████]         [─────────────]
                      ↑ UI Jump!
```

### With Dual Players (New Approach)
```
Video 1 Playing → Switch → Video 2 Plays Immediately
[─────────────]   [│││]   [─────────────]
                   ↑ Instant! No loading!
                   
(Video 2 was preloaded in background)
```

## Custom Controls Features

```
╔═══════════════════════════════════════════════════════════╗
║  Progress Bar (Spans All Videos)                         ║
║  ┌────────────────────────────────────────────────────┐  ║
║  │ [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] ◆         │  ║
║  │  ↑ Played    ↑ Current Position    ↑ Total        │  ║
║  └────────────────────────────────────────────────────┘  ║
║  00:30 / 10:00                                           ║
╠═══════════════════════════════════════════════════════════╣
║  [⏸]  Pause/Play    [🔊 ▬▬▬▬]  Volume    1.0x  Speed   ║
║                                                [⛶] Full  ║
╚═══════════════════════════════════════════════════════════╝
           ↑                  ↑                ↑
    Toggles both        Synced across    Shows current
      players            both players         speed
```

## Example Usage Flow

```
User Workflow:
1. Select 10 dashcam videos (each 1 minute)
   └─→ Total: 10 minutes

2. Click "Play Videos"
   └─→ Opens player with dual-player architecture

3. Playback starts
   ├─→ Player 1: Plays Video 1
   ├─→ Player 2: Preloads Video 2
   └─→ Progress: 0% of 10 minutes

4. Watch at 5x speed
   └─→ Both players set to 5x playback rate

5. After 12 seconds (= 1 min at 5x speed)
   ├─→ Video 1 ends
   ├─→ Player 2 instantly becomes active (Video 2)
   ├─→ Player 1 starts preloading Video 3
   └─→ Progress: 10% (1 min / 10 min)
   
   Result: NO INTERRUPTION!

6. Click at 50% on progress bar
   ├─→ System calculates: 50% × 10 min = 5 min
   ├─→ Loads Video 5 (starts at 4 min mark)
   ├─→ Seeks to 1:00 within Video 5
   └─→ Continues playback

7. Slow down to 0.25x for detailed analysis
   └─→ Speed synced across both players

Progress throughout:
[██░░░░░░] 5%  at 0:30 (Video 1)
[████░░░░] 10% at 1:00 (Video 2 starts - seamless!)
[██████░░] 15% at 1:30 (Video 2)
    ...
[████████] 50% at 5:00 (Video 5)
    ...
[████████████] 100% at 10:00 (Video 10 ends)
```

This visualization shows how the dual-player architecture creates a seamless, professional video viewing experience for dashcam footage review.
