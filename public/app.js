import { initializeFolderBrowser } from './folder-browser.js';

let scannedFiles = [];
let ffmpegAvailable = true;
let timelineData = null;

document.addEventListener('DOMContentLoaded', () => {
    // Load saved values
    loadSavedPaths();
    initializePreScanFilters();
    initializeFolderBrowser(); // Initialize folder browser from folder-browser.js

    // FFmpeg check
    fetch('/check-ffmpeg')
        .then(r => r.json())
        .then(data => {
            ffmpegAvailable = data.available;
            if (!ffmpegAvailable) {
                document.getElementById('ffmpegWarning').innerHTML = `
          <div class="warning">
            <strong>⚠️ FFmpeg not found!</strong><br>
            Run <code>npm run install-ffmpeg</code> to install it automatically.
          </div>`;
            }
        });

    document.getElementById('scanBtn').addEventListener('click', scanFolder);
    document.getElementById('folderPath').addEventListener('input', savePaths);
});

// Function to load saved path values from localStorage
function loadSavedPaths() {
    const savedFolderPath = localStorage.getItem('mp4-combiner-folder-path');

    if (savedFolderPath) {
        document.getElementById('folderPath').value = savedFolderPath;
    }
}

// Function to save path values to localStorage
function savePaths() {
    const folderPath = document.getElementById('folderPath').value;

    if (folderPath.trim()) {
        localStorage.setItem('mp4-combiner-folder-path', folderPath);
    } else {
        localStorage.removeItem('mp4-combiner-folder-path');
    }

    // Save output path if it exists (when combine section is visible)
    const outputPathElement = document.getElementById('outputPath');
    if (outputPathElement) {
        const outputPath = outputPathElement.value;
        if (outputPath.trim()) {
            localStorage.setItem('mp4-combiner-output-path', outputPath);
        } else {
            localStorage.removeItem('mp4-combiner-output-path');
        }
    }
}

// Initialize pre-scan filter functionality
function initializePreScanFilters() {
    const enableFiltersCheckbox = document.getElementById('enablePreScanFilters');
    const filterControls = document.getElementById('preScanFilterControls');
    const startTimeInput = document.getElementById('preScanStartTime');
    const endTimeInput = document.getElementById('preScanEndTime');

    // Load saved filter state
    const filtersEnabled = localStorage.getItem('pre-scan-filters-enabled') === 'true';
    const savedStartTime = localStorage.getItem('pre-scan-start-time');
    const savedEndTime = localStorage.getItem('pre-scan-end-time');

    enableFiltersCheckbox.checked = filtersEnabled;
    filterControls.style.display = filtersEnabled ? 'block' : 'none';

    if (savedStartTime) startTimeInput.value = savedStartTime;
    if (savedEndTime) endTimeInput.value = savedEndTime;

    // Toggle filter controls visibility
    enableFiltersCheckbox.addEventListener('change', () => {
        const enabled = enableFiltersCheckbox.checked;
        filterControls.style.display = enabled ? 'block' : 'none';
        localStorage.setItem('pre-scan-filters-enabled', enabled);
    });

    // Save filter values when changed
    startTimeInput.addEventListener('change', () => {
        localStorage.setItem('pre-scan-start-time', startTimeInput.value);
    });

    endTimeInput.addEventListener('change', () => {
        localStorage.setItem('pre-scan-end-time', endTimeInput.value);
    });

    // Clear buttons
    document.getElementById('clearStartTime').addEventListener('click', () => {
        startTimeInput.value = '';
        localStorage.removeItem('pre-scan-start-time');
    });

    document.getElementById('clearEndTime').addEventListener('click', () => {
        endTimeInput.value = '';
        localStorage.removeItem('pre-scan-end-time');
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            applyDatePreset(preset);
        });
    });
}

function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function applyDatePreset(preset) {
    const now = new Date();
    const startTimeInput = document.getElementById('preScanStartTime');
    const endTimeInput = document.getElementById('preScanEndTime');

    let startDate, endDate;

    switch (preset) {
        case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            break;

        case 'yesterday':
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
            endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
            break;

        case 'last7days':
            endDate = new Date(now);
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 7);
            break;

        case 'thisweek':
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
            startOfWeek.setHours(0, 0, 0, 0);
            startDate = startOfWeek;
            endDate = new Date(now);
            break;

        case 'lastweek':
            const startOfLastWeek = new Date(now);
            startOfLastWeek.setDate(now.getDate() - now.getDay() - 7); // Last Sunday
            startOfLastWeek.setHours(0, 0, 0, 0);
            const endOfLastWeek = new Date(startOfLastWeek);
            endOfLastWeek.setDate(endOfLastWeek.getDate() + 6);
            endOfLastWeek.setHours(23, 59, 59);
            startDate = startOfLastWeek;
            endDate = endOfLastWeek;
            break;
    }

    if (startDate && endDate) {
        startTimeInput.value = formatDateTimeLocal(startDate);
        endTimeInput.value = formatDateTimeLocal(endDate);

        // Save to localStorage
        localStorage.setItem('pre-scan-start-time', startTimeInput.value);
        localStorage.setItem('pre-scan-end-time', endTimeInput.value);
    }
}

function getPreScanFilterDates() {
    const filtersEnabled = document.getElementById('enablePreScanFilters').checked;
    if (!filtersEnabled) return { startTime: null, endTime: null };

    const startTimeInput = document.getElementById('preScanStartTime');
    const endTimeInput = document.getElementById('preScanEndTime');

    const startTime = startTimeInput.value ? new Date(startTimeInput.value).toISOString() : null;
    const endTime = endTimeInput.value ? new Date(endTimeInput.value).toISOString() : null;

    // Validate date range
    if (startTime && endTime && new Date(startTime) >= new Date(endTime)) {
        alert('Start time must be before end time');
        return null;
    }

    return { startTime, endTime };
}

function selectedChannels() {
    const include = [];
    if (document.getElementById('channelA').checked) include.push('A');
    if (document.getElementById('channelB').checked) include.push('B');
    return include;
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('selectAll');
    const fileCheckboxes = document.querySelectorAll('.file-checkbox');

    fileCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
    updateTimelineSelection();
}

function updateSelectAllState() {
    const fileCheckboxes = document.querySelectorAll('.file-checkbox');
    const selectAllCheckbox = document.getElementById('selectAll');

    const checkedCount = Array.from(fileCheckboxes).filter(cb => cb.checked).length;

    if (checkedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === fileCheckboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

function generateTimeMarkers(minTime, maxTime) {
    const markers = [];
    const halfDayZones = [];
    const startDate = new Date(minTime);
    const endDate = new Date(maxTime);

    // Start from the first day
    const currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

    while (currentDate <= endDate) {
        const dayStart = new Date(currentDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(23, 59, 59, 999);

        // Only process if the day overlaps with our time range
        if (dayEnd.getTime() >= minTime && dayStart.getTime() <= maxTime) {
            // Midnight marker (🌙 - crescent moon)
            const midnight = new Date(currentDate);
            midnight.setHours(0, 0, 0, 0);

            if (midnight.getTime() >= minTime && midnight.getTime() <= maxTime) {
                const position = ((midnight.getTime() - minTime) / (maxTime - minTime)) * 100;
                const dateStr = midnight.toLocaleDateString();
                const timeStr = midnight.toLocaleTimeString();
                markers.push(`
                    <div class="time-marker midnight clickable" data-symbol="🌙" data-time="${midnight.getTime()}" data-type="midnight" style="left: ${position}%">
                        <div class="time-marker-tooltip">🌙 Midnight<br>${dateStr} ${timeStr}<br>Click for half-day selection</div>
                    </div>
                `);
            }

            // Noon marker (☀️ - sun)
            const noon = new Date(currentDate);
            noon.setHours(12, 0, 0, 0);

            if (noon.getTime() >= minTime && noon.getTime() <= maxTime) {
                const position = ((noon.getTime() - minTime) / (maxTime - minTime)) * 100;
                const dateStr = noon.toLocaleDateString();
                const timeStr = noon.toLocaleTimeString();
                markers.push(`
                    <div class="time-marker noon clickable" data-symbol="☀️" data-time="${noon.getTime()}" data-type="noon" style="left: ${position}%">
                        <div class="time-marker-tooltip">☀️ Noon<br>${dateStr} ${timeStr}<br>Click for whole day selection</div>
                    </div>
                `);
            }

            // Generate half-day zones
            const morningStart = Math.max(minTime, dayStart.getTime());
            const morningEnd = Math.min(maxTime, noon.getTime());
            const eveningStart = Math.max(minTime, noon.getTime());
            const eveningEnd = Math.min(maxTime, dayEnd.getTime());

            // Morning half-day zone
            if (morningStart < morningEnd) {
                const startPos = ((morningStart - minTime) / (maxTime - minTime)) * 100;
                const endPos = ((morningEnd - minTime) / (maxTime - minTime)) * 100;
                const width = endPos - startPos;

                halfDayZones.push(`
                    <div class="half-day-zone" 
                         data-start="${morningStart}" 
                         data-end="${morningEnd}" 
                         data-label="Morning ${new Date(morningStart).toLocaleDateString()}"
                         style="left: ${startPos}%; width: ${width}%">
                    </div>
                `);
            }

            // Evening half-day zone
            if (eveningStart < eveningEnd) {
                const startPos = ((eveningStart - minTime) / (maxTime - minTime)) * 100;
                const endPos = ((eveningEnd - minTime) / (maxTime - minTime)) * 100;
                const width = endPos - startPos;

                halfDayZones.push(`
                    <div class="half-day-zone" 
                         data-start="${eveningStart}" 
                         data-end="${eveningEnd}" 
                         data-label="Evening ${new Date(eveningStart).toLocaleDateString()}"
                         style="left: ${startPos}%; width: ${width}%">
                    </div>
                `);
            }
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return halfDayZones.join('') + markers.join('');
}

function createTimeline(files) {
    if (files.length === 0) return '';

    const times = files.map(f => new Date(f.utcTime).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime;

    // If all files have the same timestamp, create a minimal range
    const actualRange = timeRange === 0 ? 3600000 : timeRange; // 1 hour minimum
    const actualMin = timeRange === 0 ? minTime - 1800000 : minTime; // 30 min before if same time
    const actualMax = timeRange === 0 ? maxTime + 1800000 : maxTime; // 30 min after if same time

    timelineData = {
        minTime: actualMin,
        maxTime: actualMax,
        range: actualMax - actualMin,
        files: files
    };

    const fileMarkers = files.map((file, index) => {
        const position = ((new Date(file.utcTime).getTime() - actualMin) / (actualMax - actualMin)) * 100;
        const directoryType = file.directoryType || 'Other';
        return `<div class="file-marker file-marker-${directoryType.toLowerCase()}" data-index="${index}" data-directory="${directoryType}" style="left: ${position}%" title="${file.filename} (${directoryType})&#10;Click to select ±3 minute range"></div>`;
    }).join('');

    // Generate time markers for midnight and noon
    const timeMarkers = generateTimeMarkers(actualMin, actualMax);

    return `
        <div class="timeline-section">
            <div class="section-title">2. Set Date Range Filter</div>
            <div class="timeline-legend">
                <span class="legend-label">File Markers:</span>
                <span class="legend-item"><span class="legend-marker legend-marker-normal"></span> Normal</span>
                <span class="legend-item"><span class="legend-marker legend-marker-emr"></span> Emergency</span>
                <span class="legend-item"><span class="legend-marker legend-marker-park"></span> Parking</span>
                <span class="legend-item"><span class="legend-marker legend-marker-other"></span> Other</span>
            </div>
            <div class="timeline-container">
                <div class="timeline-labels">
                    <span class="timeline-label-start">${new Date(actualMin).toLocaleString()}</span>
                    <span class="timeline-label-end">${new Date(actualMax).toLocaleString()}</span>
                </div>
                <div class="timeline-track">
                    <div class="timeline-background"></div>
                    <div class="time-markers">
                        ${timeMarkers}
                    </div>
                    ${fileMarkers}
                    <div class="timeline-range">
                        <div class="range-handle range-start" data-type="start" data-symbol="⏮" title="Drag to set start time"></div>
                        <div class="range-selection"></div>
                        <div class="range-handle range-end" data-type="end" data-symbol="⏭" title="Drag to set end time"></div>
                    </div>
                </div>
                <div class="timeline-info">
                    <div class="range-display">
                        <span>Start: <span id="rangeStartDisplay">${new Date(actualMin).toLocaleString()}</span></span>
                        <span>End: <span id="rangeEndDisplay">${new Date(actualMax).toLocaleString()}</span></span>
                        <button id="resetRange" class="reset-btn">Reset Range</button>
                    </div>
                </div>
                <div class="timeline-separator"></div>
                <div class="manual-edit-section">
                    <div class="manual-edit-title">Manual Date/Time Editing</div>
                    <div class="manual-edit-controls">
                        <div class="manual-edit-group">
                            <label for="manualStartTime">Start Date/Time:</label>
                            <input type="datetime-local" id="manualStartTime" step="1">
                        </div>
                        <div class="manual-edit-group">
                            <label for="manualEndTime">End Date/Time:</label>
                            <input type="datetime-local" id="manualEndTime" step="1">
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

// Optional function to switch between different icon styles
function setTimelineIconStyle(style = 'default') {
    const rangeHandles = document.querySelectorAll('.range-handle');

    // Remove existing style classes
    rangeHandles.forEach(handle => {
        handle.classList.remove('arrow-style', 'double-arrow-style', 'geometric-style', 'bracket-style');
    });

    // Apply new style
    if (style !== 'default') {
        rangeHandles.forEach(handle => {
            handle.classList.add(`${style}-style`);
        });
    }
}

// You can call this function to switch styles:
// setTimelineIconStyle('arrow-style');      // ◀ ▶
// setTimelineIconStyle('double-arrow-style'); // ⇤ ⇥
// setTimelineIconStyle('geometric-style');   // ⮜ ⮞
// setTimelineIconStyle('bracket-style');     // ⟨ ⟩
function initializeTimeline() {
    const rangeStart = document.querySelector('.range-start');
    const rangeEnd = document.querySelector('.range-end');
    const rangeSelection = document.querySelector('.range-selection');
    const track = document.querySelector('.timeline-track');
    const manualStartInput = document.getElementById('manualStartTime');
    const manualEndInput = document.getElementById('manualEndTime');

    let isDragging = false;
    let dragTarget = null;
    let startPercent = 0;
    let endPercent = 100;

    // Magnetic snapping configuration
    const SNAP_THRESHOLD = 1.5; // 3% of timeline width
    const snapPoints = [];

    // Collect snap points from time markers (only noon and midnight) and files
    function updateSnapPoints() {
        snapPoints.length = 0;

        // Add noon and midnight markers as snap points
        document.querySelectorAll('.time-marker.noon, .time-marker.midnight').forEach(marker => {
            const left = parseFloat(marker.style.left);
            const time = parseInt(marker.dataset.time);
            snapPoints.push({ percent: left, time, element: marker, type: 'time-marker' });
        });

        // Add file markers as snap points
        document.querySelectorAll('.file-marker').forEach(marker => {
            const left = parseFloat(marker.style.left);
            const fileIndex = parseInt(marker.dataset.index);
            const file = scannedFiles[fileIndex];
            const time = new Date(file.utcTime).getTime();
            snapPoints.push({ percent: left, time, element: marker, type: 'file-marker' });
        });
    }

    // Initialize manual inputs with current range
    const startTime = timelineData.minTime;
    const endTime = timelineData.maxTime;
    manualStartInput.value = formatDateTimeLocal(new Date(startTime));
    manualEndInput.value = formatDateTimeLocal(new Date(endTime));

    // Update snap points after timeline is rendered
    setTimeout(updateSnapPoints, 100);

    function formatDateTimeLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    function findNearestSnapPoint(percent) {
        let nearestSnap = null;
        let minDistance = SNAP_THRESHOLD;

        snapPoints.forEach(snap => {
            const distance = Math.abs(snap.percent - percent);
            if (distance < minDistance) {
                minDistance = distance;
                nearestSnap = snap;
            }
        });

        return nearestSnap;
    }

    function updateRangeDisplay() {
        const startTime = timelineData.minTime + (startPercent / 100) * timelineData.range;
        const endTime = timelineData.minTime + (endPercent / 100) * timelineData.range;

        document.getElementById('rangeStartDisplay').textContent = new Date(startTime).toLocaleString();
        document.getElementById('rangeEndDisplay').textContent = new Date(endTime).toLocaleString();

        // Update manual inputs
        manualStartInput.value = formatDateTimeLocal(new Date(startTime));
        manualEndInput.value = formatDateTimeLocal(new Date(endTime));

        // Update visual selection
        rangeSelection.style.left = `${startPercent}%`;
        rangeSelection.style.width = `${endPercent - startPercent}%`;

        // Filter files based on selection
        filterFilesByTimeRange(startTime, endTime);
    }

    function setRangeFromTimes(startTime, endTime) {
        const newStartPercent = Math.max(0, Math.min(100, ((startTime - timelineData.minTime) / timelineData.range) * 100));
        const newEndPercent = Math.max(0, Math.min(100, ((endTime - timelineData.minTime) / timelineData.range) * 100));

        startPercent = newStartPercent;
        endPercent = newEndPercent;
        rangeStart.style.left = `${startPercent}%`;
        rangeEnd.style.left = `${endPercent}%`;

        updateRangeDisplay();
    }

    function updateFromManualInput() {
        const manualStartTime = new Date(manualStartInput.value).getTime();
        const manualEndTime = new Date(manualEndInput.value).getTime();

        if (isNaN(manualStartTime) || isNaN(manualEndTime)) {
            return;
        }

        if (manualStartTime >= manualEndTime) {
            alert('Start time must be before end time');
            return;
        }

        setRangeFromTimes(manualStartTime, manualEndTime);
    }

    function handleMouseDown(e, handle) {
        isDragging = true;
        dragTarget = handle;
        track.style.cursor = 'grabbing';
        e.preventDefault();
        updateSnapPoints();
    }

    function handleMouseMove(e) {
        if (!isDragging || !dragTarget) return;

        const rect = track.getBoundingClientRect();
        let percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));

        // Check for magnetic snapping (only to files and noon/midnight markers)
        const nearestSnap = findNearestSnapPoint(percent);
        let isSnapping = false;

        if (nearestSnap) {
            percent = nearestSnap.percent;
            isSnapping = true;
        }

        // Apply snapping visual feedback
        dragTarget.classList.toggle('snapping', isSnapping);

        if (dragTarget.classList.contains('range-start')) {
            startPercent = Math.min(percent, endPercent - 1);
            dragTarget.style.left = `${startPercent}%`;
        } else {
            endPercent = Math.max(percent, startPercent + 1);
            dragTarget.style.left = `${endPercent}%`;
        }

        updateRangeDisplay();
    }

    function handleMouseUp() {
        isDragging = false;
        dragTarget = null;
        track.style.cursor = '';

        // Remove snapping visual feedback
        rangeStart.classList.remove('snapping');
        rangeEnd.classList.remove('snapping');
    }

    // Event listeners for handles
    rangeStart.addEventListener('mousedown', (e) => handleMouseDown(e, rangeStart));
    rangeEnd.addEventListener('mousedown', (e) => handleMouseDown(e, rangeEnd));

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Event listeners for manual inputs
    manualStartInput.addEventListener('change', updateFromManualInput);
    manualEndInput.addEventListener('change', updateFromManualInput);

    // Time marker click handlers
    document.addEventListener('click', (e) => {
        const timeMarker = e.target.closest('.time-marker');
        const halfDayZone = e.target.closest('.half-day-zone');
        const fileMarker = e.target.closest('.file-marker');

        if (fileMarker && fileMarker.dataset.index) {
            // File marker clicked: select range -3 to +3 minutes (6 minute window)
            const MINI_RANGE_MINUTES = 3; // Constant for now, will be configurable later
            const fileIndex = parseInt(fileMarker.dataset.index);
            const file = scannedFiles[fileIndex];
            const fileTime = new Date(file.utcTime).getTime();
            
            // Calculate -3 and +3 minutes range
            const rangeStart = fileTime - (MINI_RANGE_MINUTES * 60 * 1000);
            const rangeEnd = fileTime + (MINI_RANGE_MINUTES * 60 * 1000);
            
            setRangeFromTimes(rangeStart, rangeEnd);
        } else if (timeMarker && timeMarker.dataset.time) {
            const markerTime = parseInt(timeMarker.dataset.time);
            const markerType = timeMarker.dataset.type;

            if (markerType === 'noon') {
                // Select the whole day (midnight to midnight)
                const dayStart = new Date(markerTime);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(markerTime);
                dayEnd.setHours(23, 59, 59, 999);

                setRangeFromTimes(dayStart.getTime(), dayEnd.getTime());
            } else if (markerType === 'midnight') {
                // Select range from previous noon to next noon
                const prevNoon = new Date(markerTime);
                prevNoon.setDate(prevNoon.getDate() - 1);
                prevNoon.setHours(12, 0, 0, 0);
                const nextNoon = new Date(markerTime);
                nextNoon.setHours(12, 0, 0, 0);

                setRangeFromTimes(prevNoon.getTime(), nextNoon.getTime());
            }
        } else if (halfDayZone) {
            // Select half-day zone
            const startTime = parseInt(halfDayZone.dataset.start);
            const endTime = parseInt(halfDayZone.dataset.end);

            setRangeFromTimes(startTime, endTime);
        }
    });

    // Reset button
    document.getElementById('resetRange').addEventListener('click', () => {
        startPercent = 0;
        endPercent = 100;
        rangeStart.style.left = '0%';
        rangeEnd.style.left = '100%';
        updateRangeDisplay();
    });

    // Initial update
    updateRangeDisplay();
}

function filterFilesByTimeRange(startTime, endTime) {
    const fileCheckboxes = document.querySelectorAll('.file-checkbox');
    let visibleCount = 0;

    fileCheckboxes.forEach((checkbox, index) => {
        const file = scannedFiles[index];
        const fileTime = new Date(file.utcTime).getTime();
        const inRange = fileTime >= startTime && fileTime <= endTime;

        const fileItem = checkbox.closest('.file-item');
        if (inRange) {
            fileItem.style.display = 'block';
            visibleCount++;
        } else {
            fileItem.style.display = 'none';
            checkbox.checked = false;
        }
    });

    // Update file markers visibility
    const fileMarkers = document.querySelectorAll('.file-marker');
    fileMarkers.forEach((marker, index) => {
        const file = scannedFiles[index];
        const fileTime = new Date(file.utcTime).getTime();
        const inRange = fileTime >= startTime && fileTime <= endTime;
        marker.style.opacity = inRange ? '1' : '0.3';
    });

    // Update count display
    const countDiv = document.querySelector('.count');
    if (countDiv) {
        countDiv.textContent = `Found ${scannedFiles.length} file(s) total, ${visibleCount} in selected range`;
    }

    updateSelectAllState();
}

function updateTimelineSelection() {
    // This function can be used to sync timeline with checkbox selections if needed
}

async function scanFolder() {
    const folderPath = document.getElementById('folderPath').value.trim();
    const includeChannels = selectedChannels();
    const resultsDiv = document.getElementById('results');

    if (!folderPath) {
        resultsDiv.innerHTML = '<div class="error">Please select a folder</div>';
        return;
    }

    if (includeChannels.length === 0) {
        resultsDiv.innerHTML = '<div class="error">Select at least one channel (A/B)</div>';
        return;
    }

    // Get pre-scan filter dates
    const filterDates = getPreScanFilterDates();
    if (filterDates === null) return; // Validation failed

    resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div>Scanning...</div>';

    try {
        const response = await fetch('/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folderPath,
                startTime: filterDates.startTime,
                endTime: filterDates.endTime,
                channels: includeChannels
            })
        });

        const data = await response.json();
        if (!response.ok) {
            let result = '';
            result += `<div class="error">${data.error}</div>`;
            result += `<div class="error2">${data.message}</div>`;
            resultsDiv.innerHTML = result;
            return;
        }

        scannedFiles = data.files;
        if (data.count === 0) {
            let message = 'No files found in the specified channels';
            if (filterDates.startTime || filterDates.endTime) {
                message += ' within the specified date range';
            }
            resultsDiv.innerHTML = `<div class="count">${message}</div>`;
            return;
        }

        const filesList = data.files.map((f, index) => `
      <div class="file-item">
        <label class="file-checkbox-label">
          <input type="checkbox" class="file-checkbox" data-index="${index}" checked />
          <div class="file-info">
            <div class="file-path">${f.filename}</div>
            <div class="file-time">UTC: ${new Date(f.utcTime).toLocaleString()}</div>
          </div>
        </label>
      </div>`).join('');

        // Get saved output path
        const savedOutputPath = localStorage.getItem('mp4-combiner-output-path') || '';

        const timelineHTML = createTimeline(data.files);

        let countMessage = `Found ${data.count} file(s)`;
        if (filterDates.startTime || filterDates.endTime) {
            countMessage += ' within the specified date range';
        }

        resultsDiv.innerHTML = `
      <div class="results">
        <div class="count">${countMessage}</div>
        ${timelineHTML}
        <div class="file-list-container">
          <div class="select-all-container">
            <label class="select-all-label">
              <input type="checkbox" id="selectAll" checked />
              Select All (in range)
            </label>
          </div>
          <div class="file-list">${filesList}</div>
        </div>
        <div class="combine-section">
          <div class="section-title">3. Combine Selected Videos</div>
          <div class="input-group">
            <label>Output File:</label>
            <input type="text" id="outputPath" value="${savedOutputPath}" placeholder="e.g., C:\\\\combined_output.mp4" />
            <button class="secondary" id="combineBtn" ${!ffmpegAvailable ? 'disabled' : ''}>Combine</button>
          </div>
          <div id="combineStatus"></div>
        </div>
      </div>`;

        // Initialize timeline after DOM is ready
        setTimeout(() => {
            initializeTimeline();
        }, 100);

        // Add event listeners for checkboxes
        document.getElementById('selectAll').addEventListener('change', toggleSelectAll);

        const fileCheckboxes = document.querySelectorAll('.file-checkbox');
        fileCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSelectAllState);
        });

        // Add event listener to save output path
        document.getElementById('outputPath').addEventListener('input', savePaths);

        document.getElementById('combineBtn').addEventListener('click', combineVideos);
    } catch (err) {
        resultsDiv.innerHTML = '<div class="error">Failed to scan folder.</div>';
    }
}

async function combineVideos() {
    const outputPath = document.getElementById('outputPath').value.trim();
    const statusDiv = document.getElementById('combineStatus');

    if (!outputPath) {
        statusDiv.innerHTML = '<div class="error">Please enter an output path</div>';
        return;
    }

    // Get only checked and visible files
    const checkedFileIndexes = Array.from(document.querySelectorAll('.file-checkbox:checked'))
        .filter(cb => cb.closest('.file-item').style.display !== 'none')
        .map(cb => parseInt(cb.dataset.index));

    const selectedFiles = checkedFileIndexes.map(index => scannedFiles[index]);

    if (selectedFiles.length === 0) {
        statusDiv.innerHTML = '<div class="error">No files selected for combining</div>';
        return;
    }

    statusDiv.innerHTML = `<div class="loading"><div class="spinner"></div>Combining ${selectedFiles.length} file(s)...</div>`;

    try {
        const filePaths = selectedFiles.map(f => f.path);
        const response = await fetch('/combine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filePaths, outputPath })
        });

        const data = await response.json();
        if (!response.ok) {
            statusDiv.innerHTML = `<div class="error">${data.error}</div>`;
            return;
        }

        statusDiv.innerHTML = `<div class="success">✅ Combined ${selectedFiles.length} file(s)!<br>${data.output}</div>`;
    } catch {
        statusDiv.innerHTML = '<div class="error">Failed to combine videos.</div>';
    }
}