import { Tool } from '../core/types';
import { env } from '../core/env';

export const searchTool: Tool = {
    name: 'web_search',
    description: 'Searches the web via Google Search API (SerpApi) and returns top URLs and snippets.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
    },
    execute: async (args: Record<string, any>): Promise<string> => {
        try {
            const apiKey = env.SERPAPI_API_KEY;
            if (!apiKey || apiKey === 'your_serpapi_api_key_here') {
                return 'Web search API key not configured. Mocking search response... [Result: No live search available].';
            }

            const url = `https://serpapi.com/search.json?q=${encodeURIComponent(args.query)}&api_key=${apiKey}&engine=google`;
            const res = await fetch(url);

            if (!res.ok) throw new Error(`API returned ${res.status}`);

            const data: any = await res.json();
            if (!data.organic_results || data.organic_results.length === 0) {
                return 'No results found.';
            }

            const results = data.organic_results.slice(0, 5).map((page: any, i: number) => {
                return `${i + 1}. [${page.title}](${page.link})\n   ${page.snippet}`;
            });

            return results.join('\n\n');
        } catch (error: any) {
            return `Search failed: ${error.message}`;
        }
    }
};
