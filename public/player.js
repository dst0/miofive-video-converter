// Video Player JavaScript

let videoFiles = [];
let currentVideoIndex = 0;
let timelineData = null;
<<<<<<< HEAD
let activePlayer = 1; // 1 or 2, indicates which player is currently active
let isTransitioning = false;
=======
>>>>>>> origin/main

// HTML escape function to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Parse URL parameters to get video file list
function getVideoFilesFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const filesParam = urlParams.get('files');
    
    if (!filesParam) {
        return [];
    }
    
    try {
        return JSON.parse(decodeURIComponent(filesParam));
    } catch (e) {
        console.error('Error parsing video files from URL:', e);
        return [];
    }
}

// Initialize the video player
document.addEventListener('DOMContentLoaded', () => {
    videoFiles = getVideoFilesFromURL();
    
    if (videoFiles.length === 0) {
        alert('No video files to play. Please select videos from the main page.');
        window.location.href = '/';
        return;
    }
    
    // Sort files by timestamp
    videoFiles.sort((a, b) => new Date(a.utcTime).getTime() - new Date(b.utcTime).getTime());
    
    // Initialize player
    initializePlayer();
    initializeTimeline();
    
    // Set up event listeners
    document.getElementById('backBtn').addEventListener('click', () => {
        window.location.href = '/';
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
    
    document.getElementById('speedControl').addEventListener('change', (e) => {
        changePlaybackSpeed(parseFloat(e.target.value));
    });
    
    // Video player events
<<<<<<< HEAD
    const videoPlayer1 = document.getElementById('videoPlayer1');
    const videoPlayer2 = document.getElementById('videoPlayer2');
    
    // Set up event listeners for both players
    [videoPlayer1, videoPlayer2].forEach((player, index) => {
        const playerNumber = index + 1;
        
        player.addEventListener('ended', () => {
            if (activePlayer === playerNumber) {
                playNextVideo();
            }
        });
        
        player.addEventListener('timeupdate', () => {
            if (activePlayer === playerNumber) {
                updatePlaybackPosition();
                updateVideoInfo();
            }
        });
        
        player.addEventListener('play', () => {
            if (activePlayer === playerNumber) {
                document.getElementById('playPauseBtn').textContent = '⏸ Pause';
            }
        });
        
        player.addEventListener('pause', () => {
            if (activePlayer === playerNumber) {
                document.getElementById('playPauseBtn').textContent = '▶ Play';
            }
        });
=======
    const videoPlayer = document.getElementById('videoPlayer');
    
    videoPlayer.addEventListener('ended', () => {
        playNextVideo();
    });
    
    videoPlayer.addEventListener('timeupdate', () => {
        updatePlaybackPosition();
        updateVideoInfo();
    });
    
    videoPlayer.addEventListener('play', () => {
        document.getElementById('playPauseBtn').textContent = '⏸ Pause';
    });
    
    videoPlayer.addEventListener('pause', () => {
        document.getElementById('playPauseBtn').textContent = '▶ Play';
>>>>>>> origin/main
    });
    
    // Load first video
    loadVideo(0);
});

// Initialize player controls
function initializePlayer() {
<<<<<<< HEAD
    const videoPlayer1 = document.getElementById('videoPlayer1');
    const videoPlayer2 = document.getElementById('videoPlayer2');
    videoPlayer1.volume = 1.0;
    videoPlayer2.volume = 1.0;
}

// Get the currently active video player
function getActivePlayer() {
    return document.getElementById(`videoPlayer${activePlayer}`);
}

// Get the inactive (background) video player
function getInactivePlayer() {
    const inactivePlayerNumber = activePlayer === 1 ? 2 : 1;
    return document.getElementById(`videoPlayer${inactivePlayerNumber}`);
}

// Swap active and inactive players
function swapPlayers() {
    const currentActive = getActivePlayer();
    const currentInactive = getInactivePlayer();
    
    // Remove active class from current active player
    currentActive.classList.remove('active');
    
    // Add active class to new active player
    currentInactive.classList.add('active');
    
    // Pause the old active player
    currentActive.pause();
    
    // Play the new active player
    currentInactive.play().catch(err => {
        console.error('Error playing video:', err);
    });
    
    // Update active player number
    activePlayer = activePlayer === 1 ? 2 : 1;
}

// Preload next video in the inactive player
function preloadNextVideo() {
    const nextIndex = currentVideoIndex + 1;
    if (nextIndex >= videoFiles.length) {
        return; // No next video to preload
    }
    
    const inactivePlayer = getInactivePlayer();
    const inactivePlayerNumber = activePlayer === 1 ? 2 : 1;
    const inactiveSource = document.getElementById(`videoSource${inactivePlayerNumber}`);
    const nextVideoFile = videoFiles[nextIndex];
    
    const videoURL = `/video?path=${encodeURIComponent(nextVideoFile.path)}`;
    inactiveSource.src = videoURL;
    inactivePlayer.load();
    
    // Sync volume and playback rate with active player
    const activePlayerElement = getActivePlayer();
    inactivePlayer.volume = activePlayerElement.volume;
    inactivePlayer.playbackRate = activePlayerElement.playbackRate;
=======
    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.volume = 1.0;
>>>>>>> origin/main
}

// Load a video by index
function loadVideo(index) {
<<<<<<< HEAD
    if (index < 0 || index >= videoFiles.length || isTransitioning) {
        return;
    }
    
    isTransitioning = true;
    currentVideoIndex = index;
    const videoFile = videoFiles[index];
    const currentPlayer = getActivePlayer();
    const currentPlayerNumber = activePlayer;
    const currentSource = document.getElementById(`videoSource${currentPlayerNumber}`);
    
    // Set video source
    const videoURL = `/video?path=${encodeURIComponent(videoFile.path)}`;
    currentSource.src = videoURL;
    currentPlayer.load();
    
    // Wait for the video to be ready to play
    currentPlayer.addEventListener('loadeddata', () => {
        isTransitioning = false;
        
        // Preload the next video
        preloadNextVideo();
    }, { once: true });
    
    // Update video info - textContent is safe from XSS (unlike innerHTML)
    // It treats the value as plain text, not HTML
    document.getElementById('currentVideoName').textContent = videoFile.filename;
=======
    if (index < 0 || index >= videoFiles.length) {
        return;
    }
    
    currentVideoIndex = index;
    const videoFile = videoFiles[index];
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    
    // Set video source
    const videoURL = `/video?path=${encodeURIComponent(videoFile.path)}`;
    videoSource.src = videoURL;
    videoPlayer.load();
    
    // Update video info - textContent is safe from XSS (unlike innerHTML)
    // It treats the value as plain text, not HTML
    document.getElementById('currentVideoName').innerHTML = escapeHtml(videoFile.filename);
>>>>>>> origin/main
    
    // Update button states
    document.getElementById('prevBtn').disabled = index === 0;
    document.getElementById('nextBtn').disabled = index === videoFiles.length - 1;
    
    // Highlight current file marker
    highlightCurrentMarker();
}

// Play next video
function playNextVideo() {
<<<<<<< HEAD
    if (currentVideoIndex < videoFiles.length - 1 && !isTransitioning) {
        const nextIndex = currentVideoIndex + 1;
        const nextVideoFile = videoFiles[nextIndex];
        
        // Check if next video is already preloaded in inactive player
        const inactivePlayer = getInactivePlayer();
        const inactivePlayerNumber = activePlayer === 1 ? 2 : 1;
        const inactiveSource = document.getElementById(`videoSource${inactivePlayerNumber}`);
        const expectedURL = `/video?path=${encodeURIComponent(nextVideoFile.path)}`;
        
        if (inactiveSource.src.endsWith(expectedURL)) {
            // Next video is preloaded, swap players
            currentVideoIndex = nextIndex;
            isTransitioning = true;
            
            // Update video info
            document.getElementById('currentVideoName').textContent = nextVideoFile.filename;
            
            // Update button states
            document.getElementById('prevBtn').disabled = nextIndex === 0;
            document.getElementById('nextBtn').disabled = nextIndex === videoFiles.length - 1;
            
            // Highlight current file marker
            highlightCurrentMarker();
            
            // Swap the players
            swapPlayers();
            
            // Preload the next video after a short delay
            setTimeout(() => {
                isTransitioning = false;
                preloadNextVideo();
            }, 100);
        } else {
            // Fallback: load video directly if not preloaded
            loadVideo(nextIndex);
        }
=======
    if (currentVideoIndex < videoFiles.length - 1) {
        loadVideo(currentVideoIndex + 1);
>>>>>>> origin/main
    }
}

// Play previous video
function playPreviousVideo() {
<<<<<<< HEAD
    if (currentVideoIndex > 0 && !isTransitioning) {
=======
    if (currentVideoIndex > 0) {
>>>>>>> origin/main
        loadVideo(currentVideoIndex - 1);
    }
}

// Toggle play/pause
function togglePlayPause() {
<<<<<<< HEAD
    const videoPlayer = getActivePlayer();
=======
    const videoPlayer = document.getElementById('videoPlayer');
>>>>>>> origin/main
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}

// Change playback speed
function changePlaybackSpeed(speed) {
<<<<<<< HEAD
    const videoPlayer1 = document.getElementById('videoPlayer1');
    const videoPlayer2 = document.getElementById('videoPlayer2');
    // Set speed for both players to keep them synchronized
    videoPlayer1.playbackRate = speed;
    videoPlayer2.playbackRate = speed;
=======
    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.playbackRate = speed;
>>>>>>> origin/main
}

// Update video info display
function updateVideoInfo() {
<<<<<<< HEAD
    const videoPlayer = getActivePlayer();
=======
    const videoPlayer = document.getElementById('videoPlayer');
>>>>>>> origin/main
    const currentTime = formatTime(videoPlayer.currentTime);
    const duration = formatTime(videoPlayer.duration);
    
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
<<<<<<< HEAD
        const fileType = (file.fileType || 'Other').toLowerCase();
        return `<div class="file-marker file-marker-${escapeHtml(fileType)}" 
                     data-index="${index}" 
                     style="left: ${position}%" 
=======
        const clampedPosition = Math.max(0, Math.min(100, Number(position)));
        const fileType = (file.fileType || 'Other').toLowerCase();
        return `<div class="file-marker file-marker-${escapeHtml(fileType)}" 
                     data-index="${index}" 
                     style="left: ${clampedPosition}%" 
>>>>>>> origin/main
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
    
<<<<<<< HEAD
    const videoPlayer = getActivePlayer();
=======
    const videoPlayer = document.getElementById('videoPlayer');
>>>>>>> origin/main
    const currentFile = videoFiles[currentVideoIndex];
    
    if (!currentFile) return;
    
    // Calculate the time offset of current video in the overall timeline
    const videoStartTime = new Date(currentFile.utcTime).getTime();
    const currentVideoTime = videoPlayer.currentTime * 1000; // Convert to milliseconds
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
