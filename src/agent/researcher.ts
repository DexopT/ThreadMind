import { Provider, ProviderOptions, Tool, ToolContext } from '../core/types';
import { AgentLoop } from './loop';
import { ControlPlane } from './controlPlane';
import { webSearchFreeTool, webFetchFastTool } from '../tools/web_lightweight';

/**
 * Spawns a temporary sub-agent specifically designed to perform web research.
 * It uses the lightweight fetch tools, synthesizes the answer, and returns ONLY the result.
 * This protects the main agent's context window from raw HTML and search noise.
 */
export async function runDelegatedResearch(
    objective: string,
    provider: Provider,
    options: ProviderOptions,
    context: ToolContext
): Promise<string> {

    // Create an isolated control plane specifically for research.
    // It only has access to the fast, free web tools. No local fs access.
    const researchTools = [webSearchFreeTool, webFetchFastTool];

    // Give it a strict budget (5 tool calls max) to prevent infinite loops and save costs
    const researchControlPlane = new ControlPlane(researchTools, {
        maxToolCallsPerSession: 5,
        maxTokensPerSession: 15000
    });

    const loop = new AgentLoop(() => provider, researchControlPlane);

    // The strict system prompt forces the sub-agent to filter garbage
    const today = new Date().toISOString().split('T')[0]; // "2026-02-28"
    const systemPrompt = `You are a delegated Expert Web Researcher Sub-Agent.
Your objective is to satisfy the user's research request.
Today's date: ${today}. Use this to ensure search queries return current results.

AVAILABLE TOOLS:
1. web_search_free(query): Use this to find relevant links via DuckDuckGo.
2. web_fetch_fast(url): Use this to read the content of promising links.

CRITICAL INSTRUCTIONS:
- You must synthesize the information you find into a clear, concise, highly accurate report.
- DO NOT return raw HTML, random search results, or unformatted text.
- ONLY output the final synthesized answer. Do not output your thinking process.
- If the websites you read contain paywalls, garbage, or don't answer the objective, try another link.
- If you exhaust your tools and cannot find the answer, respond EXACTLY with:
  "I searched the web but couldn't find any valuable/reliable data regarding this objective. Sorry!"
`;

    const messages: any[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Your objective:\n${objective}` }
    ];

    try {
        await context.sendMessage?.(`🔎 **Sub-Agent:** Starting web research for: *${objective}*...`);
        const history = await loop.run(messages, context, { ...options, thinkingLevel: 'off' });

        // Return the final message content from the sub-agent
        const finalMessage = history[history.length - 1];
        if (!finalMessage || !finalMessage.content) {
            return "Research failed: Sub-agent produced no output.";
        }

        return `✅ **Research Findings:**\n${finalMessage.content}`;
    } catch (e: any) {
        console.error("[Researcher Sub-Agent Error]", e);
        return `❌ Research aborted: ${e.message}`;
    }
}
