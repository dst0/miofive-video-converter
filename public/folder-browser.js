// Folder Browser Module
// This module handles the interactive folder selection interface

import {escapeHtml, safeStorage as localStorage} from './security.js';
import {showDialogPanel, closeDialogPanel} from './dialog.js';

let currentBrowsePath = null;
let browsePurpose = 'scan';
let folderBrowseAbortController = null;
let folderBrowseGeneration = 0;

let isFolderBrowserInitialized = false;

// Initialize the folder browser
export function initializeFolderBrowser() {
    if (isFolderBrowserInitialized) return;
    isFolderBrowserInitialized = true;

    const browseFolderBtn = document.getElementById('browseFolderBtn');
    const modal = document.getElementById('folderBrowserModal');
    const closeBrowserBtn = document.getElementById('closeBrowserBtn');
    const cancelBrowserBtn = document.getElementById('cancelBrowserBtn');
    const selectFolderBtn = document.getElementById('selectFolderBtn');

    browseFolderBtn.addEventListener('click', () => openFolderBrowser({purpose: 'scan'}));
    closeBrowserBtn.addEventListener('click', closeFolderBrowser);
    cancelBrowserBtn.addEventListener('click', closeFolderBrowser);
    selectFolderBtn.addEventListener('click', selectCurrentFolder);

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeFolderBrowser();
        }
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (modal.style.display !== 'flex') return;
        if (e.key === 'Tab') {
            const elements = [...modal.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
            const first = elements[0];
            const last = elements.at(-1);
            if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
                e.preventDefault();
                last?.focus();
            } else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
                e.preventDefault();
                first?.focus();
            }
            e.stopImmediatePropagation();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeFolderBrowser();
        }
    });
}

// Open the folder browser modal
export async function openFolderBrowser({purpose = 'scan'} = {}) {
    folderBrowseAbortController?.abort();
    folderBrowseAbortController = null;
    folderBrowseGeneration++;
    browsePurpose = purpose === 'export' ? 'export' : 'scan';
    
    // Determine starting path based on whether we're browsing for output or input
    if (browsePurpose === 'export') {
        const exportOutputFolderInput = document.getElementById('exportOutputFolder');
        currentBrowsePath = exportOutputFolderInput?.value || null;
    } else {
        const folderPathInput = document.getElementById('folderPath');
        currentBrowsePath = folderPathInput?.value || null;
    }
    
    showDialogPanel('folderBrowserModal', 'folderBrowserTitle', closeFolderBrowser);
    await loadFolderContents(currentBrowsePath);
}

// Close the folder browser modal
function closeFolderBrowser() {
    folderBrowseAbortController?.abort();
    folderBrowseAbortController = null;
    folderBrowseGeneration++;

    closeDialogPanel('folderBrowserModal');
    currentBrowsePath = null;
    browsePurpose = 'scan';
}

// Select the current folder and close the browser
function selectCurrentFolder() {
    if (currentBrowsePath) {
        // Check if we're browsing for export (from player), output folder, or input folder
        if (browsePurpose === 'export') {
            const exportOutputFolderInput = document.getElementById('exportOutputFolder');
            if (exportOutputFolderInput) {
                exportOutputFolderInput.value = currentBrowsePath;
                localStorage.setItem('mp4-combiner-output-folder', currentBrowsePath);
            }
        } else {
            const folderPathInput = document.getElementById('folderPath');
            folderPathInput.value = currentBrowsePath;
            
            folderPathInput.dispatchEvent(new Event('input', {bubbles: true}));
        }
    }
    closeFolderBrowser();
}

// Load and display folder contents
async function loadFolderContents(path, retryFromRoot = true) {
    folderBrowseAbortController?.abort();
    const abortController = new AbortController();
    folderBrowseAbortController = abortController;
    const requestGeneration = ++folderBrowseGeneration;

    const folderTree = document.getElementById('folderTree');
    const currentPathDisplay = document.getElementById('currentPathDisplay');
    
    folderTree.innerHTML = '<div class="loading-folders">Loading folders...</div>';
    currentPathDisplay.textContent = path || 'Select a starting location';
    currentBrowsePath = path || null;
    document.getElementById('selectFolderBtn').disabled = true;
    
    try {
        const response = await fetch('/list-directories', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path}),
            signal: abortController.signal,
        });
        
        const data = await response.json();
        if (requestGeneration !== folderBrowseGeneration || abortController.signal.aborted) {
            return;
        }
        
        if (!response.ok) {
            if (path && retryFromRoot) {
                currentBrowsePath = null;
                await loadFolderContents(null, false);
                return;
            }
            folderTree.innerHTML = `<div class="empty-folder-message">Error: ${escapeHtml(data.error || 'Unable to load folders')}</div>`;
            return;
        }
        
        const directories = data.directories || [];
        document.getElementById('selectFolderBtn').disabled = !path;
        
        // Update current path display and selected browse path
        if (path) {
            currentPathDisplay.textContent = path;
            currentBrowsePath = path;
        } else {
            currentBrowsePath = null;
        }
        
        // Build folder tree HTML. Keep parent navigation visible even for leaf folders.
        let html = '';
        
        // Add parent directory option if we're not at root
        if (path) {
            const parentPath = getParentPath(path);
            html += `
                <div class="folder-item parent-folder" role="button" tabindex="0" data-path="${escapeHtml(parentPath || '')}">
                    <span class="folder-icon">↩️</span>
                    <span class="folder-name">.. (Parent Directory)</span>
                </div>
            `;
        }

        if (directories.length === 0) {
            html += '<div class="empty-folder-message">No subdirectories found</div>';
        }
        
        // Add all subdirectories with appropriate icons based on type
        directories.forEach(dir => {
            let icon = '📁'; // Default folder icon
            let itemClass = 'folder-item';
            
            // Set icon based on type
            if (dir.type === 'drive') {
                icon = '💾'; // Floppy disk for drives
                itemClass += ' drive-item';
            } else if (dir.type === 'common') {
                icon = '⭐'; // Star for common places
                itemClass += ' common-item';
            } else if (dir.type === 'system') {
                icon = '🖥️'; // Computer for system locations
                itemClass += ' system-item';
            }
            
            html += `
                <div class="${itemClass}" role="button" tabindex="0" data-path="${escapeHtml(dir.path)}">
                    <span class="folder-icon">${icon}</span>
                    <span class="folder-name">${escapeHtml(dir.name)}</span>
                </div>
            `;
        });
        
        folderTree.innerHTML = html;
        
        // Add click handlers
        const folderItems = folderTree.querySelectorAll('.folder-item');
        folderItems.forEach(item => {
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    item.click();
                }
            });
            item.addEventListener('click', async () => {
                const folderPath = item.dataset.path;
                currentBrowsePath = folderPath;
                
                // Remove selected class from all items
                folderItems.forEach(i => i.classList.remove('selected'));
                
                // Add selected class to clicked item
                if (!item.classList.contains('parent-folder')) {
                    item.classList.add('selected');
                }
                
                // Load contents of clicked folder
                await loadFolderContents(folderPath);
            });
        });
        
    } catch (error) {
        if (requestGeneration !== folderBrowseGeneration || abortController.signal.aborted || error.name === 'AbortError') {
            return;
        }
        folderTree.innerHTML = '<div class="empty-folder-message">Failed to load folders</div>';
        console.error('Error loading folders:', error);
    }
}

// Get the parent directory path
function getParentPath(path) {
    if (!path) return null;
    const windowsPath = /^[A-Z]:[/\\]/i.test(path) || path.startsWith('\\\\');
    
    // Handle Windows paths
    if (path.match(/^[A-Z]:\\$/i)) {
        return null; // Already at root drive
    }
    
    // Handle Unix paths
    if (path === '/') {
        return null; // Already at root
    }
    
    // Remove trailing slashes
    path = windowsPath ? path.replace(/[/\\]+$/, '') : path.replace(/\/+$/, '');
    
    // Get parent directory
    const parts = path.split(windowsPath ? /[/\\]/ : '/');
    parts.pop();
    
    if (parts.length === 0) {
        return null;
    }
    
    const parent = parts.join(windowsPath ? '\\' : '/');
    
    // Handle Windows drive letter
    if (parent.match(/^[A-Z]:$/i)) {
        return parent + '\\';
    }
    
    // Handle Unix root
    if (parent === '') {
        return '/';
    }
    
    return parent;
}
