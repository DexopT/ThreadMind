const dot = document.getElementById('dot');
const status = document.getElementById('status');
const btn = document.getElementById('toggleBtn');

// ─── State Rendering ─────────────────────────────────────────────────────────

function render(state) {
    // state: 'inactive', 'connecting', 'active'
    dot.className = 'dot ' + state;

    if (state === 'active') {
        status.textContent = 'Connected to ThreadMind';
        btn.textContent = 'Stop';
        btn.className = 'btn btn-stop';
    } else if (state === 'connecting') {
        status.textContent = 'Connecting...';
        btn.textContent = 'Stop';
        btn.className = 'btn btn-stop';
    } else {
        status.textContent = 'Inactive';
        btn.textContent = 'Activate';
        btn.className = 'btn btn-activate';
    }
}

// ─── Load Current State ──────────────────────────────────────────────────────

async function loadState() {
    const data = await chrome.storage.local.get(['bridgeActive', 'wsConnected']);
    if (data.bridgeActive) {
        render(data.wsConnected ? 'active' : 'connecting');
    } else {
        render('inactive');
    }
}

// ─── Toggle Button ───────────────────────────────────────────────────────────

btn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['bridgeActive']);
    const isActive = !!data.bridgeActive;

    if (isActive) {
        // Deactivate
        await chrome.storage.local.set({ bridgeActive: false, wsConnected: false });
        chrome.runtime.sendMessage({ cmd: 'deactivate' });
        render('inactive');
    } else {
        // Activate
        await chrome.storage.local.set({ bridgeActive: true, wsConnected: false });
        chrome.runtime.sendMessage({ cmd: 'activate' });
        render('connecting');
    }
});

// ─── Listen for state changes while popup is open ────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
    if (changes.wsConnected || changes.bridgeActive) {
        loadState();
    }
});

// ─── Init ────────────────────────────────────────────────────────────────────
loadState();
