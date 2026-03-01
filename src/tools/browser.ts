import { Tool, ToolContext } from '../core/types';
import { isExtensionConnected, sendCommand } from '../core/browser-server';

// ─── Browser Tools (Extension-Based) ─────────────────────────────────────────
// All tools communicate with the user's browser via a WebSocket-connected
// browser extension. No Puppeteer, no headless Chromium, zero bot detection.

export const guiBrowserTools: Tool[] = [
    {
        name: 'browser_open',
        description: 'Opens a URL in the user\'s browser via the ThreadMind extension. Returns a text summary of the page content. The extension must be installed and active.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to navigate to' }
            },
            required: ['url']
        },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected. Please open your browser with the ThreadMind extension installed, then try again.';
                }
                const result = await sendCommand<{ status: string; pageText?: string; title?: string; url?: string }>({
                    type: 'navigate',
                    url: args.url,
                });
                return `Page: ${result.title || '(no title)'}\nURL: ${result.url || args.url}\n\n${result.pageText || '(empty page)'}`;
            } catch (e: any) {
                return `Error opening ${args.url}: ${e.message}`;
            }
        }
    },
    {
        name: 'browser_observe',
        description: 'Re-reads the current page state from the browser. Returns a text summary of visible content, headings, links, and interactive elements.',
        parameters: { type: 'object', properties: {} },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected.';
                }
                const result = await sendCommand<{ status: string; pageText?: string; title?: string; url?: string }>({
                    type: 'get_page_text',
                });
                return `Page: ${result.title || '(no title)'}\nURL: ${result.url || ''}\n\n${result.pageText || '(empty page)'}`;
            } catch (e: any) {
                return `Error observing page: ${e.message}`;
            }
        }
    },
    {
        name: 'browser_status',
        description: 'Returns the URL and Title of the currently active tab without reading the full page content. Extremely fast and saves context space.',
        parameters: { type: 'object', properties: {} },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected.';
                }
                const result = await sendCommand<{ status: string; result?: any }>({
                    type: 'evaluate',
                    code: 'JSON.stringify({ url: window.location.href, title: document.title })',
                });
                if (result.result) {
                    try {
                        const parsed = JSON.parse(result.result);
                        return `Current Tab:\nTitle: ${parsed.title}\nURL: ${parsed.url}`;
                    } catch {
                        return `Current Tab State: ${result.result}`;
                    }
                }
                return 'Could not retrieve tab status.';
            } catch (e: any) {
                return `Error getting status: ${e.message}`;
            }
        }
    },
    {
        name: 'browser_click',
        description: 'Clicks an element on the page by CSS selector. Returns success status, and optionally the updated page text.',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the element to click (e.g. "#submit", "a.nav-link")' },
                return_page_text: { type: 'boolean', description: 'If true, returns the full page text after the action. Default: false. Use true ONLY if you need to read the immediate new response.' }
            },
            required: ['selector']
        },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected.';
                }
                const result = await sendCommand<{ status: string; pageText?: string; title?: string; url?: string }>({
                    type: 'dom_action',
                    action: 'click',
                    selector: args.selector,
                });
                return `Clicked "${args.selector}"\n\nPage: ${result.title || '(no title)'}\nURL: ${result.url || ''}${args.return_page_text ? `\n\n${result.pageText || '(empty page)'}` : ''}`;
            } catch (e: any) {
                return `Error clicking "${args.selector}": ${e.message}`;
            }
        }
    },
    {
        name: 'browser_type',
        description: 'Types text into an input field identified by CSS selector.',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector of the input field' },
                text: { type: 'string', description: 'Text to type into the field' },
                submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
                return_page_text: { type: 'boolean', description: 'If true, returns the full page text after the action. Default: false.' }
            },
            required: ['selector', 'text']
        },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected.';
                }
                const result = await sendCommand<{ status: string; pageText?: string; title?: string; url?: string }>({
                    type: 'dom_action',
                    action: 'type',
                    selector: args.selector,
                    text: args.text,
                    submit: !!args.submit,
                });
                return `Typed into "${args.selector}"${args.submit ? ' (submitted)' : ''}\n\nPage: ${result.title || '(no title)'}\nURL: ${result.url || ''}${args.return_page_text ? `\n\n${result.pageText || '(empty page)'}` : ''}`;
            } catch (e: any) {
                return `Error typing into "${args.selector}": ${e.message}`;
            }
        }
    },
    {
        name: 'browser_scroll',
        description: 'Scrolls the page up or down.',
        parameters: {
            type: 'object',
            properties: {
                direction: { type: 'string', description: '"up" or "down"' },
                amount: { type: 'number', description: 'Pixels to scroll (default: 500)' },
                return_page_text: { type: 'boolean', description: 'If true, returns the full page text after scrolling. Default: false.' }
            },
            required: ['direction']
        },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected.';
                }
                const result = await sendCommand<{ status: string; pageText?: string; title?: string; url?: string }>({
                    type: 'dom_action',
                    action: 'scroll',
                    direction: args.direction,
                    amount: args.amount || 500,
                });
                return `Scrolled ${args.direction}\n\nPage: ${result.title || '(no title)'}\nURL: ${result.url || ''}${args.return_page_text ? `\n\n${result.pageText || '(empty page)'}` : ''}`;
            } catch (e: any) {
                return `Error scrolling: ${e.message}`;
            }
        }
    },
    {
        name: 'browser_evaluate',
        description: 'Executes JavaScript code in the browser page context and returns the result.',
        parameters: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'JavaScript code to execute in the page' }
            },
            required: ['code']
        },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return '❌ No browser extension connected.';
                }
                const result = await sendCommand<{ status: string; result?: any }>({
                    type: 'evaluate',
                    code: args.code,
                });
                const output = typeof result.result === 'object'
                    ? JSON.stringify(result.result, null, 2)
                    : String(result.result ?? '(undefined)');
                return output.substring(0, 5000);
            } catch (e: any) {
                return `JS evaluation error: ${e.message}`;
            }
        }
    },
    {
        name: 'browser_close',
        description: 'Closes the current agent tab in the browser.',
        parameters: { type: 'object', properties: {} },
        execute: async (args, context): Promise<string> => {
            try {
                if (!isExtensionConnected()) {
                    return 'No browser extension connected (nothing to close).';
                }
                await sendCommand({ type: 'close_tab' });
                return 'Browser tab closed.';
            } catch (e: any) {
                return `Error closing tab: ${e.message}`;
            }
        }
    }
];
