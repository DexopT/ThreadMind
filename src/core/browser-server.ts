import { WebSocketServer, WebSocket } from 'ws';

// ─── Browser Extension WebSocket Server ──────────────────────────────────────
// Binds to 127.0.0.1:9090 — only the local browser extension connects here.
// The agent sends JSON commands; the extension executes them and replies.

const WS_PORT = 9090;
const WS_HOST = '127.0.0.1';

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
let pendingRequests: Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timer: NodeJS.Timeout }> = new Map();
let requestIdCounter = 0;

const COMMAND_TIMEOUT_MS = 30_000; // 30s per command

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns true if a browser extension is currently connected */
export function isExtensionConnected(): boolean {
    return extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;
}

/**
 * Send a command to the connected browser extension and wait for a response.
 * Commands are JSON payloads like { type: "navigate", url: "..." }
 * Each command is tagged with a unique `requestId` so responses can be correlated.
 */
export function sendCommand<T = any>(payload: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
        if (!isExtensionConnected()) {
            reject(new Error('No browser extension connected. Please open your browser with the ThreadMind extension installed.'));
            return;
        }

        const requestId = `req_${++requestIdCounter}_${Date.now()}`;
        const message = JSON.stringify({ ...payload, requestId });

        const timer = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Browser command timed out after ${COMMAND_TIMEOUT_MS / 1000}s: ${payload.type}`));
        }, COMMAND_TIMEOUT_MS);

        pendingRequests.set(requestId, { resolve, reject, timer });
        extensionSocket!.send(message);
    });
}

// ─── Server Lifecycle ────────────────────────────────────────────────────────

export function startBrowserServer(): void {
    if (wss) return; // Already running

    wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT });

    wss.on('listening', () => {
        console.log(`[BrowserServer] WebSocket server listening on ${WS_HOST}:${WS_PORT}`);
    });

    wss.on('connection', (ws: WebSocket) => {
        // Only allow one extension connection at a time
        if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
            console.warn('[BrowserServer] Replacing existing extension connection.');
            extensionSocket.close();
        }

        extensionSocket = ws;
        console.log('[BrowserServer] ✅ Extension connected. Browser tools ready.');

        ws.on('message', (data: Buffer) => {
            try {
                const response = JSON.parse(data.toString());
                const { requestId } = response;

                if (requestId && pendingRequests.has(requestId)) {
                    const pending = pendingRequests.get(requestId)!;
                    clearTimeout(pending.timer);
                    pendingRequests.delete(requestId);

                    if (response.error) {
                        pending.reject(new Error(response.error));
                    } else {
                        pending.resolve(response);
                    }
                }
            } catch (e: any) {
                console.warn(`[BrowserServer] Invalid message from extension: ${e.message}`);
            }
        });

        ws.on('close', () => {
            console.log('[BrowserServer] Extension disconnected.');
            if (extensionSocket === ws) {
                extensionSocket = null;
            }
            // Reject all pending requests
            for (const [id, pending] of pendingRequests) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Extension disconnected'));
            }
            pendingRequests.clear();
        });

        ws.on('error', (err) => {
            console.error(`[BrowserServer] WebSocket error: ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        console.error(`[BrowserServer] Server error: ${err.message}`);
    });
}

export function stopBrowserServer(): void {
    if (wss) {
        // Close the extension connection
        if (extensionSocket) {
            extensionSocket.close();
            extensionSocket = null;
        }
        // Reject pending requests
        for (const [id, pending] of pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Server shutting down'));
        }
        pendingRequests.clear();

        wss.close();
        wss = null;
        console.log('[BrowserServer] Server stopped.');
    }
}

// Auto-start when imported
startBrowserServer();
