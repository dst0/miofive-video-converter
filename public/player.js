// Video Player JavaScript

let videoFiles = [];
let currentVideoIndex = 0;
let timelineData = null;

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
    });
    
    // Load first video
    loadVideo(0);
});

// Initialize player controls
function initializePlayer() {
    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.volume = 1.0;
}

// Load a video by index
function loadVideo(index) {
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
    
    // Update button states
    document.getElementById('prevBtn').disabled = index === 0;
    document.getElementById('nextBtn').disabled = index === videoFiles.length - 1;
    
    // Highlight current file marker
    highlightCurrentMarker();
}

// Play next video
function playNextVideo() {
    if (currentVideoIndex < videoFiles.length - 1) {
        loadVideo(currentVideoIndex + 1);
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
    const videoPlayer = document.getElementById('videoPlayer');
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}

// Change playback speed
function changePlaybackSpeed(speed) {
    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.playbackRate = speed;
}

// Update video info display
function updateVideoInfo() {
    const videoPlayer = document.getElementById('videoPlayer');
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
    
    const videoPlayer = document.getElementById('videoPlayer');
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
