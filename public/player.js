// Video Player JavaScript - Dual Player Architecture (SPA Module)

let videoFiles = [];
let currentVideoIndex = 0;
let timelineData = null;
let activePlayerIndex = 0; // 0 or 1, which player is currently active
let videoPlayers = [null, null]; // References to both video elements
let videoSources = [null, null]; // References to both source elements
let totalDuration = 0; // Total duration of all videos combined
let videoDurations = []; // Array of individual video durations
let videoStartTimes = []; // Array of start times for each video in combined timeline
let isSeekingGlobal = false; // Flag for global seeking
let currentGlobalTime = 0; // Current playback time across all videos
let isDraggingProgress = false; // Flag for progress bar dragging
let isPlayerInitialized = false;

// Global player state - single source of truth for play/pause state
let globalPlayerState = 'paused'; // 'playing', 'paused', or 'ended'

// Track pending play promises to prevent race conditions
// This prevents AbortError when play() is interrupted by pause() or another play()
let pendingPlayPromises = [null, null]; // Track play() promises for each player

// Detect supported playback rate range for the browser/device
function detectPlaybackRateRange() {
    try {
        const v = document.createElement('video');
        const test = [0.01, 0.02, 0.025, 0.03, 0.05, 0.075, 0.1, 0.25, 0.3, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 8, 10, 15, 16, 25, 50];
        const ok = test.filter((r) => {
            try {
                v.playbackRate = r;
                return v.playbackRate === r;
            } catch {
                return false;
            }
        });
        return { min: Math.min(...ok), max: Math.max(...ok), supported: ok };
    } catch (e) {
        console.warn('Playback rate detection failed:', e);
        return { min: 0.5, max: 2, supported: [0.5, 1, 1.5, 2] };
    }
}

// Export the detected playback rate range
export const PlaybackRateRange = detectPlaybackRateRange();

// HTML escape function to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show snackbar notification
function showSnackbar(message, type = 'info', duration = 3000) {
    const snackbar = document.getElementById('snackbar');
    if (!snackbar) return;
    
    // Set message and type
    snackbar.textContent = message;
    snackbar.className = 'snackbar'; // Reset classes
    snackbar.classList.add('show', type);
    
    // Auto-hide after duration
    setTimeout(() => {
        snackbar.classList.remove('show');
    }, duration);
}

// Initialize the player module (called once on page load)
export function initPlayer() {
    // Initialize dual players references
    videoPlayers[0] = document.getElementById('videoPlayer1');
    videoPlayers[1] = document.getElementById('videoPlayer2');
    videoSources[0] = document.getElementById('videoSource1');
    videoSources[1] = document.getElementById('videoSource2');

    // Set up event listeners for back button
    document.getElementById('backBtn').addEventListener('click', async () => {
        try {
            await hidePlayerScreen();
        } catch (err) {
            console.error('Error hiding player screen:', err);
        }
    });
    
    // Set up event listener for export button
    document.getElementById('exportVideosBtn').addEventListener('click', () => {
        openExportModal();
    });
    
    // Set up export modal event listeners
    document.getElementById('closeExportModalBtn').addEventListener('click', closeExportModal);
    document.getElementById('exportCancelBtn').addEventListener('click', closeExportModal);
    document.getElementById('exportConfirmBtn').addEventListener('click', performExport);
    document.getElementById('exportBrowseFolderBtn').addEventListener('click', openExportFolderBrowser);
    
    // Close modal when clicking outside
    document.getElementById('exportModal').addEventListener('click', (e) => {
        if (e.target.id === 'exportModal') {
            closeExportModal();
        }
    });
    
    document.getElementById('prevBtn').addEventListener('click', async () => {
        try {
            await playPreviousVideo();
        } catch (err) {
            console.error('Error playing previous video:', err);
        }
    });

    document.getElementById('nextBtn').addEventListener('click', async () => {
        try {
            await playNextVideo();
        } catch (err) {
            console.error('Error playing next video:', err);
        }
    });

    document.getElementById('playPauseBtn').addEventListener('click', async () => {
        try {
            await togglePlayPause();
        } catch (err) {
            console.error('Error toggling play/pause:', err);
        }
    });

    // Log detected playback rate range (but don't modify slider min/max)
    console.log('Detected playback rate range:', PlaybackRateRange);

    // Speed control event listeners
    document.getElementById('speedInput').addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        if (speed >= PlaybackRateRange.min && speed <= PlaybackRateRange.max) {
            changePlaybackSpeed(speed);
        }
    });

    document.getElementById('speedSlider').addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        changePlaybackSpeed(speed);
    });

    // Speed preset buttons - filter and disable unsupported rates
    document.querySelectorAll('.preset-speed-btn').forEach((btn) => {
        const speed = parseFloat(btn.dataset.speed);
        
        // Disable button if speed is not supported
        if (speed < PlaybackRateRange.min || speed > PlaybackRateRange.max) {
            btn.disabled = true;
            btn.title = `${speed}x not supported by this browser`;
            btn.style.opacity = '0.5';
        }
        
        btn.addEventListener('click', () => {
            if (!btn.disabled) {
                changePlaybackSpeed(speed);
            }
        });
    });

    // Video player events for both players
    videoPlayers.forEach((player, index) => {
        player.addEventListener('ended', async () => {
            if (index === activePlayerIndex) {
                // Check if this is the last video
                if (currentVideoIndex >= videoFiles.length - 1) {
                    setGlobalPlayerState('ended');
                } else {
                    try {
                        await playNextVideo();
                    } catch (err) {
                        console.error('Error auto-playing next video:', err);
                    }
                }
            }
        });

        player.addEventListener('timeupdate', () => {
            if (index === activePlayerIndex && !isDraggingProgress) {
                updatePlaybackPosition();
                updateVideoInfo();
                updateCustomProgressBar();
            }
        });

        player.addEventListener('play', () => {
            if (index === activePlayerIndex) {
                console.log('play event triggered at player index', index);
                setGlobalPlayerState('playing');
            }
        });

        player.addEventListener('pause', () => {
            if (index === activePlayerIndex) {
                console.log('pause event triggered at player index', index);
                // Only update state if not ended
                const activePlayer = videoPlayers[activePlayerIndex];
                if (!activePlayer.ended) {
                    setGlobalPlayerState('paused');
                }
            }
        });

        player.addEventListener('loadedmetadata', () => {
            if (player.dataset.videoIndex !== undefined) {
                const videoIdx = parseInt(player.dataset.videoIndex);
                videoDurations[videoIdx] = player.duration || 0;
                updateTotalDuration();
                // Only update progress bar if this is the active player
                if (index === activePlayerIndex) {
                    updateCustomProgressBar();
                }
            }
        });

        player.addEventListener('seeking', () => {
            if (index === activePlayerIndex) {
                updatePlaybackPosition();
            }
        });

        player.addEventListener('seeked', () => {
            if (index === activePlayerIndex) {
                updatePlaybackPosition();
            }
        });

        // Add click handler to toggle play/pause
        player.addEventListener('click', async () => {
            if (index === activePlayerIndex) {
                try {
                    await togglePlayPause();
                } catch (err) {
                    console.error('Error toggling play/pause:', err);
                }
            }
        });
    });

    isPlayerInitialized = true;
}

// Set global player state and sync UI
function setGlobalPlayerState(state) {
    console.log(`Setting global player state: ${globalPlayerState} -> ${state}`);
    globalPlayerState = state;
    syncUIWithPlayerState();
}

// Sync UI buttons with current player state
function syncUIWithPlayerState() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const overlayBtn = document.querySelector('#playPauseOverlayBtn .btn-icon');
    
    if (globalPlayerState === 'playing') {
        playPauseBtn.textContent = '⏸ Pause';
        overlayBtn.textContent = '⏸';
    } else {
        // paused or ended
        playPauseBtn.textContent = '▶ Play';
        overlayBtn.textContent = '▶';
    }
    
    console.log(`UI synced to state: ${globalPlayerState}`);
}

/**
 * Safely play a video player, tracking the promise to prevent race conditions.
 * Waits for any pending play() operations to complete before starting a new one.
 * This prevents AbortError when play() requests are interrupted.
 * 
 * @param {number} playerIndex - Index of the player (0 or 1)
 * @throws {Error} If the play operation fails
 */
async function safePlay(playerIndex) {
    const player = videoPlayers[playerIndex];
    
    // If there's a pending play promise, wait for it first
    if (pendingPlayPromises[playerIndex]) {
        try {
            await pendingPlayPromises[playerIndex];
        } catch (err) {
            // Ignore errors from previous play attempts
        }
    }
    
    // Start new play operation
    if (player.paused) {
        const playPromise = player.play();
        pendingPlayPromises[playerIndex] = playPromise;
        
        try {
            await playPromise;
            pendingPlayPromises[playerIndex] = null;
        } catch (err) {
            pendingPlayPromises[playerIndex] = null;
            throw err;
        }
    }
}

/**
 * Safely pause a video player, waiting for any pending play operations.
 * Ensures that any in-flight play() promise completes or fails before pausing.
 * This prevents AbortError when pause() interrupts a play() request.
 * 
 * @param {number} playerIndex - Index of the player (0 or 1)
 */
async function safePause(playerIndex) {
    const player = videoPlayers[playerIndex];
    
    // Wait for any pending play promise to complete or fail
    if (pendingPlayPromises[playerIndex]) {
        try {
            await pendingPlayPromises[playerIndex];
        } catch (err) {
            // Ignore errors from play attempts - we're pausing anyway
        }
        pendingPlayPromises[playerIndex] = null;
    }
    
    // Now safe to pause
    if (!player.paused) {
        player.pause();
    }
}

// Apply global state to video player objects
async function applyStateToPlayers() {
    const activePlayer = videoPlayers[activePlayerIndex];
    
    if (globalPlayerState === 'playing') {
        if (activePlayer.paused) {
            try {
                await safePlay(activePlayerIndex);
            } catch (err) {
                console.error('Error playing video:', err);
                setGlobalPlayerState('paused');
            }
        }
    } else {
        // paused or ended
        if (!activePlayer.paused) {
            await safePause(activePlayerIndex);
        }
    }
}

function setPlaybackBtnToPlay() {
    document.getElementById('playPauseBtn').textContent = '⏸ Pause';
    document.querySelector('#playPauseOverlayBtn .btn-icon').textContent = '⏸';
    console.log('Set play/pause button to Play state');
}

// Show player screen and start playback
export function showPlayerScreen(files) {
    if (!files || files.length === 0) {
        alert('No video files to play.');
        return;
    }

    // Set video files and sort by timestamp
    videoFiles = files;
    videoFiles.sort(
        (a, b) => new Date(a.utcTime).getTime() - new Date(b.utcTime).getTime()
    );

    // Hide main screen and show player screen
    document.getElementById('mainScreen').style.display = 'none';
    document.getElementById('playerScreen').style.display = 'block';

    // Initialize player UI
    initializePlayer();
    initializeTimeline();
    initializeCustomControls();

    // Load first video (don't pause on initial load - allow autoplay)
    loadVideo(0, false);
}

// Hide player screen and return to main
export async function hidePlayerScreen() {
    // Safely pause both players
    await Promise.all([
        safePause(0),
        safePause(1)
    ]);
    
    // Clean up video sources
    videoPlayers.forEach((player) => {
        player.removeAttribute('src');
        player.load(); // Reset the video element
    });
    
    setPlaybackBtnToPause();

    // Reset state
    videoFiles = [];
    currentVideoIndex = 0;
    videoDurations = [];
    videoStartTimes = [];
    totalDuration = 0;
    pendingPlayPromises = [null, null]; // Reset play promises

    // Hide player screen and show main screen
    document.getElementById('playerScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
}

// Initialize player controls
function initializePlayer() {
    // Initialize volume
    videoPlayers.forEach((player) => {
        player.volume = 1.0;
    });

    // Initialize video durations array from pre-loaded data if available
    videoDurations = new Array(videoFiles.length);
    videoStartTimes = new Array(videoFiles.length).fill(0);

    // Use pre-loaded durations from scan if available
    let hasPreloadedDurations = false;
    for (let i = 0; i < videoFiles.length; i++) {
        if (
            videoFiles[i].duration !== undefined &&
            videoFiles[i].duration !== null
        ) {
            videoDurations[i] = videoFiles[i].duration;
            hasPreloadedDurations = true;
        } else {
            videoDurations[i] = 1;
        }
    }

    // If we have pre-loaded durations, calculate total immediately
    if (hasPreloadedDurations) {
        updateTotalDuration();
        console.log(
            `Using pre-loaded durations. Total: ${totalDuration.toFixed(2)}s`
        );
    }
}

// Calculate total duration and start times for each video
function updateTotalDuration() {
    totalDuration = 0;
    for (let i = 0; i < videoFiles.length; i++) {
        videoStartTimes[i] = totalDuration;
        totalDuration += videoDurations[i] || 0;
    }
    updateCustomProgressBar();
}

// Load a video into a specific player (0 or 1)
function loadVideoIntoPlayer(videoIndex, playerIndex) {
    if (videoIndex < 0 || videoIndex >= videoFiles.length) {
        return;
    }

    const videoFile = videoFiles[videoIndex];
    const player = videoPlayers[playerIndex];
    const source = videoSources[playerIndex];

    // Set video source
    // In GitHub Pages demo mode, use relative path directly
    // Secure check: hostname must END with .github.io
    const isGitHubPages = window.location.hostname.endsWith('.github.io');
    const videoURL = isGitHubPages 
        ? videoFile.path 
        : `/video?path=${encodeURIComponent(videoFile.path)}`;
    source.src = videoURL;
    player.dataset.videoIndex = videoIndex;
    player.load();
}

// Preload the next video into the inactive player
function preloadNextVideo() {
    const nextVideoIndex = currentVideoIndex + 1;
    if (nextVideoIndex < videoFiles.length) {
        const nextPlayerIndex = 1 - activePlayerIndex;
        loadVideoIntoPlayer(nextVideoIndex, nextPlayerIndex);
    }
}

// Switch to the next video (seamless transition using dual players)
async function switchToNextVideo() {
    const nextVideoIndex = currentVideoIndex + 1;
    if (nextVideoIndex >= videoFiles.length) {
        setGlobalPlayerState('ended');
        return false;
    }

    // Remember if we were playing
    const wasPlaying = globalPlayerState === 'playing';
    
    // Store the previous player index before switching
    const previousPlayerIndex = activePlayerIndex;

    // Switch active player BEFORE pausing the old one
    // This prevents the pause event from triggering the button state update
    activePlayerIndex = 1 - activePlayerIndex;
    currentVideoIndex = nextVideoIndex;

    // Now safely pause the previous player (it's no longer active)
    await safePause(previousPlayerIndex);

    // Hide previous player, show new active player
    videoPlayers[previousPlayerIndex].classList.remove('active-player');
    videoPlayers[activePlayerIndex].classList.add('active-player');

    // Update video info
    const videoFile = videoFiles[currentVideoIndex];
    document.getElementById('currentVideoName').innerHTML = escapeHtml(
        videoFile.filename
    );

    // Update button states
    document.getElementById('prevBtn').disabled = currentVideoIndex === 0;
    document.getElementById('nextBtn').disabled =
        currentVideoIndex === videoFiles.length - 1;

    // Start playback on new active player if we were playing before
    const newActivePlayer = videoPlayers[activePlayerIndex];
    if (wasPlaying) {
        if (newActivePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            newActivePlayer.currentTime = 0;
            try {
                await safePlay(activePlayerIndex);
            } catch (err) {
                console.error('Error playing video:', err);
                setGlobalPlayerState('paused');
            }
        } else {
            // Wait for video to be ready before playing
            let timeoutId;
            const playWhenReady = async () => {
                newActivePlayer.removeEventListener('loadeddata', playWhenReady);
                newActivePlayer.removeEventListener('error', playWhenReady);
                clearTimeout(timeoutId);
                newActivePlayer.currentTime = 0;
                try {
                    await safePlay(activePlayerIndex);
                } catch (err) {
                    console.error('Error playing video:', err);
                    setGlobalPlayerState('paused');
                }
            };
            newActivePlayer.addEventListener('loadeddata', playWhenReady);
            newActivePlayer.addEventListener('error', playWhenReady);
            // Timeout after 10 seconds to prevent memory leak
            timeoutId = setTimeout(() => {
                newActivePlayer.removeEventListener('loadeddata', playWhenReady);
                newActivePlayer.removeEventListener('error', playWhenReady);
                console.error('Timeout waiting for video to load');
                setGlobalPlayerState('paused');
            }, 10000);
        }
    }

    // Preload the next video into the now-inactive player
    preloadNextVideo();

    return true;
}

// Load a video by index (used for seeking/jumping)
async function loadVideo(index, shouldPause = true) {
    if (index < 0 || index >= videoFiles.length) {
        return;
    }

    // Pause when seeking/jumping (but not on initial load)
    if (shouldPause) {
        setGlobalPlayerState('paused');
        
        // Safely pause both players to prevent event conflicts
        await Promise.all([
            safePause(0),
            safePause(1)
        ]);
        
        // Sync UI to paused state
        syncUIWithPlayerState();
    }

    // If seeking backward or far forward, need to reload
    currentVideoIndex = index;
    const videoFile = videoFiles[index];

    // Load into active player
    loadVideoIntoPlayer(index, activePlayerIndex);

    // Update video info - textContent is safe from XSS (unlike innerHTML)
    // It treats the value as plain text, not HTML
    document.getElementById('currentVideoName').innerHTML = escapeHtml(
        videoFile.filename
    );

    // Update button states
    document.getElementById('prevBtn').disabled = index === 0;
    document.getElementById('nextBtn').disabled =
        index === videoFiles.length - 1;

    // Highlight current file marker
    highlightCurrentMarker();

    // Update playback position immediately
    updatePlaybackPosition();

    // Preload next video if available
    if (index + 1 < videoFiles.length) {
        const nextPlayerIndex = 1 - activePlayerIndex;
        loadVideoIntoPlayer(index + 1, nextPlayerIndex);
    }
    
    // If not pausing (initial load), ensure playback starts
    if (!shouldPause) {
        const activePlayer = videoPlayers[activePlayerIndex];
        // Wait for video to be ready before playing
        if (activePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try {
                await safePlay(activePlayerIndex);
            } catch (err) {
                console.error('Error playing video on initial load:', err);
            }
        } else {
            // Wait for video to load
            const playWhenReady = async () => {
                activePlayer.removeEventListener('loadeddata', playWhenReady);
                try {
                    await safePlay(activePlayerIndex);
                } catch (err) {
                    console.error('Error playing video on initial load:', err);
                }
            };
            activePlayer.addEventListener('loadeddata', playWhenReady);
        }
    }
}

function setPlaybackBtnToPause() {
    document.getElementById('playPauseBtn').textContent = '▶ Play';
    document.querySelector('#playPauseOverlayBtn .btn-icon').textContent = '▶';
    console.log('Set play/pause button to Pause state');
}

// Play next video
async function playNextVideo() {
    // Try seamless transition first
    if (await switchToNextVideo()) {
        updateVideoInfo();
        highlightCurrentMarker();
        updatePlaybackPosition();
        updateCustomProgressBar();
        return;
    }

    // If no next video, just ensure UI is updated
    if (currentVideoIndex >= videoFiles.length - 1) {
        // Already at last video
        return;
    }
}

// Play previous video
async function playPreviousVideo() {
    if (currentVideoIndex > 0) {
        await loadVideo(currentVideoIndex - 1);
    }
}

// Toggle play/pause
async function togglePlayPause() {
    const activePlayer = videoPlayers[activePlayerIndex];
    
    // Toggle based on global state
    if (globalPlayerState === 'playing') {
        setGlobalPlayerState('paused');
        await applyStateToPlayers();
    } else {
        // paused or ended
        setGlobalPlayerState('playing');
        await applyStateToPlayers();
    }
}

// Change playback speed
function changePlaybackSpeed(speed) {
    // Clamp speed to supported range
    const clampedSpeed = Math.max(PlaybackRateRange.min, Math.min(PlaybackRateRange.max, speed));
    
    videoPlayers.forEach((player) => {
        player.playbackRate = clampedSpeed;
    });

    // Update speed display
    document.getElementById('speedInput').value = clampedSpeed;
    document.getElementById('speedSlider').value = clampedSpeed;
    document.getElementById('speedValue').textContent = `${clampedSpeed.toFixed(1)}x`;
}

// Update video info display
function updateVideoInfo() {
    const activePlayer = videoPlayers[activePlayerIndex];
    const currentTime = formatTime(activePlayer.currentTime);
    const duration = formatTime(activePlayer.duration);

    document.getElementById(
        'videoProgress'
    ).textContent = `${currentTime} / ${duration} | Video ${
        currentVideoIndex + 1
    } of ${videoFiles.length}`;
}

// Format time in MM:SS format
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Initialize timeline
function initializeTimeline() {
    if (videoFiles.length === 0) return;

    const times = videoFiles.map((f) => new Date(f.utcTime).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    timelineData = {
        minTime,
        maxTime,
        range: maxTime - minTime || 3600000, // 1 hour minimum if all same time
        files: videoFiles,
    };

    // Update timeline labels
    document.getElementById('timelineStart').textContent = new Date(
        minTime
    ).toLocaleString();
    document.getElementById('timelineEnd').textContent = new Date(
        maxTime
    ).toLocaleString();

    // Generate file markers
    const fileMarkersHTML = videoFiles
        .map((file, index) => {
            const rawPosition =
                ((new Date(file.utcTime).getTime() - minTime) /
                    timelineData.range) *
                100;
            // Validate and clamp position to prevent CSS injection
            const position = Math.max(
                0,
                Math.min(100, Number(rawPosition) || 0)
            );
            const clampedPosition = Math.max(
                0,
                Math.min(100, Number(position))
            );
            const fileType = (file.fileType || 'Other').toLowerCase();
            const timestamp = new Date(file.utcTime).toLocaleString();
            const duration = file.duration ? formatTime(file.duration) : 'Unknown';
            const fileTypeDisplay = file.fileType || 'Other';
            
            return `<div class="file-marker file-marker-${escapeHtml(fileType)}"
                     data-index="${index}"
                     data-filename="${escapeHtml(file.filename)}"
                     data-timestamp="${escapeHtml(timestamp)}"
                     data-duration="${escapeHtml(duration)}"
                     data-filetype="${escapeHtml(fileTypeDisplay)}"
                     style="left: ${clampedPosition}%">
                     <div class="file-marker-tooltip">
                         <div class="tooltip-filename">${escapeHtml(file.filename)}</div>
                         <div class="tooltip-timestamp">⏰ ${escapeHtml(timestamp)}</div>
                         <div class="tooltip-duration">⏱️ ${escapeHtml(duration)}</div>
                         <div class="tooltip-filetype">📁 ${escapeHtml(fileTypeDisplay)}</div>
                     </div>
                 </div>`;
        })
        .join('');

    document.getElementById('fileMarkers').innerHTML = fileMarkersHTML;

    // Generate time markers (midnight and noon)
    const timeMarkersHTML = generateTimeMarkers(minTime, maxTime);
    document.getElementById('timeMarkers').innerHTML = timeMarkersHTML;

    // Add click handlers to file markers
    const playerScreen = document.getElementById('playerScreen');
    playerScreen.querySelectorAll('.file-marker').forEach((marker) => {
        marker.addEventListener('click', () => {
            const index = parseInt(marker.dataset.index);
            loadVideo(index);
        });
    });

    // Highlight the first marker initially
    highlightCurrentMarker();

    // Add click handler to timeline track for seeking
    document.getElementById('timelineTrack').addEventListener('click', (e) => {
        if (e.target.classList.contains('file-marker')) return; // Already handled

        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percent = (clickX / rect.width) * 100;
        const clickTime = minTime + (percent / 100) * timelineData.range;

        // Find the video file closest to this time
        let closestIndex = 0;
        let minDiff = Math.abs(
            new Date(videoFiles[0].utcTime).getTime() - clickTime
        );

        for (let i = 1; i < videoFiles.length; i++) {
            const diff = Math.abs(
                new Date(videoFiles[i].utcTime).getTime() - clickTime
            );
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }

        loadVideo(closestIndex);
    });
}

// Generate time markers for midnight and noon
function generateTimeMarkers(minTime, maxTime) {
    const markers = [];
    const startDate = new Date(minTime);
    const endDate = new Date(maxTime);

    const currentDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
    );

    while (currentDate <= endDate) {
        const dayStart = new Date(currentDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(23, 59, 59, 999);

        if (dayEnd.getTime() >= minTime && dayStart.getTime() <= maxTime) {
            // Midnight marker
            const midnight = new Date(currentDate);
            midnight.setHours(0, 0, 0, 0);

            if (
                midnight.getTime() >= minTime &&
                midnight.getTime() <= maxTime
            ) {
                const position =
                    ((midnight.getTime() - minTime) / (maxTime - minTime)) *
                    100;
                const dateStr = midnight.toLocaleDateString();
                const timeStr = midnight.toLocaleTimeString();
                markers.push(`
                    <div class="time-marker midnight" data-time="${midnight.getTime()}" style="left: ${position}%">
                        <div class="time-marker-tooltip">🌙 Midnight<br>${dateStr} ${timeStr}</div>
                    </div>
                `);
            }

            // Noon marker
            const noon = new Date(currentDate);
            noon.setHours(12, 0, 0, 0);

            if (noon.getTime() >= minTime && noon.getTime() <= maxTime) {
                const position =
                    ((noon.getTime() - minTime) / (maxTime - minTime)) * 100;
                const dateStr = noon.toLocaleDateString();
                const timeStr = noon.toLocaleTimeString();
                markers.push(`
                    <div class="time-marker noon" data-time="${noon.getTime()}" style="left: ${position}%">
                        <div class="time-marker-tooltip">☀️ Noon<br>${dateStr} ${timeStr}</div>
                    </div>
                `);
            }
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return markers.join('');
}

// Update playback position indicator on timeline
function updatePlaybackPosition() {
    if (!timelineData || totalDuration === 0) return;

    const activePlayer = videoPlayers[activePlayerIndex];
    const videoIdx = parseInt(activePlayer.dataset.videoIndex);

    if (isNaN(videoIdx) || videoDurations[videoIdx] === undefined) return;

    // Calculate current global playback time (not UTC time)
    const globalTime = videoStartTimes[videoIdx] + activePlayer.currentTime;
    
    // Map global playback time to timeline position
    // Timeline represents UTC timestamps, but we want smooth progression
    // Map from [0, totalDuration] to [minTime, maxTime]
    const timelinePosition = timelineData.minTime + 
        (globalTime / totalDuration) * timelineData.range;

    // Calculate position percentage
    const position =
        ((timelinePosition - timelineData.minTime) / timelineData.range) * 100;

    // Update position indicator
    const playbackPosition = document.getElementById('playbackPosition');
    playbackPosition.style.left = `${Math.max(0, Math.min(100, position))}%`;
}

// Highlight current file marker
function highlightCurrentMarker() {
    // Remove highlight from all markers
    const playerScreen = document.getElementById('playerScreen');
    playerScreen.querySelectorAll('.file-marker').forEach((marker) => {
        marker.classList.remove('current-marker');
    });

    // Add highlight to current marker
    const currentMarker = playerScreen.querySelector(
        `.file-marker[data-index="${currentVideoIndex}"]`
    );
    if (currentMarker) {
        currentMarker.classList.add('current-marker');
    }
}

// Initialize custom controls overlay
function initializeCustomControls() {
    const progressContainer = document.getElementById('progressBarContainer');
    const progressHandle = document.getElementById('progressHandle');
    const playPauseOverlayBtn = document.getElementById('playPauseOverlayBtn');
    const muteBtn = document.getElementById('muteBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');

    // Play/Pause button
    playPauseOverlayBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await togglePlayPause();
        } catch (err) {
            console.error('Error toggling play/pause:', err);
        }
    });

    // Mute button
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const activePlayer = videoPlayers[activePlayerIndex];
        activePlayer.muted = !activePlayer.muted;
        muteBtn.querySelector('.btn-icon').textContent = activePlayer.muted
            ? '🔇'
            : '🔊';

        // Apply to both players
        videoPlayers.forEach((player) => {
            player.muted = activePlayer.muted;
        });
    });

    // Volume slider
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        videoPlayers.forEach((player) => {
            player.volume = volume;
            player.muted = false;
        });
        muteBtn.querySelector('.btn-icon').textContent =
            volume === 0 ? '🔇' : '🔊';
    });
    
    // Screenshot button
    screenshotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        takeScreenshot();
    });
    
    // Fullscreen button
    fullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const videoWrapper = document.querySelector('.video-wrapper');
        if (!document.fullscreenElement) {
            videoWrapper.requestFullscreen().catch((err) => {
                console.error('Error entering fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    });

    // Progress bar seeking
    let isDragging = false;

    const startDrag = async (e) => {
        isDragging = true;
        isDraggingProgress = true;
        
        // Pause playback when starting to seek
        setGlobalPlayerState('paused');
        await applyStateToPlayers();
        
        handleProgressDrag(e);
    };

    const handleProgressDrag = (e) => {
        if (!isDragging) return;

        const rect = progressContainer.getBoundingClientRect();
        const clickX = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
        const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));

        // Update progress bar visually
        updateProgressBarVisual(percent);
    };

    const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;

        const rect = progressContainer.getBoundingClientRect();
        const clickX =
            (e.clientX || e.changedTouches?.[0]?.clientX) - rect.left;
        const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));

        // Seek to the clicked position (will remain paused)
        seekToGlobalPercent(percent);

        setTimeout(() => {
            isDraggingProgress = false;
        }, 100);
    };

    progressHandle.addEventListener('mousedown', startDrag);
    progressContainer.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', handleProgressDrag);
    document.addEventListener('mouseup', endDrag);

    // Touch support
    progressHandle.addEventListener('touchstart', startDrag);
    progressContainer.addEventListener('touchstart', startDrag);
    document.addEventListener('touchmove', handleProgressDrag);
    document.addEventListener('touchend', endDrag);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// Update custom progress bar based on current playback
function updateCustomProgressBar() {
    if (totalDuration === 0) return;

    // Calculate current global time
    const activePlayer = videoPlayers[activePlayerIndex];
    const videoIdx = parseInt(activePlayer.dataset.videoIndex);

    if (isNaN(videoIdx) || videoDurations[videoIdx] === undefined) return;

    currentGlobalTime = videoStartTimes[videoIdx] + activePlayer.currentTime;
    const percent = (currentGlobalTime / totalDuration) * 100;

    updateProgressBarVisual(percent);

    // Update time display
    document.getElementById('currentTime').textContent =
        formatTime(currentGlobalTime);
    document.getElementById('totalDuration').textContent =
        formatTime(totalDuration);
}

// Update progress bar visual appearance
function updateProgressBarVisual(percent) {
    const progressPlayed = document.getElementById('progressPlayed');
    const progressHandle = document.getElementById('progressHandle');

    progressPlayed.style.width = `${percent}%`;
    progressHandle.style.left = `${percent}%`;
}

// Seek to a specific percentage of the total duration
function seekToGlobalPercent(percent) {
    const targetTime = (percent / 100) * totalDuration;
    seekToGlobalTime(targetTime);
}

// Seek to a specific time in the global timeline
function seekToGlobalTime(targetTime) {
    // Find which video this time corresponds to
    let targetVideoIndex = 0;
    let localTime = targetTime;

    for (let i = 0; i < videoFiles.length; i++) {
        if (videoStartTimes[i] + videoDurations[i] > targetTime) {
            targetVideoIndex = i;
            localTime = targetTime - videoStartTimes[i];
            break;
        }
    }

    // If we need to change videos
    if (targetVideoIndex !== currentVideoIndex) {
        currentVideoIndex = targetVideoIndex;
        loadVideo(targetVideoIndex);

        // Wait for video to load, then seek (with timeout to prevent memory leak)
        let attempts = 0;
        const maxAttempts = 100; // 5 seconds max (100 * 50ms)
        const checkLoaded = setInterval(() => {
            attempts++;
            const activePlayer = videoPlayers[activePlayerIndex];
            if (activePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                clearInterval(checkLoaded);
                activePlayer.currentTime = localTime;
                updateCustomProgressBar();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkLoaded);
                console.error('Timeout waiting for video to load');
            }
        }, 50);
    } else {
        // Same video, just seek
        const activePlayer = videoPlayers[activePlayerIndex];
        activePlayer.currentTime = localTime;
        updateCustomProgressBar();
    }
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
    // Only handle shortcuts when player screen is visible
    const playerScreen = document.getElementById('playerScreen');
    if (!playerScreen || playerScreen.style.display === 'none') {
        return;
    }
    
    // Ignore shortcuts when typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // 'S' key for screenshot
    if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        takeScreenshot();
    }
}

// Take screenshot of current video frame
function takeScreenshot() {
    const activePlayer = videoPlayers[activePlayerIndex];
    
    // Check if video is loaded
    if (!activePlayer || activePlayer.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        console.warn('Video not ready for screenshot');
        showScreenshotFeedback(false, 'Video not ready');
        return;
    }
    
    try {
        // Create a canvas element
        const canvas = document.createElement('canvas');
        canvas.width = activePlayer.videoWidth;
        canvas.height = activePlayer.videoHeight;
        
        // Draw the current video frame to the canvas
        const ctx = canvas.getContext('2d');
        ctx.drawImage(activePlayer, 0, 0, canvas.width, canvas.height);
        
        // Generate filename with timestamp and video info
        const currentFile = videoFiles[currentVideoIndex];
        const now = new Date();
        // Format timestamp as YYYY-MM-DD_HH-MM-SS
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
        const videoName = currentFile ? currentFile.filename.replace(/\.MP4$/i, '') : 'video';
        const currentTime = formatTime(activePlayer.currentTime).replace(/:/g, '-');
        const filename = `screenshot_${videoName}_${currentTime}_${timestamp}.png`;
        
        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
            if (!blob) {
                console.error('Failed to create screenshot blob');
                showScreenshotFeedback(false, 'Failed to create screenshot');
                return;
            }
            
            // Create download link
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            // Clean up
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            // Show success feedback (don't show full filename for security)
            showScreenshotFeedback(true, 'Screenshot captured successfully');
            console.log('Screenshot saved:', filename);
        }, 'image/png');
        
    } catch (err) {
        console.error('Error taking screenshot:', err);
        showScreenshotFeedback(false, 'Error: ' + err.message);
    }
}

// Show visual feedback when screenshot is taken
function showScreenshotFeedback(success, message) {
    // Create feedback element
    const feedback = document.createElement('div');
    feedback.className = 'screenshot-feedback';
    feedback.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: ${success ? 'rgba(0, 128, 0, 0.9)' : 'rgba(255, 0, 0, 0.9)'};
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 18px;
        font-weight: bold;
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
        pointer-events: none;
    `;
    feedback.textContent = success ? `📷 ${message}` : `❌ ${message}`;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
            20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
    `;
    
    if (!document.querySelector('style[data-screenshot-animation]')) {
        style.setAttribute('data-screenshot-animation', 'true');
        document.head.appendChild(style);
    }
    
    document.body.appendChild(feedback);
    
    // Remove after animation
    setTimeout(() => {
        document.body.removeChild(feedback);
    }, 2000);
}

// Export functionality
function openExportModal() {
    const modal = document.getElementById('exportModal');
    
    // Update export info
    document.getElementById('exportVideoCount').textContent = videoFiles.length;
    document.getElementById('exportTotalDuration').textContent = formatTime(totalDuration);
    
    // Load saved output folder
    const savedOutputFolder = localStorage.getItem('mp4-combiner-output-folder') || '';
    document.getElementById('exportOutputFolder').value = savedOutputFolder;
    
    // Generate default filename based on current date/time
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const defaultFilename = `exported_${year}-${month}-${day}_${hours}-${minutes}.mp4`;
    
    document.getElementById('exportOutputFilename').value = defaultFilename;
    
    // Clear any previous status
    document.getElementById('exportStatus').innerHTML = '';
    
    // Show modal
    modal.style.display = 'flex';
}

function closeExportModal() {
    const modal = document.getElementById('exportModal');
    modal.style.display = 'none';
}

function openExportFolderBrowser() {
    // Set flag to indicate we're browsing for export output
    window.browsingForExport = true;
    
    // Trigger the folder browser
    const browseFolderBtn = document.getElementById('browseFolderBtn');
    browseFolderBtn.click();
}

async function performExport() {
    const outputFolder = document.getElementById('exportOutputFolder').value.trim();
    const outputFilename = document.getElementById('exportOutputFilename').value.trim();
    const statusDiv = document.getElementById('exportStatus');
    
    // Validate inputs
    if (!outputFolder) {
        statusDiv.innerHTML = '<div class="error">Please select an output folder</div>';
        return;
    }
    
    if (!outputFilename) {
        statusDiv.innerHTML = '<div class="error">Please enter an output filename</div>';
        return;
    }
    
    // Construct the full output path
    const separator = outputFolder.includes('\\') ? '\\' : '/';
    const outputPath = outputFolder.endsWith(separator) 
        ? `${outputFolder}${outputFilename}` 
        : `${outputFolder}${separator}${outputFilename}`;
    
    // Get all video file paths
    const filePaths = videoFiles.map(f => f.path);
    
    // Disable export button during export
    const exportBtn = document.getElementById('exportConfirmBtn');
    exportBtn.disabled = true;
    
    statusDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Exporting ${videoFiles.length} video(s)...</div>`;
    
    try {
        const response = await fetch('/combine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filePaths, outputPath })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            // Show error snackbar
            showSnackbar(`Export failed: ${data.error}`, 'error', 5000);
            closeExportModal();
            exportBtn.disabled = false;
            return;
        }
        
        // Save output folder to localStorage
        localStorage.setItem('mp4-combiner-output-folder', outputFolder);
        
        // Show success snackbar with output path
        showSnackbar(`✅ Export successful! Saved to: ${data.output}`, 'success', 5000);
        
        // Close modal immediately
        closeExportModal();
        exportBtn.disabled = false;
        
    } catch (error) {
        // Show network error snackbar
        showSnackbar('Export failed: Network error', 'error', 5000);
        closeExportModal();
        exportBtn.disabled = false;
    }
}
