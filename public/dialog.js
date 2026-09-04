// One native modal boundary with a stack of retained form panels. Switching
// panels must not create competing or stale WebKit accessibility boundaries.
const panels = [];
let initialized = false;

function activate(entry) {
    const dialog = document.getElementById('productDialog');
    for (const item of panels) {
        const active = item === entry;
        item.panel.hidden = !active;
        item.panel.inert = !active;
        item.panel.setAttribute('aria-hidden', String(!active));
    }
    dialog.setAttribute('aria-labelledby', entry.titleId);
    dialog.removeAttribute('aria-hidden');
    dialog.style.display = 'flex';
    if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
    } else {
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
    }
}

export function showDialogPanel(panelId, titleId, onCancel) {
    const dialog = document.getElementById('productDialog');
    if (!initialized) {
        initialized = true;
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            panels.at(-1)?.onCancel();
        });
    }
    let entry = panels.find((item) => item.panel.id === panelId);
    if (!entry) {
        entry = {panel: document.getElementById(panelId), titleId, onCancel, returnFocus: document.activeElement};
        panels.push(entry);
    }
    // An asynchronous background action must not replace the active child.
    if (entry !== panels.at(-1)) return;
    entry.panel.style.display = 'flex';
    activate(entry);
    entry.panel.querySelector('button:not(:disabled), input:not(:disabled), [tabindex="0"]')?.focus();
}

export function closeDialogPanel(panelId) {
    const index = panels.findIndex((item) => item.panel.id === panelId);
    if (index === -1) return;
    const wasActive = index === panels.length - 1;
    const [entry] = panels.splice(index, 1);
    entry.panel.style.display = 'none';
    entry.panel.hidden = false;
    entry.panel.inert = false;
    entry.panel.setAttribute('aria-hidden', 'true');
    // Closing an inactive parent must neither close its child nor restore focus
    // into a form that no longer exists in the modal stack.
    const child = panels[index];
    if (child && entry.panel.contains(child.returnFocus)) child.returnFocus = entry.returnFocus;
    if (!wasActive) return;
    const current = panels.at(-1);
    if (current) {
        activate(current);
    } else {
        const dialog = document.getElementById('productDialog');
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        dialog.style.display = 'none';
        dialog.setAttribute('aria-hidden', 'true');
        dialog.removeAttribute('aria-modal');
    }
    const target = entry.returnFocus;
    if (target instanceof HTMLElement && target.isConnected && target.getClientRects().length &&
        (!current || current.panel.contains(target))) {
        target.focus({preventScroll: true});
    } else if (current) {
        current.panel.querySelector('button:not(:disabled), input:not(:disabled), [tabindex="0"]')?.focus();
    }
}
