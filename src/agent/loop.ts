import { Message, Provider, ProviderOptions, ToolCall, ToolContext } from '../core/types';
import { ControlPlane } from './controlPlane';

/**
 * Universal tool-call text parser.
 * Different models emit tool calls as raw text in various formats when they don't
 * properly support OpenAI-style function calling. This parses ALL common patterns.
 */
function parseToolCallsFromText(text: string): { toolCalls: ToolCall[], cleanedText: string } | null {
    let toolCalls: ToolCall[] = [];
    let cleanedText = text;

    // ─── Pattern 1: Qwen XML-style ───
    // <function=tool_name><parameter=key>value</parameter></function>
    const xmlFnRegex = /<function=(\w+)>([\s\S]*?)<\/function>/g;
    const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let xmlMatch;
    while ((xmlMatch = xmlFnRegex.exec(text)) !== null) {
        const toolName = xmlMatch[1];
        const body = xmlMatch[2];
        const args: Record<string, string> = {};
        let pMatch;
        while ((pMatch = paramRegex.exec(body)) !== null) {
            args[pMatch[1]] = pMatch[2].trim();
        }
        toolCalls.push({
            id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: { name: toolName, arguments: JSON.stringify(args) }
        });
    }
    if (toolCalls.length > 0) {
        cleanedText = text
            .replace(/<function=[\s\S]*?<\/function>/g, '')
            .replace(/<\/?tool_call>/g, '')
            .trim();
        return { toolCalls, cleanedText };
    }

    // ─── Pattern 2: JSON inside <tool_call> tags (DeepSeek, GLM, some Qwen) ───
    const jsonTagRegex = /<\|?tool_call\|?>\s*([\s\S]*?)\s*<\|?\/?tool_call\|?>/g;
    let jsonTagMatch;
    while ((jsonTagMatch = jsonTagRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(jsonTagMatch[1].trim());
            const name = parsed.name || parsed.function?.name;
            const args = parsed.arguments || parsed.parameters || parsed.function?.arguments || {};
            if (name) {
                toolCalls.push({
                    id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    type: 'function',
                    function: {
                        name,
                        arguments: typeof args === 'string' ? args : JSON.stringify(args)
                    }
                });
            }
        } catch { /* not valid JSON, skip */ }
    }
    if (toolCalls.length > 0) {
        cleanedText = text
            .replace(/<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/g, '')
            .trim();
        return { toolCalls, cleanedText };
    }

    // ─── Pattern 3: Mistral-style ───
    const mistralRegex = /\[TOOL_CALLS\]\s*(\[[\s\S]*?\])/;
    const mistralMatch = mistralRegex.exec(text);
    if (mistralMatch) {
        try {
            const calls = JSON.parse(mistralMatch[1]);
            if (Array.isArray(calls)) {
                for (const call of calls) {
                    const name = call.name || call.function?.name;
                    const args = call.arguments || call.parameters || {};
                    if (name) {
                        toolCalls.push({
                            id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            type: 'function',
                            function: {
                                name,
                                arguments: typeof args === 'string' ? args : JSON.stringify(args)
                            }
                        });
                    }
                }
            }
        } catch { /* not valid JSON, skip */ }
    }
    if (toolCalls.length > 0) {
        cleanedText = text.replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\]/, '').trim();
        return { toolCalls, cleanedText };
    }

    return null;
}


export class AgentLoop {
    constructor(private providerFn: () => Provider, private controlPlane: ControlPlane) { }

    async run(
        messages: Message[],
        context: ToolContext,
        options?: ProviderOptions,
        maxIterations: number = 30,
        signal?: AbortSignal
    ): Promise<Message[]> {
        let batchIterations = 0;
        let totalIterations = 0;
        const HARD_CEILING = 90; // Absolute max to prevent runaway loops
        let currentMessages = [...messages];
        this.controlPlane.resetBudget(); // New session budget

        const allTools = this.controlPlane.getAvailableTools();
        let activeTools = allTools;

        // Check abort before starting
        if (signal?.aborted) {
            currentMessages.push({ role: 'assistant', content: '⛔ Request was cancelled.' });
            return currentMessages;
        }

        // Context Assembly Optimizer (Lazy Tool Loading)
        // Only run the router when there are many tools to justify the extra LLM call
        if (allTools.length > 12) {
            try {
                const toolSummaries = allTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
                const lastUserMessage = [...currentMessages].reverse().find((m: Message) => m.role === 'user')?.content || 'Analyze intent.';

                const assemblyPrompt: Message[] = [
                    { role: 'system', content: 'You are an orchestration router. Given the user query and the list of available tools, reply ONLY with a comma-separated list of EXACT tool names that might be required to solve the task. Do not include any other text. If no tools are needed, reply with "NONE".\n\n' + toolSummaries },
                    { role: 'user', content: lastUserMessage }
                ];

                // Fast, low-latency call
                const routerResponse = await this.providerFn().generateResponse(assemblyPrompt, [], { thinkingLevel: 'off' });
                const selectedNames = routerResponse.message.content.split(',').map(s => s.trim());

                if (!selectedNames.includes('NONE')) {
                    activeTools = allTools.filter(t => selectedNames.includes(t.name));
                    // Always ensure we have some fallback if router hallucinates names completely
                    if (activeTools.length === 0) activeTools = allTools.slice(0, 5);
                }
                // If router says NONE, keep activeTools = allTools so the model
                // can still see capabilities and answer questions about available tools
            } catch (e: any) {
                console.error("Context optimization failed, falling back to full tool injection:", e);
                activeTools = allTools;
            }
        }

        while (totalIterations < HARD_CEILING) {
            // Check abort before each LLM call
            if (signal?.aborted) {
                currentMessages.push({ role: 'assistant', content: '⛔ Generation stopped by user.' });
                return currentMessages;
            }

            // ─── Auto-continuation check ─────────────────────────────────
            // When batch limit is reached, ask the LLM to either finish or continue
            if (batchIterations >= maxIterations) {
                console.log(`[AgentLoop] Batch limit (${maxIterations}) reached at total ${totalIterations}. Prompting auto-continue...`);

                currentMessages.push({
                    role: 'system',
                    content: `You have used ${batchIterations} tool iterations. Your task may not be complete yet. ` +
                        `If your task IS complete, provide your final response to the user now WITHOUT calling any tools. ` +
                        `If your task is NOT complete, continue working by calling the necessary tools. Do NOT say "iteration limit reached" — just keep going.`
                });

                // Reset batch counter for the next batch
                batchIterations = 0;

                // Stream progress to user
                try {
                    await context.sendMessage?.(`⏳ Auto-continuing... (${totalIterations} steps so far)`);
                } catch { /* non-critical */ }
            }

            const response = await this.providerFn().generateResponse(currentMessages, activeTools, options);
            const assistantMessage = response.message;

            // Check if model emitted raw XML tool-call syntax as text (common with some models)
            if ((!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) && assistantMessage.content) {
                const parsed = parseToolCallsFromText(assistantMessage.content);
                if (parsed) {
                    console.log(`[AgentLoop] Detected ${parsed.toolCalls.length} text-style tool call(s), executing...`);
                    assistantMessage.tool_calls = parsed.toolCalls;
                    assistantMessage.content = parsed.cleanedText;
                }
            }

            currentMessages.push(assistantMessage);

            // If assistant has intermediate text content alongside tool calls, stream it to the user
            if (assistantMessage.content && assistantMessage.content.trim() && assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
                try {
                    await context.sendMessage?.(assistantMessage.content.trim());
                } catch (e) {
                    console.error('[AgentLoop] Failed to stream intermediate message:', e);
                }
            }

            if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                // Final response — LLM decided it's done
                return currentMessages;
            }

            // Execute via Control Plane
            for (let i = 0; i < assistantMessage.tool_calls.length; i++) {
                const toolCall = assistantMessage.tool_calls[i];

                // Check abort before each tool execution
                if (signal?.aborted) {
                    // Provide fake responses for all remaining tool calls to prevent history corruption
                    for (let j = i; j < assistantMessage.tool_calls.length; j++) {
                        const remainingCall = assistantMessage.tool_calls[j];
                        currentMessages.push({
                            role: 'tool',
                            content: '⛔ Execution aborted by user.',
                            name: remainingCall.function.name,
                            tool_call_id: remainingCall.id
                        });
                    }
                    currentMessages.push({ role: 'assistant', content: '⛔ Stopped during tool execution.' });
                    return currentMessages;
                }

                const resultStr = await this.controlPlane.executeTool(toolCall.function.name, toolCall.function.arguments, context);

                currentMessages.push({
                    role: 'tool',
                    content: resultStr,
                    name: toolCall.function.name,
                    tool_call_id: toolCall.id
                });
            }

            batchIterations++;
            totalIterations++;
        }

        // Hard ceiling reached — force a final response
        console.log(`[AgentLoop] Hard ceiling (${HARD_CEILING}) reached. Forcing final response.`);
        currentMessages.push({
            role: 'system',
            content: 'You have reached the absolute maximum number of tool iterations. Provide your final response NOW. Summarize what you accomplished and any remaining steps the user should take manually.'
        });

        const finalResponse = await this.providerFn().generateResponse(currentMessages, [], options);
        currentMessages.push(finalResponse.message);

        return currentMessages;
    }
}

