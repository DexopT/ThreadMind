// ─── ThreadMind Content Script ───────────────────────────────────────────────
// Injected into every page. Receives commands from background.js and executes
// DOM actions natively. Returns results back to the background service worker.
// Designed for compatibility with modern SPAs (React, Next.js, etc.)

const MAX_TEXT_LENGTH = 8000;

// Prevent duplicate listener registration when script is re-injected
if (!window.__threadmind_content_loaded) {
    window.__threadmind_content_loaded = true;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handleMessage(message)
            .then(sendResponse)
            .catch((err) => sendResponse({ error: err.message || 'Content script error' }));
        return true; // async response
    });
}

async function handleMessage(message) {
    const { type, action } = message;

    if (type === 'get_page_text') {
        return getPageText();
    }

    // evaluate is handled by background.js via chrome.scripting (CSP-safe)
    // but keep a fallback here
    if (type === 'evaluate') {
        return { error: 'Evaluate commands are handled by the background script.' };
    }

    if (type === 'dom_action') {
        switch (action) {
            case 'click':
                return await handleClick(message.selector);
            case 'type':
                return await handleType(message.selector, message.text, message.submit);
            case 'scroll':
                return await handleScroll(message.direction, message.amount);
            default:
                return { error: `Unknown DOM action: ${action}` };
        }
    }

    return { error: `Unknown message type: ${type}` };
}

// ─── DOM Actions ─────────────────────────────────────────────────────────────

async function handleClick(selector) {
    const el = document.querySelector(selector);
    if (!el) {
        return { error: `Element not found: ${selector}` };
    }

    // Scroll into view first
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(100);

    // Simulate full native mouse event sequence
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

    el.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
    el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
    el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    el.dispatchEvent(new MouseEvent('click', eventOpts));

    // Also try native click for good measure
    if (typeof el.click === 'function') el.click();

    // Wait for navigation/render
    await sleep(2000);

    return getPageText();
}

async function handleType(selector, text, submit) {
    const el = document.querySelector(selector);
    if (!el) {
        return { error: `Element not found: ${selector}` };
    }

    // Focus the element
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(100);
    el.focus();
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await sleep(100);

    // ─── Strategy 1: contenteditable elements (chat boxes, rich editors) ──
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        // Clear existing content
        el.textContent = '';
        el.innerHTML = '';

        // Use execCommand for contenteditable (works with React/Draft.js/ProseMirror)
        document.execCommand('insertText', false, text);

        // Also dispatch input event
        el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text,
        }));
    }
    // ─── Strategy 2: Regular input/textarea ──────────────────────────────
    else {
        // Clear field using select-all + delete (triggers React change detection)
        el.select?.();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);

        // Type using execCommand (triggers React's onChange properly)
        document.execCommand('insertText', false, text);

        // Fallback: if execCommand didn't work, set value directly + dispatch events
        if (el.value !== text) {
            // Use native setter to bypass React's synthetic property
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            )?.set || Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            )?.set;

            if (nativeSetter) {
                nativeSetter.call(el, text);
            } else {
                el.value = text;
            }

            // Fire React-compatible events
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    await sleep(300);

    // ─── Submit logic ────────────────────────────────────────────────────
    if (submit) {
        await sleep(500);

        // Try pressing Enter (works on most chat UIs)
        const enterOpts = {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
        };
        el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

        // Also try finding and clicking a submit button
        const submitBtn = document.querySelector(
            'button[type="submit"], button[data-testid="send"], button[aria-label="Send"], ' +
            'button[aria-label*="send" i], button[aria-label*="submit" i], ' +
            'form button:last-of-type'
        );
        if (submitBtn && !submitBtn.disabled) {
            await sleep(200);
            submitBtn.click();
        }

        // Wait for response to render
        await sleep(3000);
    }

    return getPageText();
}

async function handleScroll(direction, amount) {
    const px = amount || 500;
    const delta = direction === 'up' ? -px : px;
    window.scrollBy({ top: delta, behavior: 'smooth' });

    await sleep(500);
    return getPageText();
}

// ─── Page Text Extraction (SPA-compatible) ───────────────────────────────────

function getPageText() {
    const STRIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'IFRAME', 'PATH',
        'META', 'LINK', 'BR', 'HR', 'IMG',
    ]);
    const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
    const HEADING = new Set(['H1', 'H2', 'H3', 'H4', 'H5']);
    const TEXT_BLOCK = new Set(['P', 'LI', 'TD', 'TH', 'LABEL', 'BLOCKQUOTE', 'PRE', 'CODE']);

    const lines = [];
    const seenText = new Set(); // Deduplicate text

    function walk(node, depth) {
        if (!node || node.nodeType !== 1) return;
        if (STRIP_TAGS.has(node.tagName)) return;

        // Skip hidden elements
        try {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            if (style.opacity === '0' && !INTERACTIVE.has(node.tagName)) return;
        } catch { /* skip */ }

        const tag = node.tagName;
        const indent = '  '.repeat(Math.min(depth, 4));

        // Also check contenteditable elements (chat inputs)
        if (node.isContentEditable && node.getAttribute('role') !== 'presentation') {
            const text = (node.textContent || '').trim();
            lines.push(`${indent}[editable] "${text.substring(0, 80)}" selector="${cssSelector(node)}"`);
        }

        if (INTERACTIVE.has(tag)) {
            const role = node.getAttribute('role') || tag.toLowerCase();
            const name =
                node.getAttribute('aria-label') ||
                node.getAttribute('placeholder') ||
                node.getAttribute('title') ||
                (node.textContent || '').trim().substring(0, 80) ||
                '';
            const type = node.type || '';
            const value = node.value || '';
            const href = node.href || '';
            const disabled = node.disabled ? ' (disabled)' : '';

            let desc = `${indent}[${role}] "${name}"`;
            if (type) desc += ` type=${type}`;
            if (value) desc += ` value="${value.substring(0, 50)}"`;
            if (href && tag === 'A') desc += ` → ${href.substring(0, 100)}`;
            desc += disabled;
            desc += ` selector="${cssSelector(node)}"`;
            lines.push(desc);
        } else if (HEADING.has(tag)) {
            const text = (node.textContent || '').trim();
            if (text && !seenText.has(text)) {
                seenText.add(text);
                lines.push(`${indent}[${tag.toLowerCase()}] ${text.substring(0, 120)}`);
            }
        } else if (TEXT_BLOCK.has(tag)) {
            const text = (node.textContent || '').trim();
            if (text && text.length > 2 && !seenText.has(text.substring(0, 100))) {
                seenText.add(text.substring(0, 100));
                lines.push(`${indent}${text.substring(0, 200)}`);
            }
        } else if (node.getAttribute('role') === 'article' || node.getAttribute('role') === 'main') {
            // Mark important sections
            lines.push(`${indent}--- [${node.getAttribute('role')}] ---`);
        }

        for (const child of node.children) {
            walk(child, depth + 1);
        }
    }

    walk(document.body, 0);

    let pageText = lines.join('\n');
    if (pageText.length > MAX_TEXT_LENGTH) {
        pageText = pageText.substring(0, MAX_TEXT_LENGTH) + '\n... (truncated)';
    }

    return {
        status: 'success',
        title: document.title,
        url: window.location.href,
        pageText: pageText || '(page has no extractable text content)',
    };
}

// ─── CSS Selector Generator ─────────────────────────────────────────────────
// Generates a unique CSS selector for an element so the agent can target it.

function cssSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    // Try data-testid first (common in React apps)
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    // Try aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

    // Try name attribute for inputs
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

    // Fallback: tag + nth-of-type
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();

    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length === 1) {
        const parentSel = cssSelector(parent);
        return `${parentSel} > ${el.tagName.toLowerCase()}`;
    }

    const index = siblings.indexOf(el) + 1;
    const parentSel = cssSelector(parent);
    return `${parentSel} > ${el.tagName.toLowerCase()}:nth-of-type(${index})`;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
