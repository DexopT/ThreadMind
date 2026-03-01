import * as cheerio from 'cheerio';
import { Tool } from '../core/types';

/**
 * Perform a Google search via DuckDuckGo HTML version.
 * This does not require an API key and parses the HTML response.
 */
async function searchDuckDuckGo(query: string): Promise<string> {
    try {
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        });

        if (!response.ok) {
            throw new Error(`DuckDuckGo responded with status ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const results: string[] = [];

        $('.result').each((i, el) => {
            if (i >= 8) return false; // Top 8 results
            
            const title = $(el).find('.result__title').text().trim();
            const snippet = $(el).find('.result__snippet').text().trim();
            const url = $(el).find('.result__url').text().trim();
            
            // Clean up DuckDuckGo's tracking URL format if needed
            let cleanUrl = url;
            if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
            
            if (title && cleanUrl) {
                results.push(`[${i + 1}] ${title}\nURL: ${cleanUrl}\nSnippet: ${snippet}`);
            }
        });

        if (results.length === 0) {
            return "No search results found.";
        }

        return results.join('\n\n');
    } catch (e: any) {
        return `Search failed: ${e.message}`;
    }
}

/**
 * Fetch raw HTML from a URL and extract clean text using Cheerio.
 * Automatically removes scripts, styles, navs, and footers.
 */
async function fetchPageText(url: string): Promise<string> {
    try {
        // Basic validation
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            signal: AbortSignal.timeout(10000) // 10s timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status} ${response.statusText}`);
        }

        // Check content type to ensure it's HTML or text
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/') && !contentType.includes('application/xhtml')) {
            return `Error: URL points to a non-text file type (${contentType}).`;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Remove noise tags
        $('script, style, noscript, iframe, nav, footer, header, aside, .sidebar, .ads, .menu, svg').remove();

        // Target the main content areas if they exist, otherwise fallback to body
        let contentContainer = $('main, article, [role="main"], #main-content, .post-content').first();
        if (contentContainer.length === 0) {
            contentContainer = $('body');
        }

        // Extract text and clean up whitespace
        let text = contentContainer.text();
        
        // Replace multiple newlines with double newline, multiple spaces with single space
        text = text.replace(/\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

        if (!text) {
            return "Error: Page loaded but no readable text was found.";
        }

        // Truncate to save context window (approx 15,000 chars ~ 3500 tokens)
        const MAX_CHARS = 15000;
        let finalOutput = `Title: ${$('title').text().trim()}\n\nContent:\n${text}`;

        if (finalOutput.length > MAX_CHARS) {
            finalOutput = finalOutput.substring(0, MAX_CHARS) + "\n...[Content Truncated due to length]";
        }

        return finalOutput;
    } catch (e: any) {
        return `Fetch failed: ${e.message}`;
    }
}

export const webSearchFreeTool: Tool = {
    name: 'web_search_free',
    description: 'Search the web using DuckDuckGo. Returns top 8 organic results with snippets. Very fast.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
    },
    execute: async (args) => {
        return await searchDuckDuckGo(args.query);
    }
};

export const webFetchFastTool: Tool = {
    name: 'web_fetch_fast',
    description: 'Fetch a webpage and extract clean, readable text. Strips ads, menus, and scripts. Fast but does not render Javascript.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'The absolute URL to fetch' }
        },
        required: ['url']
    },
    execute: async (args) => {
        return await fetchPageText(args.url);
    }
};
