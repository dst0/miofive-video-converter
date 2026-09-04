// Video Player JavaScript - Dual Player Architecture (SPA Module)

import { openFolderBrowser } from './folder-browser.js';
import {escapeHtml, safeClassToken, safeStorage as localStorage} from './security.js';
import {showDialogPanel, closeDialogPanel} from './dialog.js';

let videoFiles = [];
let currentVideoIndex = 0;
let timelineData = null;
let activePlayerIndex = 0; // 0 or 1, which player is currently active
let videoPlayers = [null, null]; // References to both video elements
let videoSources = [null, null]; // References to both source elements
let totalDuration = 0; // Total duration of all videos combined
let videoDurations = []; // Array of individual video durations
let videoStartTimes = []; // Array of start times for each video in combined timeline
let currentGlobalTime = 0; // Current playback time across all videos
let isDraggingProgress = false; // Flag for progress bar dragging
let areCustomControlsInitialized = false;
let defaultExportRange = null;
let hasInitializedExportRange = false;
let pendingSeekByPlayer = [null, null];
let exportAbortController = null;
let exportRequestGeneration = 0;
let playbackRequestTokens = [0, 0];
let playerSourceTokens = [0, 0];
let playerReadyWaitCleanups = [null, null];

function cancelPlayerReadyWait(playerIndex) {
    const cleanup = playerReadyWaitCleanups[playerIndex];
    playerReadyWaitCleanups[playerIndex] = null;
    if (cleanup) cleanup();
}

function invalidatePlayerSource(playerIndex) {
    cancelPlayerReadyWait(playerIndex);
    playerSourceTokens[playerIndex]++;
    return playerSourceTokens[playerIndex];
}

function isCurrentPlayerSource(playerIndex, sourceToken, videoIndex) {
    const player = videoPlayers[playerIndex];
    return Boolean(
        player &&
        playerSourceTokens[playerIndex] === sourceToken &&
        Number(player.dataset.videoIndex) === videoIndex
    );
}

function waitForPlayerSource({
    playerIndex,
    sourceToken,
    videoIndex,
    onReady,
    onFailure,
    timeoutMessage = 'Timeout waiting for video to load',
}) {
    cancelPlayerReadyWait(playerIndex);
    const player = videoPlayers[playerIndex];
    if (!player) return;

    let finished = false;
    let timeoutId;
    const cleanup = () => {
        player.removeEventListener('loadeddata', handleReady);
        player.removeEventListener('error', handleFailure);
        clearTimeout(timeoutId);
        if (playerReadyWaitCleanups[playerIndex] === cleanup) {
            playerReadyWaitCleanups[playerIndex] = null;
        }
    };
    const finish = (callback) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (!isCurrentPlayerSource(playerIndex, sourceToken, videoIndex)) return;
        callback?.(player);
    };
    const handleReady = () => finish(onReady);
    const handleFailure = () => finish(onFailure);

    player.addEventListener('loadeddata', handleReady);
    player.addEventListener('error', handleFailure);
    timeoutId = setTimeout(() => {
        if (isCurrentPlayerSource(playerIndex, sourceToken, videoIndex)) {
            console.error(timeoutMessage);
        }
        finish(onFailure);
    }, 10000);
    playerReadyWaitCleanups[playerIndex] = cleanup;
}

// Global player state - single source of truth for play/pause state
let globalPlayerState = 'paused'; // 'playing', 'paused', or 'ended'

const SEEK_STEP_SECONDS = 5;
const LARGE_SEEK_STEP_SECONDS = 30;
const PLAYBACK_SPEED_PRESETS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50];
const MAX_CALENDAR_MARKER_DAYS = 64;

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

function isPlayerScreenVisible() {
    const playerScreen = document.getElementById('playerScreen');
    return playerScreen && playerScreen.style.display !== 'none';
}

function isExportModalOpen() {
    const modal = document.getElementById('exportModal');
    return modal && modal.style.display !== 'none';
}

function isTextEntryTarget(target) {
    if (!(target instanceof Element)) return false;
    const tagName = target.tagName;
    return (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        target.isContentEditable
    );
}

function isNativeInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
        target.closest(
            'button, a[href], input, select, textarea, [role="button"], [role="slider"]'
        )
    );
}

function shouldIgnoreWrapperClick(target) {
    if (!(target instanceof Element)) return true;
    return Boolean(
        target.closest(
            'button, a[href], input, select, textarea, label, .progress-bar-container, .progress-bar-handle'
        )
    );
}

function updatePlaybackControlAccessibility() {
    const isPlaying = globalPlayerState === 'playing';
    const label = isPlaying ? 'Pause video' : 'Play video';
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playPauseOverlayBtn = document.getElementById('playPauseOverlayBtn');
    const videoWrapper = document.getElementById('videoWrapper');

    [playPauseBtn, playPauseOverlayBtn].forEach((button) => {
        if (!button) return;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(isPlaying));
        button.title = label;
    });

    if (videoWrapper) {
        videoWrapper.setAttribute(
            'aria-label',
            isPlaying ? 'Video playback area. Video is playing.' : 'Video playback area. Video is paused.'
        );
    }
}

function updateNavigationButtonStates() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (!prevBtn || !nextBtn) return;

    prevBtn.disabled = currentVideoIndex === 0;
    nextBtn.disabled = currentVideoIndex === videoFiles.length - 1;
    prevBtn.setAttribute('aria-disabled', String(prevBtn.disabled));
    nextBtn.setAttribute('aria-disabled', String(nextBtn.disabled));
}

function updateActivePlayerAccessibility() {
    videoPlayers.forEach((player, index) => {
        if (!player) return;
        const isActive = index === activePlayerIndex;
        const filename = videoFiles[currentVideoIndex]?.filename || 'selected video';
        player.setAttribute('aria-hidden', String(!isActive));
        player.setAttribute(
            'aria-label',
            isActive ? `Current video: ${filename}` : 'Preloaded next video'
        );
    });
}

function syncMuteButtonState() {
    const activePlayer = videoPlayers[activePlayerIndex];
    const muteBtn = document.getElementById('muteBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    if (!activePlayer || !muteBtn || !volumeSlider) return;

    const isMuted = activePlayer.muted || activePlayer.volume === 0;
    muteBtn.querySelector('.btn-icon').textContent = isMuted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(isMuted));
    muteBtn.setAttribute('aria-label', isMuted ? 'Unmute audio' : 'Mute audio');
    muteBtn.title = isMuted ? 'Unmute audio' : 'Mute audio';
    volumeSlider.setAttribute(
        'aria-valuetext',
        `${Math.round(activePlayer.volume * 100)} percent${isMuted ? ', muted' : ''}`
    );
}

function setMuted(muted) {
    videoPlayers.forEach((player) => {
        if (player) player.muted = muted;
    });
    syncMuteButtonState();
}

function toggleMute() {
    const activePlayer = videoPlayers[activePlayerIndex];
    if (!activePlayer) return;
    setMuted(!(activePlayer.muted || activePlayer.volume === 0));
}

function syncFullscreenButtonState() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (!fullscreenBtn) return;
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenBtn.setAttribute('aria-pressed', String(isFullscreen));
    fullscreenBtn.setAttribute(
        'aria-label',
        isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
    );
    fullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
}

function toggleFullscreen() {
    const videoWrapper = document.getElementById('videoWrapper');
    if (!videoWrapper) return;

    if (!document.fullscreenElement) {
        videoWrapper.requestFullscreen().catch((err) => {
            console.error('Error entering fullscreen:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

function handlePlayPromiseError(err, message = 'Error playing video:') {
    if (err?.name === 'AbortError') {
        return null;
    }
    if (err?.name === 'NotAllowedError') {
        setGlobalPlayerState('paused');
        return null;
    }

    console.error(message, err);
    setGlobalPlayerState('paused');
}

function pausePlayer(playerIndex) {
    playbackRequestTokens[playerIndex]++;
    const player = videoPlayers[playerIndex];
    if (player) player.pause();
}

async function requestPlay(playerIndex, message = 'Error playing video:') {
    const player = videoPlayers[playerIndex];
    if (!player) return;
    const requestToken = ++playbackRequestTokens[playerIndex];
    try {
        await player.play();
        const requestIsCurrent = requestToken === playbackRequestTokens[playerIndex];
        if (!requestIsCurrent || playerIndex !== activePlayerIndex || globalPlayerState !== 'playing') {
            pausePlayer(playerIndex);
        }
    } catch (error) {
        if (requestToken !== playbackRequestTokens[playerIndex] || error?.name === 'AbortError') return;
        handlePlayPromiseError(error, message);
    }
}

function clampGlobalTime(value) {
    return Math.max(0, Math.min(totalDuration || 0, value));
}

function seekBySeconds(deltaSeconds) {
    if (!totalDuration) return;
    seekToGlobalTime(clampGlobalTime(currentGlobalTime + deltaSeconds));
}

function getCurrentPreciseGlobalTime() {
    const activePlayer = videoPlayers[activePlayerIndex];
    if (activePlayer && Number.isFinite(activePlayer.currentTime)) {
        return clampGlobalTime((videoStartTimes[currentVideoIndex] || 0) + activePlayer.currentTime);
    }

    return currentGlobalTime;
}

function updateProgressAccessibility(previewTime = currentGlobalTime) {
    const progressContainer = document.getElementById('progressBarContainer');
    if (!progressContainer) return;

    const safeTime = clampGlobalTime(previewTime);
    progressContainer.setAttribute('aria-valuemax', String(Math.round(totalDuration || 0)));
    progressContainer.setAttribute('aria-valuenow', String(Math.round(safeTime)));
    progressContainer.setAttribute(
        'aria-valuetext',
        `${formatTime(safeTime)} of ${formatTime(totalDuration || 0)}`
    );
}

function updateSpeedPresetState(speed) {
    document.querySelectorAll('.preset-speed-btn').forEach((btn) => {
        const presetSpeed = parseFloat(btn.dataset.speed);
        btn.setAttribute('aria-pressed', String(presetSpeed === speed));
    });
}

function getSupportedSpeedPresets() {
    return PLAYBACK_SPEED_PRESETS.filter(
        (speed) => speed >= PlaybackRateRange.min && speed <= PlaybackRateRange.max
    );
}

function getNearestSupportedSpeed(speed) {
    const supportedSpeeds = getSupportedSpeedPresets();
    return supportedSpeeds.reduce((nearest, candidate) => (
        Math.abs(candidate - speed) < Math.abs(nearest - speed) ? candidate : nearest
    ), supportedSpeeds[0] || 1);
}

function getAdjacentPlaybackSpeed(currentSpeed, direction) {
    const supportedSpeeds = getSupportedSpeedPresets();
    if (supportedSpeeds.length === 0) return currentSpeed;

    if (direction > 0) {
        return supportedSpeeds.find((speed) => speed > currentSpeed + 0.001) || supportedSpeeds[supportedSpeeds.length - 1];
    }

    for (let i = supportedSpeeds.length - 1; i >= 0; i--) {
        if (supportedSpeeds[i] < currentSpeed - 0.001) {
            return supportedSpeeds[i];
        }
    }

    return supportedSpeeds[0];
}

function getSelectedPlaybackSpeed() {
    const speedInput = document.getElementById('speedInput');
    const inputSpeed = Number(speedInput?.value);
    if (Number.isFinite(inputSpeed)) return inputSpeed;

    const activePlayer = videoPlayers[activePlayerIndex];
    return Number.isFinite(activePlayer?.playbackRate) ? activePlayer.playbackRate : 1;
}

function updateOverlaySpeedControls(speed) {
    const speedDisplayBtn = document.getElementById('speedDisplayBtn');
    const speedDownBtn = document.getElementById('speedDownBtn');
    const speedUpBtn = document.getElementById('speedUpBtn');
    const supportedSpeeds = getSupportedSpeedPresets();
    const minSpeed = supportedSpeeds[0] || PlaybackRateRange.min;
    const maxSpeed = supportedSpeeds[supportedSpeeds.length - 1] || PlaybackRateRange.max;
    const speedText = `${speed.toFixed(1)}x`;

    if (speedDisplayBtn) {
        speedDisplayBtn.setAttribute('aria-label', `Reset playback speed from ${speedText} to 1.0x`);
        speedDisplayBtn.title = `Reset playback speed to 1.0x (currently ${speedText})`;
    }

    if (speedDownBtn) {
        speedDownBtn.disabled = speed <= minSpeed + 0.001;
        speedDownBtn.setAttribute('aria-label', `Decrease playback speed from ${speedText}`);
    }

    if (speedUpBtn) {
        speedUpBtn.disabled = speed >= maxSpeed - 0.001;
        speedUpBtn.setAttribute('aria-label', `Increase playback speed from ${speedText}`);
    }
}

let isPlayerModuleInitialized = false;

// Initialize the player module (called once on page load)
export function initPlayer() {
    if (isPlayerModuleInitialized) return;
    isPlayerModuleInitialized = true;

    // Initialize dual players references
    videoPlayers[0] = document.getElementById('videoPlayer1');
    videoPlayers[1] = document.getElementById('videoPlayer2');
    videoSources[0] = document.getElementById('videoSource1');
    videoSources[1] = document.getElementById('videoSource2');

    // Set up event listeners for back button
    document.getElementById('backBtn').addEventListener('click', () => {
        hidePlayerScreen();
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
    document.getElementById('exportSetStartBtn').addEventListener('click', () => {
        document.getElementById('exportRangeStart').value = formatExportTime(getCurrentPreciseGlobalTime());
        updateExportEstimate();
    });
    document.getElementById('exportSetEndBtn').addEventListener('click', () => {
        document.getElementById('exportRangeEnd').value = formatExportTime(getCurrentPreciseGlobalTime());
        updateExportEstimate();
    });
    ['exportRangeStart', 'exportRangeEnd', 'exportSpeed', 'exportQuality'].forEach((id) => {
        document.getElementById(id).addEventListener('input', updateExportEstimate);
        document.getElementById(id).addEventListener('change', updateExportEstimate);
    });
    
    // Close modal when clicking outside
    document.getElementById('exportModal').addEventListener('click', (e) => {
        if (e.target.id === 'exportModal') {
            closeExportModal();
        }
    });
    
    document.getElementById('prevBtn').addEventListener('click', () => {
        playPreviousVideo();
    });

    document.getElementById('nextBtn').addEventListener('click', () => {
        playNextVideo(true);
    });

    document.getElementById('playPauseBtn').addEventListener('click', () => {
        togglePlayPause();
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
            btn.setAttribute('aria-disabled', 'true');
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
        player.addEventListener('ended', () => {
            if (player.dataset.videoIndex === undefined) return;
            if (document.getElementById('playerScreen').style.display === 'none') return;
            if (index === activePlayerIndex) {
                // Check if this is the last video
                if (videoFiles.length > 0 && currentVideoIndex >= videoFiles.length - 1) {
                    setGlobalPlayerState('ended');
                } else if (videoFiles.length > 0) {
                    playNextVideo(false);
                }
            }
        });

        player.addEventListener('timeupdate', () => {
            if (player.dataset.videoIndex === undefined) return;
            if (document.getElementById('playerScreen').style.display === 'none') return;
            if (index === activePlayerIndex && !isDraggingProgress) {
                updatePlaybackPosition();
                updateVideoInfo();
                updateCustomProgressBar();
            }
        });

        player.addEventListener('play', () => {
            if (player.dataset.videoIndex === undefined) return;
            if (document.getElementById('playerScreen').style.display === 'none') return;
            if (index === activePlayerIndex) {
                console.log('play event triggered at player index', index);
                setGlobalPlayerState('playing');
            }
        });

        player.addEventListener('pause', () => {
            if (player.dataset.videoIndex === undefined) return;
            if (document.getElementById('playerScreen').style.display === 'none') return;
            if (index === activePlayerIndex) {
                console.log('pause event triggered at player index', index);
                // Only update state if not ended and play intent is not active
                const activePlayer = videoPlayers[activePlayerIndex];
                if (activePlayer && !activePlayer.ended && globalPlayerState !== 'playing') {
                    setGlobalPlayerState('paused');
                }
            }
        });

        player.addEventListener('loadedmetadata', () => {
            if (player.dataset.videoIndex !== undefined) {
                const videoIdx = parseInt(player.dataset.videoIndex);
                videoDurations[videoIdx] = player.duration || 0;
                updateTotalDuration();
                const exportModal = document.getElementById('exportModal');
                if (exportModal && exportModal.style.display === 'flex') {
                    const totalDurEl = document.getElementById('exportTotalDuration');
                    if (totalDurEl) totalDurEl.textContent = formatExportTime(totalDuration);
                    updateExportEstimate();
                }
                // Only update progress bar if this is the active player
                if (index === activePlayerIndex) {
                    updateCustomProgressBar();
                    updateVideoInfo();
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
        player.addEventListener('click', (e) => {
            if (index === activePlayerIndex) {
                e.stopPropagation();
                togglePlayPause();
            }
        });
    });

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
    updatePlaybackControlAccessibility();
    
    console.log(`UI synced to state: ${globalPlayerState}`);
}

// Apply global state to video player objects
function applyStateToPlayers() {
    const activePlayer = videoPlayers[activePlayerIndex];
    
    if (globalPlayerState === 'playing') {
        if (activePlayer.paused) {
            void requestPlay(activePlayerIndex);
        }
    } else {
        // paused or ended
        if (!activePlayer.paused) {
            pausePlayer(activePlayerIndex);
        }
    }
}


// Show player screen and start playback
export function showPlayerScreen(files, options = {}) {
    if (!files || files.length === 0) {
        alert('No video files to play.');
        return;
    }

    // Set video files and sort by timestamp without mutating input array
    videoFiles = [...files].sort(
        (a, b) => new Date(a.utcTime).getTime() - new Date(b.utcTime).getTime()
    );

    // Hide main screen and show player screen
    document.getElementById('mainScreen').style.display = 'none';
    document.getElementById('playerScreen').style.display = 'block';
    window.scrollTo(0, 0);

    // Initialize player UI
    initializePlayer();
    defaultExportRange = options.exportRange ? { ...options.exportRange } : null;
    hasInitializedExportRange = false;
    initializeTimeline();
    initializeCustomControls();
    updatePlaybackControlAccessibility();
    updateActivePlayerAccessibility();

    // Load first video (normal playback entry allows autoplay)
    loadVideo(0, options.autoplay === false);
    requestAnimationFrame(() => {
        document.getElementById('videoWrapper')?.focus({ preventScroll: true });
        if (options.openExportModal) {
            openExportModal();
        }
    });
}

export function showExportFlow(files, options = {}) {
    showPlayerScreen(files, {
        autoplay: false,
        openExportModal: true,
        exportRange: options.exportRange,
    });
}

// Hide player screen and return to main
export function hidePlayerScreen() {
    // Pause playback
    videoPlayers.forEach((player, index) => {
        pausePlayer(index);
        invalidatePlayerSource(index);
        videoSources[index]?.removeAttribute('src');
        player.removeAttribute('src');
        delete player.dataset.videoIndex;
        player.load(); // Reset the video element
    });
    globalPlayerState = 'paused';
    setPlaybackBtnToPause();

    // Reset state
    videoFiles = [];
    currentVideoIndex = 0;
    videoDurations = [];
    videoStartTimes = [];
    totalDuration = 0;
    defaultExportRange = null;
    hasInitializedExportRange = false;
    pendingSeekByPlayer = [null, null];


    // Hide player screen and show main screen
    document.getElementById('playerScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
    document.getElementById('playVideosBtn')?.focus({ preventScroll: true });
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
            Number.isFinite(videoFiles[i].duration) &&
            videoFiles[i].duration > 0
        ) {
            videoDurations[i] = videoFiles[i].duration;
            hasPreloadedDurations = true;
        } else {
            videoDurations[i] = 0;
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

    playbackRequestTokens[playerIndex]++;
    const sourceToken = invalidatePlayerSource(playerIndex);

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
    player.playbackRate = getNearestSupportedSpeed(getSelectedPlaybackSpeed());
    return sourceToken;
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
function switchToNextVideo(isUserAction = false) {
    const nextVideoIndex = currentVideoIndex + 1;
    if (nextVideoIndex >= videoFiles.length) {
        setGlobalPlayerState('ended');
        return false;
    }

    const nextPlayerIndex = 1 - activePlayerIndex;
    let nextSourceToken = playerSourceTokens[nextPlayerIndex];
    if (Number(videoPlayers[nextPlayerIndex].dataset.videoIndex) !== nextVideoIndex) {
        nextSourceToken = loadVideoIntoPlayer(nextVideoIndex, nextPlayerIndex);
    }

    // Remember if we were playing
    const wasPlaying = globalPlayerState === 'playing';
    
    // Store the previous player index before switching
    const previousPlayerIndex = activePlayerIndex;

    // Switch active player BEFORE pausing the old one
    // This prevents the pause event from triggering the button state update
    activePlayerIndex = nextPlayerIndex;
    currentVideoIndex = nextVideoIndex;

    // A manual navigation cancels the old play request immediately. During auto-advance,
    // the ended player is already stopped and is invalidated when reused for preloading.
    if (isUserAction) pausePlayer(previousPlayerIndex);

    // Hide previous player, show new active player
    videoPlayers[previousPlayerIndex].classList.remove('active-player');
    videoPlayers[activePlayerIndex].classList.add('active-player');

    // Update video info
    const videoFile = videoFiles[currentVideoIndex];
    document.getElementById('currentVideoName').textContent = videoFile.filename;

    updateNavigationButtonStates();
    updateActivePlayerAccessibility();

    // Start playback on new active player if we were playing before
    const newActivePlayer = videoPlayers[activePlayerIndex];
    if (wasPlaying) {
        if (
            isCurrentPlayerSource(activePlayerIndex, nextSourceToken, nextVideoIndex) &&
            newActivePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            newActivePlayer.currentTime = 0;
            void requestPlay(activePlayerIndex);
        } else {
            const targetPlayerIndex = activePlayerIndex;
            waitForPlayerSource({
                playerIndex: targetPlayerIndex,
                sourceToken: nextSourceToken,
                videoIndex: nextVideoIndex,
                onReady: (player) => {
                    if (targetPlayerIndex !== activePlayerIndex || globalPlayerState !== 'playing') return;
                    player.currentTime = 0;
                    void requestPlay(targetPlayerIndex);
                },
                onFailure: () => {
                    if (targetPlayerIndex === activePlayerIndex) setGlobalPlayerState('paused');
                },
            });
        }
    }

    // Preload the next video into the now-inactive player
    preloadNextVideo();

    return true;
}

// Load a video by index (used for seeking/jumping)
function loadVideo(index, shouldPause = true) {
    if (index < 0 || index >= videoFiles.length) {
        return;
    }

    // Pause when seeking/jumping (but not on initial load)
    if (shouldPause) {
        setGlobalPlayerState('paused');
        
        // Pause both players to prevent event conflicts
        videoPlayers.forEach((_player, playerIndex) => pausePlayer(playerIndex));
        
        // Sync UI to paused state
        syncUIWithPlayerState();
    }

    // If seeking backward or far forward, need to reload
    currentVideoIndex = index;
    const videoFile = videoFiles[index];

    // Load into active player
    const activeSourceToken = loadVideoIntoPlayer(index, activePlayerIndex);

    // Update video info - textContent is safe from XSS (unlike innerHTML)
    // It treats the value as plain text, not HTML
    document.getElementById('currentVideoName').textContent = videoFile.filename;

    updateNavigationButtonStates();
    updateActivePlayerAccessibility();

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
        setGlobalPlayerState('playing');
        const activePlayer = videoPlayers[activePlayerIndex];
        // Wait for video to be ready before playing
        if (activePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            void requestPlay(activePlayerIndex, 'Error playing video on initial load:');
        } else {
            const targetPlayerIndex = activePlayerIndex;
            waitForPlayerSource({
                playerIndex: targetPlayerIndex,
                sourceToken: activeSourceToken,
                videoIndex: index,
                onReady: () => {
                    if (targetPlayerIndex !== activePlayerIndex || globalPlayerState !== 'playing') return;
                    void requestPlay(targetPlayerIndex, 'Error playing video on initial load:');
                },
                onFailure: () => {
                    if (targetPlayerIndex === activePlayerIndex) setGlobalPlayerState('paused');
                },
            });
        }
    }

    return activeSourceToken;
}

function setPlaybackBtnToPause() {
    document.getElementById('playPauseBtn').textContent = '▶ Play';
    document.querySelector('#playPauseOverlayBtn .btn-icon').textContent = '▶';
    updatePlaybackControlAccessibility();
    console.log('Set play/pause button to Pause state');
}

// Play next video
function playNextVideo(isUserAction = false) {
    // Try seamless transition first
    if (switchToNextVideo(isUserAction)) {
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
function playPreviousVideo() {
    if (currentVideoIndex > 0) {
        const wasPlaying = globalPlayerState === 'playing';
        loadVideo(currentVideoIndex - 1, !wasPlaying);
    }
}

// Toggle play/pause
function togglePlayPause() {
    // Toggle based on global state
    if (globalPlayerState === 'playing') {
        setGlobalPlayerState('paused');
        applyStateToPlayers();
    } else {
        // paused or ended
        setGlobalPlayerState('playing');
        applyStateToPlayers();
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
    document
        .getElementById('speedSlider')
        .setAttribute('aria-valuetext', `${clampedSpeed.toFixed(1)}x`);
    document.getElementById('speedValue').textContent = `${clampedSpeed.toFixed(1)}x`;
    updateSpeedPresetState(clampedSpeed);
    updateOverlaySpeedControls(clampedSpeed);
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
    updateActivePlayerAccessibility();
}

// Format time in MM:SS format
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatExportTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';

    const totalMilliseconds = Math.round(seconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3600000);
    const mins = Math.floor((totalMilliseconds % 3600000) / 60000);
    const secs = Math.floor((totalMilliseconds % 60000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    const secondsWithMs = `${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${secondsWithMs}`;
    }

    return `${String(mins).padStart(2, '0')}:${secondsWithMs}`;
}

function roundSecondsToMilliseconds(seconds) {
    return Math.round(seconds * 1000) / 1000;
}

function normalizeExportRange(range) {
    if (!range || !Number.isFinite(totalDuration) || totalDuration <= 0) {
        return null;
    }

    const start = Math.max(0, Number(range.start));
    const end = Math.min(totalDuration, Number(range.end));

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }

    return {
        start: roundSecondsToMilliseconds(start),
        end: roundSecondsToMilliseconds(end),
    };
}

function getInitialExportRange() {
    if (hasInitializedExportRange) {
        const currentRange = getExportRangeFromCurrentFields();
        if (currentRange) return currentRange;
    }

    const normalizedDefault = normalizeExportRange(defaultExportRange);
    if (normalizedDefault) {
        return normalizedDefault;
    }

    if (
        defaultExportRange &&
        Number.isFinite(Number(defaultExportRange.start)) &&
        Number.isFinite(Number(defaultExportRange.end)) &&
        Number(defaultExportRange.end) > Number(defaultExportRange.start)
    ) {
        return {
            start: roundSecondsToMilliseconds(Math.max(0, Number(defaultExportRange.start))),
            end: roundSecondsToMilliseconds(Number(defaultExportRange.end)),
        };
    }

    return {
        start: 0,
        end: Math.max(0, totalDuration || 0),
    };
}

function parseExportTime(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        throw new Error('Time is required');
    }

    function parseSecondToken(token) {
        const match = token.match(/^(\d+)(?:\.(\d{1,3}))?$/);
        if (!match) {
            throw new Error('Use seconds, MM:SS.mmm, or HH:MM:SS.mmm');
        }

        const wholeSeconds = Number(match[1]);
        const milliseconds = Number((match[2] || '').padEnd(3, '0')) || 0;
        return { wholeSeconds, milliseconds };
    }

    if (/^\d+(?:\.\d{1,3})?$/.test(trimmed)) {
        const { wholeSeconds, milliseconds } = parseSecondToken(trimmed);
        return wholeSeconds + milliseconds / 1000;
    }

    const rawParts = trimmed.split(':');
    if (rawParts.length < 2 || rawParts.length > 3) {
        throw new Error('Use seconds, MM:SS.mmm, or HH:MM:SS.mmm');
    }

    const leadingParts = rawParts.slice(0, -1).map((part) => {
        if (!/^\d+$/.test(part)) {
            throw new Error('Use seconds, MM:SS.mmm, or HH:MM:SS.mmm');
        }
        return Number(part);
    });
    const { wholeSeconds, milliseconds } = parseSecondToken(rawParts[rawParts.length - 1]);

    if (rawParts.length === 2) {
        const [minutes] = leadingParts;
        if (wholeSeconds >= 60) {
            throw new Error('Seconds must be below 60');
        }
        return minutes * 60 + wholeSeconds + milliseconds / 1000;
    }

    if (rawParts.length === 3) {
        const [hours, minutes] = leadingParts;
        if (minutes >= 60 || wholeSeconds >= 60) {
            throw new Error('Minutes and seconds must be below 60');
        }
        return hours * 3600 + minutes * 60 + wholeSeconds + milliseconds / 1000;
    }

    throw new Error('Use seconds, MM:SS.mmm, or HH:MM:SS.mmm');
}

function getExportRangeFromCurrentFields() {
    const startEl = document.getElementById('exportRangeStart');
    const endEl = document.getElementById('exportRangeEnd');
    if (!startEl || !endEl) return null;

    try {
        return normalizeExportRange({
            start: parseExportTime(startEl.value),
            end: parseExportTime(endEl.value),
        });
    } catch {
        return null;
    }
}

function estimateProcessingTime(selectedDuration, quality) {
    const qualityFactors = {
        max: 0.9,
        high: 0.65,
        standard: 0.45,
        compact: 0.3,
    };
    const factor = qualityFactors[quality] || qualityFactors.max;
    const low = Math.max(5, selectedDuration * factor * 0.6);
    const high = Math.max(low + 5, selectedDuration * factor * 1.4);
    return `~${formatExportTime(low)}-${formatExportTime(high)}`;
}

function getExportSettingsFromForm() {
    // The selected exact range was built from scan metadata, not later preview metadata.
    // A recovered preview duration must not authorize that incomplete, shorter range.
    if (videoFiles.some((file) => !Number.isFinite(file.duration) || file.duration <= 0) ||
        videoDurations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
        throw new Error('Some clip durations are unavailable. Rescan or exclude unreadable clips before exporting an exact range.');
    }
    const start = parseExportTime(document.getElementById('exportRangeStart').value);
    const end = parseExportTime(document.getElementById('exportRangeEnd').value);
    const speed = Number(document.getElementById('exportSpeed').value);
    const quality = document.getElementById('exportQuality').value;

    if (!Number.isFinite(speed) || speed < 0.1 || speed > 50) {
        throw new Error('Speed must be between 0.1x and 50x');
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
        throw new Error('Start and end times cannot be negative');
    }
    if (end <= start) {
        throw new Error('End time must be after start time');
    }
    if (end > totalDuration) {
        throw new Error(`End time cannot exceed ${formatExportTime(totalDuration)}`);
    }

    return { start, end, speed, quality };
}

function updateExportEstimate() {
    const selectedDurationEl = document.getElementById('exportSelectedDuration');
    const outputDurationEl = document.getElementById('exportOutputDuration');
    const processingEstimateEl = document.getElementById('exportProcessingEstimate');

    if (!selectedDurationEl || !outputDurationEl || !processingEstimateEl) return;

    try {
        const { start, end, speed, quality } = getExportSettingsFromForm();
        defaultExportRange = { start, end };
        const selectedDuration = end - start;
        selectedDurationEl.textContent = formatExportTime(selectedDuration);
        outputDurationEl.textContent = formatExportTime(selectedDuration / speed);
        processingEstimateEl.textContent = estimateProcessingTime(selectedDuration, quality);
    } catch (error) {
        selectedDurationEl.textContent = 'Invalid';
        outputDurationEl.textContent = 'Invalid';
        processingEstimateEl.textContent = error.message;
    }
}

// Initialize timeline
function initializeTimeline() {
    if (videoFiles.length === 0) return;

    const startTimes = videoFiles.map((f) => new Date(f.utcTime).getTime());
    const minTime = Math.min(...startTimes);
    const endTimes = videoFiles.map((f) => {
        const start = new Date(f.utcTime).getTime();
        const duration = Number(f.duration);
        return start + (Number.isFinite(duration) && duration > 0 ? duration * 1000 : 0);
    });
    const maxTime = Math.max(...endTimes);
    const timeRange = maxTime - minTime;
    const actualMin = timeRange <= 0 ? minTime - 1800000 : minTime;
    const actualMax = timeRange <= 0 ? maxTime + 1800000 : maxTime;

    timelineData = {
        minTime: actualMin,
        maxTime: actualMax,
        range: actualMax - actualMin || 3600000,
        files: videoFiles,
    };

    // Update timeline labels
    document.getElementById('timelineStart').textContent = new Date(
        actualMin
    ).toLocaleString();
    document.getElementById('timelineEnd').textContent = new Date(
        actualMax
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
            
             return `<div class="file-marker file-marker-${safeClassToken(fileType)}"
                      data-index="${index}"
                      data-filename="${escapeHtml(file.filename)}"
                      data-timestamp="${escapeHtml(timestamp)}"
                      data-duration="${escapeHtml(duration)}"
                      data-filetype="${escapeHtml(fileTypeDisplay)}"
                      role="button"
                      tabindex="0"
                      aria-label="Jump to video ${index + 1}: ${escapeHtml(file.filename)}, ${escapeHtml(timestamp)}"
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
        const activateMarker = () => {
            const index = parseInt(marker.dataset.index);
            loadVideo(index);
        };
        marker.addEventListener('click', activateMarker);
        marker.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activateMarker();
            }
        });
    });

    // Highlight the first marker initially
    highlightCurrentMarker();

    // Add click handler to timeline track for seeking
    document.getElementById('timelineTrack').onclick = (e) => {
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
    };
}

// Generate time markers for midnight and noon
function generateTimeMarkers(minTime, maxTime) {
    const markers = [];
    const startDate = new Date(minTime);
    const endDate = new Date(maxTime);
    const daySpan = Math.max(1, Math.ceil((maxTime - minTime) / 86400000));
    const markerStepDays = Math.max(1, Math.ceil(daySpan / MAX_CALENDAR_MARKER_DAYS));
    let generatedDays = 0;

    const currentDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
    );

    while (currentDate <= endDate && generatedDays < MAX_CALENDAR_MARKER_DAYS) {
        generatedDays++;
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

        currentDate.setDate(currentDate.getDate() + markerStepDays);
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
        marker.removeAttribute('aria-current');
    });

    // Add highlight to current marker
    const currentMarker = playerScreen.querySelector(
        `.file-marker[data-index="${currentVideoIndex}"]`
    );
    if (currentMarker) {
        currentMarker.classList.add('current-marker');
        currentMarker.setAttribute('aria-current', 'true');
    }
}

// Initialize custom controls overlay
function initializeCustomControls() {
    if (areCustomControlsInitialized) {
        updateProgressAccessibility();
        syncMuteButtonState();
        syncFullscreenButtonState();
        return;
    }

    const videoWrapper = document.getElementById('videoWrapper');
    const progressContainer = document.getElementById('progressBarContainer');
    const progressHandle = document.getElementById('progressHandle');
    const playPauseOverlayBtn = document.getElementById('playPauseOverlayBtn');
    const muteBtn = document.getElementById('muteBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const speedDownBtn = document.getElementById('speedDownBtn');
    const speedDisplayBtn = document.getElementById('speedDisplayBtn');
    const speedUpBtn = document.getElementById('speedUpBtn');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');

    // Play/Pause button
    playPauseOverlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayPause();
    });

    // Mute button
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMute();
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
        syncMuteButtonState();
    });

    speedDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        changePlaybackSpeed(getAdjacentPlaybackSpeed(getSelectedPlaybackSpeed(), -1));
    });

    speedDisplayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        changePlaybackSpeed(1);
    });

    speedUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        changePlaybackSpeed(getAdjacentPlaybackSpeed(getSelectedPlaybackSpeed(), 1));
    });
    
    // Screenshot button
    screenshotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        takeScreenshot();
    });
    
    // Fullscreen button
    fullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
    });

    videoWrapper.addEventListener('click', (e) => {
        if (isDraggingProgress || shouldIgnoreWrapperClick(e.target)) return;
        togglePlayPause();
    });

    // Progress bar seeking
    let isDragging = false;

    const startDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        isDraggingProgress = true;
        
        // Pause playback when starting to seek
        setGlobalPlayerState('paused');
        applyStateToPlayers();
        
        handleProgressDrag(e);
    };

    const handleProgressDrag = (e) => {
        if (!isDragging) return;

        const rect = progressContainer.getBoundingClientRect();
        const clickX = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
        const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));

        // Update progress bar visually
        updateProgressBarVisual(percent);
    };

    const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;

        const rect = progressContainer.getBoundingClientRect();
        const clickX =
            (e.clientX ?? e.changedTouches?.[0]?.clientX) - rect.left;
        const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));

        // Seek to the clicked position (will remain paused)
        seekToGlobalPercent(percent);

        setTimeout(() => {
            isDraggingProgress = false;
        }, 100);
    };

    progressHandle.addEventListener('mousedown', startDrag);
    progressContainer.addEventListener('mousedown', startDrag);
    progressContainer.addEventListener('keydown', (e) => {
        const key = e.key;
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            e.preventDefault();
            seekBySeconds(key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS);
        } else if (key === 'PageUp' || key === 'PageDown') {
            e.preventDefault();
            seekBySeconds(key === 'PageUp' ? LARGE_SEEK_STEP_SECONDS : -LARGE_SEEK_STEP_SECONDS);
        } else if (key === 'Home') {
            e.preventDefault();
            seekToGlobalTime(0);
        } else if (key === 'End') {
            e.preventDefault();
            seekToGlobalTime(totalDuration);
        }
    });
    document.addEventListener('mousemove', handleProgressDrag);
    document.addEventListener('mouseup', endDrag);

    // Touch support
    progressHandle.addEventListener('touchstart', startDrag);
    progressContainer.addEventListener('touchstart', startDrag);
    document.addEventListener('touchmove', handleProgressDrag);
    document.addEventListener('touchend', endDrag);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('fullscreenchange', syncFullscreenButtonState);
    areCustomControlsInitialized = true;
    updateProgressAccessibility();
    syncMuteButtonState();
    syncFullscreenButtonState();
    updateOverlaySpeedControls(getSelectedPlaybackSpeed());
}

// Update custom progress bar based on current playback
function updateCustomProgressBar() {
    if (totalDuration === 0) {
        updateProgressAccessibility(0);
        return;
    }

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
    const safePercent = Math.max(0, Math.min(100, percent || 0));

    progressPlayed.style.width = `${safePercent}%`;
    progressHandle.style.left = `${safePercent}%`;
    updateProgressAccessibility((safePercent / 100) * (totalDuration || 0));
}

// Seek to a specific percentage of the total duration
function seekToGlobalPercent(percent) {
    const targetTime = (percent / 100) * totalDuration;
    seekToGlobalTime(targetTime);
}

// Seek to a specific time in the global timeline
export function seekToGlobalTime(targetTime) {
    targetTime = clampGlobalTime(targetTime);
    currentGlobalTime = targetTime;

    // Find which video this time corresponds to
    let targetVideoIndex = 0;
    let localTime = targetTime;

    for (let i = 0; i < videoFiles.length; i++) {
        if (videoStartTimes[i] + videoDurations[i] >= targetTime || i === videoFiles.length - 1) {
            targetVideoIndex = i;
            localTime = Math.max(
                0,
                Math.min(videoDurations[i] || 0, targetTime - videoStartTimes[i])
            );
            break;
        }
    }

    // If we need to change videos
    if (targetVideoIndex !== currentVideoIndex) {
        const wasPlaying = globalPlayerState === 'playing';
        currentVideoIndex = targetVideoIndex;
        const targetPlayerIndex = activePlayerIndex;
        pendingSeekByPlayer[targetPlayerIndex] = localTime;
        const sourceToken = loadVideo(targetVideoIndex, !wasPlaying);
        const activePlayer = videoPlayers[targetPlayerIndex];
        const applySeek = (player) => {
            if (
                targetPlayerIndex !== activePlayerIndex ||
                currentVideoIndex !== targetVideoIndex ||
                !isCurrentPlayerSource(targetPlayerIndex, sourceToken, targetVideoIndex)
            ) return;
            const targetSeekTime = pendingSeekByPlayer[targetPlayerIndex] !== null
                ? pendingSeekByPlayer[targetPlayerIndex]
                : localTime;
            pendingSeekByPlayer[targetPlayerIndex] = null;
            player.currentTime = targetSeekTime;
            updateCustomProgressBar();
            if (wasPlaying && globalPlayerState === 'playing') {
                void requestPlay(targetPlayerIndex);
            }
        };

        if (activePlayer.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            applySeek(activePlayer);
        } else {
            waitForPlayerSource({
                playerIndex: targetPlayerIndex,
                sourceToken,
                videoIndex: targetVideoIndex,
                onReady: applySeek,
                timeoutMessage: 'Timeout waiting to seek in video',
            });
        }
    } else {
        // Same video, just seek
        pendingSeekByPlayer[activePlayerIndex] = localTime;
        const activePlayer = videoPlayers[activePlayerIndex];
        activePlayer.currentTime = localTime;
        updateCustomProgressBar();
        if (globalPlayerState === 'playing') {
            void requestPlay(activePlayerIndex);
        }
    }
}

function getExportModalFocusableElements() {
    const modal = document.getElementById('exportModal');
    if (!modal) return [];

    return Array.from(
        modal.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
    ).filter((element) => element.offsetParent !== null);
}

function trapExportModalFocus(e) {
    const focusableElements = getExportModalFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
    }
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
    if (!isPlayerScreenVisible()) return;

    if (isExportModalOpen()) {
        if (e.key === 'Tab') {
            trapExportModalFocus(e);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeExportModal();
            return;
        }
        if (isTextEntryTarget(e.target) || isNativeInteractiveTarget(e.target)) {
            return;
        }
    }

    if (e.key === 'Escape') {
        if (document.fullscreenElement) {
            e.preventDefault();
            document.exitFullscreen();
        }
        return;
    }

    if (isTextEntryTarget(e.target)) return;
    if (isNativeInteractiveTarget(e.target)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const key = e.key.toLowerCase();

    if (key === ' ' || key === 'k' || e.key === 'Enter') {
        if (e.repeat) return;
        e.preventDefault();
        togglePlayPause();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        seekBySeconds(direction * (e.shiftKey ? LARGE_SEEK_STEP_SECONDS : SEEK_STEP_SECONDS));
    } else if (e.key === 'Home') {
        e.preventDefault();
        seekToGlobalTime(0);
    } else if (e.key === 'End') {
        e.preventDefault();
        seekToGlobalTime(totalDuration);
    } else if (key === 'm') {
        e.preventDefault();
        toggleMute();
    } else if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
    } else if (key === 's') {
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
    
    // Update export info
    const initialRange = getInitialExportRange();
    document.getElementById('exportVideoCount').textContent = videoFiles.length;
    document.getElementById('exportTotalDuration').textContent = formatExportTime(totalDuration);
    document.getElementById('exportRangeStart').value = formatExportTime(initialRange.start);
    document.getElementById('exportRangeEnd').value = formatExportTime(initialRange.end);
    hasInitializedExportRange = true;

    const playbackSpeed = Number(document.getElementById('speedInput').value) || 1;
    document.getElementById('exportSpeed').value = String(Math.max(0.1, Math.min(50, playbackSpeed)));
    document.getElementById('exportQuality').value = 'max';
    
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
    updateExportEstimate();
    
    // Show modal
    showDialogPanel('exportModal', 'exportModalTitle', closeExportModal);
}

function setExportControlsBusy(busy) {
    const controls = document.querySelectorAll(
        '#exportModal .modal-body input, #exportModal .modal-body select, #exportModal .modal-body button, #exportConfirmBtn'
    );
    controls.forEach((control) => { control.disabled = busy; });
    if (busy) document.getElementById('exportCancelBtn').focus();
}

function closeExportModal() {
    if (exportAbortController) {
        exportAbortController.abort();
        exportAbortController = null;
    }
    exportRequestGeneration++;
    closeDialogPanel('exportModal');
    setExportControlsBusy(false);
    // Clear export status so reopening the modal shows a clean state
    document.getElementById('exportStatus').innerHTML = '';
}

function openExportFolderBrowser() {
    // Open folder browser directly (avoids z-index conflict with export modal)
    openFolderBrowser({purpose: 'export'});
}

function validateExportFilename(filename) {
    if (!filename) return 'Please enter an output filename';
    if (
        filename === '.' ||
        filename === '..' ||
        filename.length > 240 ||
        /[\0/\\<>:"|?*]/.test(filename) ||
        /[. ]$/.test(filename)
    ) {
        return 'Use a plain filename without folders or reserved characters';
    }
    if (!/\.mp4$/i.test(filename)) return 'Output filename must end in .mp4';

    const stem = filename.slice(0, -4);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) {
        return 'That filename is reserved by the operating system';
    }
    return null;
}

async function performExport() {
    if (exportAbortController) return;
    const outputFolder = document.getElementById('exportOutputFolder').value.trim();
    const outputFilename = document.getElementById('exportOutputFilename').value.trim();
    const statusDiv = document.getElementById('exportStatus');
    
    // Validate inputs
    if (!outputFolder) {
        statusDiv.innerHTML = '<div class="error">Please select an output folder</div>';
        return;
    }
    
    const filenameError = validateExportFilename(outputFilename);
    if (filenameError) {
        statusDiv.innerHTML = `<div class="error">${escapeHtml(filenameError)}</div>`;
        return;
    }

    let exportSettings;
    try {
        exportSettings = getExportSettingsFromForm();
    } catch (error) {
        statusDiv.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
        updateExportEstimate();
        return;
    }
    
    if (!videoFiles || videoFiles.length === 0) {
        statusDiv.innerHTML = '<div class="error">No video files selected for export</div>';
        return;
    }

    const channels = new Set(
        videoFiles
            .map(f => /([AB])\.MP4$/i.exec(f.path || f.name || '')?.[1]?.toUpperCase())
            .filter(Boolean)
    );
    if (channels.size > 1) {
        statusDiv.innerHTML = '<div class="error">Mixed camera channels cannot be exported together. Please select clips from only camera A or camera B.</div>';
        return;
    }

    // Get all video file paths
    const filePaths = videoFiles.map(f => f.path);
    
    // The submitted destination/range is immutable until completion or cancellation.
    // Keep Cancel/Close available, but do not open a child dialog over an active job.
    setExportControlsBusy(true);
    
    const selectedDuration = exportSettings.end - exportSettings.start;
    statusDiv.innerHTML =
        `<div class="loading"><div class="spinner"></div>` +
        `Exporting ${formatExportTime(selectedDuration)} from ${videoFiles.length} video(s)...</div>`;

    if (exportAbortController) {
        exportAbortController.abort();
    }
    exportAbortController = new AbortController();
    const currentGeneration = ++exportRequestGeneration;
    const signal = exportAbortController.signal;
    
    try {
        const response = await fetch('/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                files: filePaths,
                outputFolder,
                outputFilename,
                rangeStart: exportSettings.start,
                rangeEnd: exportSettings.end,
                speed: exportSettings.speed,
                quality: exportSettings.quality,
            })
        });
        
        const data = await response.json();

        if (currentGeneration !== exportRequestGeneration || signal.aborted) {
            return;
        }
        
        if (!response.ok) {
            const errorMsg = data.error || 'Export failed';
            showSnackbar(`Export failed: ${errorMsg}`, 'error', 5000);
            statusDiv.innerHTML = `<div class="error">${escapeHtml(errorMsg)}</div>`;
            return;
        }
        
        // Save output folder to localStorage
        localStorage.setItem('mp4-combiner-output-folder', outputFolder);
        
        // Show success snackbar with output path
        showSnackbar(`✅ Export successful! Saved to: ${data.output}`, 'success', 5000);
        
        // Close modal immediately
        closeExportModal();
        
    } catch (error) {
        if (currentGeneration !== exportRequestGeneration || signal.aborted || error.name === 'AbortError') {
            return;
        }
        const errorMsg = error.message || 'Export failed: Network error';
        showSnackbar(`Export failed: ${errorMsg}`, 'error', 5000);
        statusDiv.innerHTML = `<div class="error">${escapeHtml(errorMsg)}</div>`;
    } finally {
        if (currentGeneration === exportRequestGeneration) {
            exportAbortController = null;
            setExportControlsBusy(false);
        }
    }
}
