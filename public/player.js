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

// HTML escape function to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize the player module (called once on page load)
export function initPlayer() {
    // Initialize dual players references
    videoPlayers[0] = document.getElementById('videoPlayer1');
    videoPlayers[1] = document.getElementById('videoPlayer2');
    videoSources[0] = document.getElementById('videoSource1');
    videoSources[1] = document.getElementById('videoSource2');
    
    // Set up event listeners for back button
    document.getElementById('backBtn').addEventListener('click', () => {
        hidePlayerScreen();
    });
    
    document.getElementById('prevBtn').addEventListener('click', () => {
        playPreviousVideo();
    });
    
    document.getElementById('nextBtn').addEventListener('click', () => {
        playNextVideo();
    });
    
    document.getElementById('playPauseBtn').addEventListener('click', () => {
        togglePlayPause();
    });
    
    // Speed control event listeners
    document.getElementById('speedInput').addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        if (speed >= 0.1 && speed <= 50) {
            changePlaybackSpeed(speed);
        }
    });
    
    document.getElementById('speedSlider').addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        changePlaybackSpeed(speed);
    });
    
    // Speed preset buttons
    document.querySelectorAll('.preset-speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.dataset.speed);
            changePlaybackSpeed(speed);
        });
    });
    
    // Video player events for both players
    videoPlayers.forEach((player, index) => {
        player.addEventListener('ended', () => {
            if (index === activePlayerIndex) {
                playNextVideo();
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
                document.getElementById('playPauseBtn').textContent = '⏸ Pause';
                document.querySelector('#playPauseOverlayBtn .btn-icon').textContent = '⏸';
            }
        });
        
        player.addEventListener('pause', () => {
            if (index === activePlayerIndex) {
                document.getElementById('playPauseBtn').textContent = '▶ Play';
                document.querySelector('#playPauseOverlayBtn .btn-icon').textContent = '▶';
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
    });
    
    isPlayerInitialized = true;
}

// Show player screen and start playback
export function showPlayerScreen(files) {
    if (!files || files.length === 0) {
        alert('No video files to play.');
        return;
    }
    
    // Set video files and sort by timestamp
    videoFiles = files;
    videoFiles.sort((a, b) => new Date(a.utcTime).getTime() - new Date(b.utcTime).getTime());
    
    // Hide main screen and show player screen
    document.getElementById('mainScreen').style.display = 'none';
    document.getElementById('playerScreen').style.display = 'block';
    
    // Initialize player UI
    initializePlayer();
    initializeTimeline();
    initializeCustomControls();
    
    // Load first video
    loadVideo(0);
}

// Hide player screen and return to main
export function hidePlayerScreen() {
    // Pause playback
    videoPlayers.forEach(player => {
        player.pause();
        player.removeAttribute('src');
        player.load(); // Reset the video element
    });
    
    // Reset state
    videoFiles = [];
    currentVideoIndex = 0;
    videoDurations = [];
    videoStartTimes = [];
    totalDuration = 0;
    
    // Hide player screen and show main screen
    document.getElementById('playerScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
}

// Initialize player controls
function initializePlayer() {
    // Initialize volume
    videoPlayers.forEach(player => {
        player.volume = 1.0;
    });
    
    // Initialize video durations array
    videoDurations = new Array(videoFiles.length).fill(0);
    videoStartTimes = new Array(videoFiles.length).fill(0);
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
    const videoURL = `/video?path=${encodeURIComponent(videoFile.path)}`;
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
function switchToNextVideo() {
    const nextVideoIndex = currentVideoIndex + 1;
    if (nextVideoIndex >= videoFiles.length) {
        return false;
    }
    
    // Pause and reset the previous player to prevent it from firing events
    const previousPlayerIndex = activePlayerIndex;
    videoPlayers[previousPlayerIndex].pause();
    
    // Switch active player
    activePlayerIndex = 1 - activePlayerIndex;
    currentVideoIndex = nextVideoIndex;
    
    // Hide previous player, show new active player
    videoPlayers[previousPlayerIndex].classList.remove('active-player');
    videoPlayers[activePlayerIndex].classList.add('active-player');
    
    // Update video info
    const videoFile = videoFiles[currentVideoIndex];
    document.getElementById('currentVideoName').innerHTML = escapeHtml(videoFile.filename);
    
    // Update button states
    document.getElementById('prevBtn').disabled = currentVideoIndex === 0;
    document.getElementById('nextBtn').disabled = currentVideoIndex === videoFiles.length - 1;
    
    // Start playback on new active player (only if video is ready)
    const newActivePlayer = videoPlayers[activePlayerIndex];
    if (newActivePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        newActivePlayer.currentTime = 0;
        newActivePlayer.play().catch(err => {
            console.error('Error playing video:', err);
        });
    } else {
        // Wait for video to be ready before playing
        let timeoutId;
        const playWhenReady = () => {
            newActivePlayer.removeEventListener('loadeddata', playWhenReady);
            newActivePlayer.removeEventListener('error', playWhenReady);
            clearTimeout(timeoutId);
            newActivePlayer.currentTime = 0;
            newActivePlayer.play().catch(err => {
                console.error('Error playing video:', err);
            });
        };
        newActivePlayer.addEventListener('loadeddata', playWhenReady);
        newActivePlayer.addEventListener('error', playWhenReady);
        // Timeout after 10 seconds to prevent memory leak
        timeoutId = setTimeout(() => {
            newActivePlayer.removeEventListener('loadeddata', playWhenReady);
            newActivePlayer.removeEventListener('error', playWhenReady);
            console.error('Timeout waiting for video to load');
        }, 10000);
    }
    
    // Preload the next video into the now-inactive player
    preloadNextVideo();
    
    return true;
}

// Load a video by index (used for seeking/jumping)
function loadVideo(index) {
    if (index < 0 || index >= videoFiles.length) {
        return;
    }
    
    // Pause both players to prevent event conflicts
    videoPlayers.forEach(player => player.pause());
    
    // If seeking backward or far forward, need to reload
    currentVideoIndex = index;
    const videoFile = videoFiles[index];
    
    // Load into active player
    loadVideoIntoPlayer(index, activePlayerIndex);
    
    // Update video info - textContent is safe from XSS (unlike innerHTML)
    // It treats the value as plain text, not HTML
    document.getElementById('currentVideoName').innerHTML = escapeHtml(videoFile.filename);
    
    // Update button states
    document.getElementById('prevBtn').disabled = index === 0;
    document.getElementById('nextBtn').disabled = index === videoFiles.length - 1;
    
    // Highlight current file marker
    highlightCurrentMarker();
    
    // Preload next video if available
    if (index + 1 < videoFiles.length) {
        const nextPlayerIndex = 1 - activePlayerIndex;
        loadVideoIntoPlayer(index + 1, nextPlayerIndex);
    }
}

// Play next video
function playNextVideo() {
    // Try seamless transition first
    if (switchToNextVideo()) {
        updateVideoInfo();
        highlightCurrentMarker();
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
function playPreviousVideo() {
    if (currentVideoIndex > 0) {
        loadVideo(currentVideoIndex - 1);
    }
}

// Toggle play/pause
function togglePlayPause() {
    const activePlayer = videoPlayers[activePlayerIndex];
    if (activePlayer.paused) {
        activePlayer.play();
    } else {
        activePlayer.pause();
    }
}

// Change playback speed
function changePlaybackSpeed(speed) {
    videoPlayers.forEach(player => {
        player.playbackRate = speed;
    });
    
    // Update speed display
    document.getElementById('speedInput').value = speed;
    document.getElementById('speedSlider').value = speed;
    document.getElementById('speedValue').textContent = `${speed.toFixed(1)}x`;
}

// Update video info display
function updateVideoInfo() {
    const activePlayer = videoPlayers[activePlayerIndex];
    const currentTime = formatTime(activePlayer.currentTime);
    const duration = formatTime(activePlayer.duration);
    
    document.getElementById('videoProgress').textContent = 
        `${currentTime} / ${duration} | Video ${currentVideoIndex + 1} of ${videoFiles.length}`;
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
    
    const times = videoFiles.map(f => new Date(f.utcTime).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    timelineData = {
        minTime,
        maxTime,
        range: maxTime - minTime || 3600000, // 1 hour minimum if all same time
        files: videoFiles
    };
    
    // Update timeline labels
    document.getElementById('timelineStart').textContent = new Date(minTime).toLocaleString();
    document.getElementById('timelineEnd').textContent = new Date(maxTime).toLocaleString();
    
    // Generate file markers
    const fileMarkersHTML = videoFiles.map((file, index) => {
        const rawPosition = ((new Date(file.utcTime).getTime() - minTime) / timelineData.range) * 100;
        // Validate and clamp position to prevent CSS injection
        const position = Math.max(0, Math.min(100, Number(rawPosition) || 0));
        const clampedPosition = Math.max(0, Math.min(100, Number(position)));
        const fileType = (file.fileType || 'Other').toLowerCase();
        return `<div class="file-marker file-marker-${escapeHtml(fileType)}" 
                     data-index="${index}" 
                     style="left: ${clampedPosition}%" 
                     title="${escapeHtml(file.filename)}"></div>`;
    }).join('');
    
    document.getElementById('fileMarkers').innerHTML = fileMarkersHTML;
    
    // Generate time markers (midnight and noon)
    const timeMarkersHTML = generateTimeMarkers(minTime, maxTime);
    document.getElementById('timeMarkers').innerHTML = timeMarkersHTML;
    
    // Add click handlers to file markers
    document.querySelectorAll('.file-marker').forEach(marker => {
        marker.addEventListener('click', () => {
            const index = parseInt(marker.dataset.index);
            loadVideo(index);
        });
    });
    
    // Add click handler to timeline track for seeking
    document.getElementById('timelineTrack').addEventListener('click', (e) => {
        if (e.target.classList.contains('file-marker')) return; // Already handled
        
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percent = (clickX / rect.width) * 100;
        const clickTime = minTime + (percent / 100) * timelineData.range;
        
        // Find the video file closest to this time
        let closestIndex = 0;
        let minDiff = Math.abs(new Date(videoFiles[0].utcTime).getTime() - clickTime);
        
        for (let i = 1; i < videoFiles.length; i++) {
            const diff = Math.abs(new Date(videoFiles[i].utcTime).getTime() - clickTime);
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
    
    const currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    
    while (currentDate <= endDate) {
        const dayStart = new Date(currentDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(23, 59, 59, 999);
        
        if (dayEnd.getTime() >= minTime && dayStart.getTime() <= maxTime) {
            // Midnight marker
            const midnight = new Date(currentDate);
            midnight.setHours(0, 0, 0, 0);
            
            if (midnight.getTime() >= minTime && midnight.getTime() <= maxTime) {
                const position = ((midnight.getTime() - minTime) / (maxTime - minTime)) * 100;
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
                const position = ((noon.getTime() - minTime) / (maxTime - minTime)) * 100;
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
    if (!timelineData) return;
    
    const activePlayer = videoPlayers[activePlayerIndex];
    const currentFile = videoFiles[currentVideoIndex];
    
    if (!currentFile) return;
    
    // Calculate the time offset of current video in the overall timeline
    const videoStartTime = new Date(currentFile.utcTime).getTime();
    const currentVideoTime = activePlayer.currentTime * 1000; // Convert to milliseconds
    const totalTime = videoStartTime + currentVideoTime;
    
    // Calculate position percentage
    const position = ((totalTime - timelineData.minTime) / timelineData.range) * 100;
    
    // Update position indicator
    const playbackPosition = document.getElementById('playbackPosition');
    playbackPosition.style.left = `${Math.max(0, Math.min(100, position))}%`;
}

// Highlight current file marker
function highlightCurrentMarker() {
    // Remove highlight from all markers
    document.querySelectorAll('.file-marker').forEach(marker => {
        marker.classList.remove('current-marker');
    });
    
    // Add highlight to current marker
    const currentMarker = document.querySelector(`.file-marker[data-index="${currentVideoIndex}"]`);
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
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    
    // Play/Pause button
    playPauseOverlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayPause();
    });
    
    // Mute button
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const activePlayer = videoPlayers[activePlayerIndex];
        activePlayer.muted = !activePlayer.muted;
        muteBtn.querySelector('.btn-icon').textContent = activePlayer.muted ? '🔇' : '🔊';
        
        // Apply to both players
        videoPlayers.forEach(player => {
            player.muted = activePlayer.muted;
        });
    });
    
    // Volume slider
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        videoPlayers.forEach(player => {
            player.volume = volume;
            player.muted = false;
        });
        muteBtn.querySelector('.btn-icon').textContent = volume === 0 ? '🔇' : '🔊';
    });
    
    // Fullscreen button
    fullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const videoWrapper = document.querySelector('.video-wrapper');
        if (!document.fullscreenElement) {
            videoWrapper.requestFullscreen().catch(err => {
                console.error('Error entering fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    });
    
    // Progress bar seeking
    let isDragging = false;
    
    const startDrag = (e) => {
        isDragging = true;
        isDraggingProgress = true;
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
        const clickX = (e.clientX || e.changedTouches?.[0]?.clientX) - rect.left;
        const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
        
        // Seek to the clicked position
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
    document.getElementById('currentTime').textContent = formatTime(currentGlobalTime);
    document.getElementById('totalDuration').textContent = formatTime(totalDuration);
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
