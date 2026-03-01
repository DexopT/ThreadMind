import { Tool } from '../core/types';
import { runDelegatedResearch } from '../agent/researcher';
import { providerManager } from '../providers';

/**
 * A meta-tool that delegates a complex web research task to a specialized sub-agent.
 * Protects the main agent's context window from raw HTML and search noise.
 */
export const delegateResearchTool: Tool = {
    name: 'delegate_research',
    description: 'Spawns a web researcher sub-agent for background information retrieval. Only use this when you do NOT have an active browser extension connection, or when the user wants background research without interactive browsing. If the browser extension is connected, prefer using browser_open/browser_click/browser_type instead.',
    parameters: {
        type: 'object',
        properties: {
            objective: {
                type: 'string',
                description: 'A highly detailed instruction of exactly what information you want the sub-agent to find (e.g. "Find the release notes for React 19 and list the top 3 new hooks")'
            }
        },
        required: ['objective']
    },
    execute: async (args, context) => {
        if (!args.objective) return "Missing objective parameter.";

        // Grab the currently active provider to power the sub-agent.
        // We could theoretically use a cheaper, faster model (like gemini-3-flash) for research,
        // but for now, we use the same active provider.
        const provider = providerManager.getActive();

        // Pass the context so the sub-agent can stream progress messages to the user if needed
        return await runDelegatedResearch(args.objective, provider, { thinkingLevel: 'off' }, context);
    }
};
