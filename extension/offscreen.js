// ─── ThreadMind Offscreen Document ───────────────────────────────────────────
// This document runs persistently (unlike the service worker) and holds the
// WebSocket connection to the ThreadMind agent server.
// All WS messages are relayed to/from background.js via chrome.runtime messaging.

const WS_URL = 'ws://127.0.0.1:9090';
const RECONNECT_INTERVAL_MS = 3000;

let ws = null;
let shouldBeActive = true;

// ─── WebSocket Connection ────────────────────────────────────────────────────

function connect() {
    if (!shouldBeActive) return;

    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('[ThreadMind-WS] Connected to agent server.');
            chrome.storage.local.set({ wsConnected: true });
        };

        ws.onmessage = async (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                console.warn('[ThreadMind-WS] Invalid message:', event.data);
                return;
            }

            // Forward the command to background.js for processing
            try {
                const response = await chrome.runtime.sendMessage({
                    cmd: 'ws_command',
                    payload: message,
                });
                // Send the response back via WebSocket
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ ...response, requestId: message.requestId }));
                }
            } catch (err) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        requestId: message.requestId,
                        error: err.message || 'Extension error',
                    }));
                }
            }
        };

        ws.onclose = () => {
            console.log('[ThreadMind-WS] Disconnected.');
            ws = null;
            chrome.storage.local.set({ wsConnected: false });
            if (shouldBeActive) {
                setTimeout(connect, RECONNECT_INTERVAL_MS);
            }
        };

        ws.onerror = () => {
            // Will trigger onclose
            if (ws) ws.close();
        };
    } catch (e) {
        if (shouldBeActive) {
            setTimeout(connect, RECONNECT_INTERVAL_MS);
        }
    }
}

// ─── Listen for shutdown command from background.js ──────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.cmd === 'shutdown_ws') {
        shouldBeActive = false;
        if (ws) {
            ws.close();
            ws = null;
        }
        chrome.storage.local.set({ wsConnected: false });
        sendResponse({ ok: true });
    }
    return false;
});

// ─── Start ───────────────────────────────────────────────────────────────────
connect();
