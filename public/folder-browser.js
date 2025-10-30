// Folder Browser Module
// This module handles the interactive folder selection interface

let currentBrowsePath = null;

// Initialize the folder browser
export function initializeFolderBrowser() {
    const browseFolderBtn = document.getElementById('browseFolderBtn');
    const modal = document.getElementById('folderBrowserModal');
    const closeBrowserBtn = document.getElementById('closeBrowserBtn');
    const cancelBrowserBtn = document.getElementById('cancelBrowserBtn');
    const selectFolderBtn = document.getElementById('selectFolderBtn');

    browseFolderBtn.addEventListener('click', openFolderBrowser);
    closeBrowserBtn.addEventListener('click', closeFolderBrowser);
    cancelBrowserBtn.addEventListener('click', closeFolderBrowser);
    selectFolderBtn.addEventListener('click', selectCurrentFolder);

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeFolderBrowser();
        }
    });
}

// Open the folder browser modal
async function openFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    const folderPathInput = document.getElementById('folderPath');
    
    // Start from saved path or home directory
    currentBrowsePath = folderPathInput.value || null;
    
    modal.style.display = 'flex';
    await loadFolderContents(currentBrowsePath);
}

// Close the folder browser modal
function closeFolderBrowser() {
    const modal = document.getElementById('folderBrowserModal');
    modal.style.display = 'none';
}

// Select the current folder and close the browser
function selectCurrentFolder() {
    if (currentBrowsePath) {
        const folderPathInput = document.getElementById('folderPath');
        folderPathInput.value = currentBrowsePath;
        
        // Save the selected path to localStorage
        if (typeof savePaths === 'function') {
            savePaths();
        } else {
            localStorage.setItem('mp4-combiner-folder-path', currentBrowsePath);
        }
    }
    closeFolderBrowser();
}

// Load and display folder contents
async function loadFolderContents(path) {
    const folderTree = document.getElementById('folderTree');
    const currentPathDisplay = document.getElementById('currentPathDisplay');
    
    folderTree.innerHTML = '<div class="loading-folders">Loading folders...</div>';
    currentPathDisplay.textContent = path || 'Select a starting location';
    
    try {
        const response = await fetch('/list-directories', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path})
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            folderTree.innerHTML = `<div class="empty-folder-message">Error: ${data.error}</div>`;
            return;
        }
        
        const directories = data.directories || [];
        
        if (directories.length === 0) {
            folderTree.innerHTML = '<div class="empty-folder-message">No subdirectories found</div>';
            return;
        }
        
        // Update current path display
        if (path) {
            currentPathDisplay.textContent = path;
        }
        
        // Build folder tree HTML
        let html = '';
        
        // Add parent directory option if we're not at root
        if (path) {
            const parentPath = getParentPath(path);
            html += `
                <div class="folder-item parent-folder" data-path="${parentPath || ''}">
                    <span class="folder-icon">↩️</span>
                    <span class="folder-name">.. (Parent Directory)</span>
                </div>
            `;
        }
        
        // Add all subdirectories
        directories.forEach(dir => {
            html += `
                <div class="folder-item" data-path="${dir.path}">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${dir.name}</span>
                </div>
            `;
        });
        
        folderTree.innerHTML = html;
        
        // Add click handlers
        const folderItems = folderTree.querySelectorAll('.folder-item');
        folderItems.forEach(item => {
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
        folderTree.innerHTML = '<div class="empty-folder-message">Failed to load folders</div>';
        console.error('Error loading folders:', error);
    }
}

// Get the parent directory path
function getParentPath(path) {
    if (!path) return null;
    
    // Handle Windows paths
    if (path.match(/^[A-Z]:\\$/i)) {
        return null; // Already at root drive
    }
    
    // Handle Unix paths
    if (path === '/') {
        return null; // Already at root
    }
    
    // Remove trailing slashes
    path = path.replace(/[\/\\]+$/, '');
    
    // Get parent directory
    const parts = path.split(/[\/\\]/);
    parts.pop();
    
    if (parts.length === 0) {
        return null;
    }
    
    const parent = parts.join(path.includes('\\') ? '\\' : '/');
    
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
