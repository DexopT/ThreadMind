// ─── ThreadMind Background Service Worker ────────────────────────────────────
// Orchestrates the extension: manages the offscreen document lifecycle,
// handles tab operations, and forwards DOM commands to content scripts.
// The WebSocket connection lives in the offscreen document (persistent).

// ─── Agent Tab State Management ──────────────────────────────────────────────
// Persist tab ID because Service Workers suspend after 30s of inactivity
async function getAgentTabId() {
    const data = await chrome.storage.local.get('agentTabId');
    return data.agentTabId || null;
}

async function setAgentTabId(id) {
    if (id === null) {
        await chrome.storage.local.remove('agentTabId');
    } else {
        await chrome.storage.local.set({ agentTabId: id });
    }
}

// ─── Offscreen Document Management ──────────────────────────────────────────

async function createOffscreen() {
    // Check if already exists
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length > 0) return; // Already running

    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WEB_RTC'], // Closest valid reason for persistent connections
        justification: 'Maintains WebSocket connection to ThreadMind agent server',
    });
    console.log('[ThreadMind] Offscreen document created (WS bridge active).');
}

async function destroyOffscreen() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length === 0) return;

    // Tell offscreen to cleanly close the WebSocket first
    try {
        await chrome.runtime.sendMessage({ cmd: 'shutdown_ws' });
    } catch { /* offscreen may already be gone */ }

    // Small delay to let the WS close cleanly
    await sleep(300);

    try {
        await chrome.offscreen.closeDocument();
    } catch { /* already closed */ }
    console.log('[ThreadMind] Offscreen document destroyed (WS bridge stopped).');
}

// ─── Message Handler ─────────────────────────────────────────────────────────
// Receives messages from popup.js (activate/deactivate) and offscreen.js (WS commands)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { cmd } = message;

    if (cmd === 'activate') {
        createOffscreen()
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ error: e.message }));
        return true; // async response
    }

    if (cmd === 'deactivate') {
        destroyOffscreen()
            .then(() => {
                chrome.storage.local.set({ bridgeActive: false, wsConnected: false });
                sendResponse({ ok: true });
            })
            .catch((e) => sendResponse({ error: e.message }));
        return true;
    }

    if (cmd === 'ws_command') {
        // Command from the agent server via offscreen.js
        handleCommand(message.payload)
            .then((response) => sendResponse(response))
            .catch((e) => sendResponse({ error: e.message }));
        return true;
    }

    return false;
});

// ─── Command Router ──────────────────────────────────────────────────────────

async function handleCommand(message) {
    const { type } = message;

    switch (type) {
        case 'navigate':
            return await handleNavigate(message);
        case 'close_tab':
            return await handleCloseTab();
        case 'evaluate':
            return await handleEvaluate(message);
        case 'dom_action':
        case 'get_page_text':
            return await forwardToContentScript(message);
        default:
            return { error: `Unknown command type: ${type}` };
    }
}

// ─── Tab Operations ──────────────────────────────────────────────────────────

async function handleNavigate(message) {
    const { url } = message;
    let tabId = await getAgentTabId();

    if (tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            // Check if we are already on this URL (ignoring hash)
            if (tab.url && tab.url.split('#')[0] === url.split('#')[0]) {
                await chrome.tabs.update(tabId, { active: true });
                return await forwardToContentScript({ type: 'get_page_text' });
            }
            await chrome.tabs.update(tabId, { url, active: true });
        } catch {
            const tab = await chrome.tabs.create({ url, active: true });
            tabId = tab.id;
            await setAgentTabId(tabId);
        }
    } else {
        const tab = await chrome.tabs.create({ url, active: true });
        tabId = tab.id;
        await setAgentTabId(tabId);
    }

    await waitForTabLoad(tabId);
    await sleep(1500);

    return await forwardToContentScript({ type: 'get_page_text' });
}

async function handleCloseTab() {
    let tabId = await getAgentTabId();
    if (tabId) {
        try { await chrome.tabs.remove(tabId); } catch { }
        await setAgentTabId(null);
    }
    return { status: 'success' };
}

// ─── Evaluate JS (CSP-safe via chrome.scripting) ─────────────────────────────

async function handleEvaluate(message) {
    let tabId = await getAgentTabId();
    if (!tabId) {
        throw new Error('No agent tab open. Use browser_open first.');
    }

    const { code } = message;

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN', // Run in page's main world, not isolated content script
            func: (codeStr) => {
                try {
                    return { result: eval(codeStr) };
                } catch (e) {
                    return { error: e.message };
                }
            },
            args: [code],
        });

        const res = results?.[0]?.result;
        if (res?.error) {
            return { error: res.error };
        }
        return { status: 'success', result: res?.result };
    } catch (e) {
        return { error: `Evaluation failed: ${e.message}` };
    }
}

// ─── Content Script Communication ────────────────────────────────────────────

async function forwardToContentScript(message) {
    let tabId = await getAgentTabId();
    if (!tabId) {
        throw new Error('No agent tab open. Use browser_open first.');
    }

    // Inject content script if needed
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
        });
    } catch { /* may already be injected */ }

    await sleep(200);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Content script timed out (15s).'));
        }, 15000);

        chrome.tabs.sendMessage(tabId, message, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response || { status: 'success' });
            }
        });
    });
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 20000);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timeout);
                resolve();
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Track agent tab removal
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const currentTabId = await getAgentTabId();
    if (tabId === currentTabId) {
        await setAgentTabId(null);
    }
});

// ─── Auto-restore on startup ─────────────────────────────────────────────────
// If the bridge was active before Chrome restarted, re-create the offscreen doc.

chrome.runtime.onStartup.addListener(async () => {
    const data = await chrome.storage.local.get(['bridgeActive']);
    if (data.bridgeActive) {
        await createOffscreen();
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    // Initialize storage with default state
    const data = await chrome.storage.local.get(['bridgeActive']);
    if (data.bridgeActive === undefined) {
        await chrome.storage.local.set({ bridgeActive: false, wsConnected: false });
    } else if (data.bridgeActive) {
        // Was active before update, re-activate
        await createOffscreen();
    }
});
