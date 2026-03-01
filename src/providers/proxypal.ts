import OpenAI from 'openai';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { providerManager } from './index';
import { env } from '../core/env';

/** Model metadata returned by ProxyPal /v1/models */
export interface ProxyPalModel {
    id: string;
    owned_by: string;
    created: number;
}

/**
 * ProxyPal provider — connects to a locally-running ProxyPal AI proxy gateway.
 *
 * ProxyPal aggregates multiple upstream providers (Antigravity, iFlow, Moonshot, Qwen)
 * behind a single OpenAI-compatible endpoint at http://127.0.0.1:8317/v1.
 *
 * All models are discovered dynamically via GET /v1/models — no hardcoded model list.
 * Auth: Bearer token with the proxy API key (default: "proxypal-local").
 */
export class ProxyPalProvider implements Provider {
    public name = 'proxypal';

    /** Cached model list — populated on first call to listModels() */
    private static cachedModels: ProxyPalModel[] | null = null;
    private static cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    /** Default model — set during first-run model selection, or fallback */
    static defaultModel = 'gemini-3-flash';

    /** Default thinking/reasoning model */
    static reasoningModel = 'claude-opus-4-6-thinking';

    private getClient(): OpenAI {
        return new OpenAI({
            apiKey: env.PROXYPAL_API_KEY || 'proxypal-local',
            baseURL: env.PROXYPAL_BASE_URL || 'http://127.0.0.1:8317/v1',
            timeout: 30000, // 30 second timeout to prevent deadlocks
        });
    }

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        const client = this.getClient();

        const override = providerManager.modelOverride;

        // Use modelOverride if set, otherwise pick default based on thinking level
        const model = override
            || (options?.thinkingLevel && options.thinkingLevel !== 'off'
                ? ProxyPalProvider.reasoningModel
                : ProxyPalProvider.defaultModel);

        // Normalize messages: Gemini strictly requires alternating roles.
        // We must merge consecutive messages of the same role (e.g., user -> user -> assist becomes user -> assist).
        // Tool results are mapped to the 'tool' role which openAI handles, but multiple tool results in a row
        // are okay for OpenAI. BUT Gemini through ProxyPal complains if user/model turns don't alternate.
        const normalizedMessages: any[] = [];
        for (const m of messages) {
            const out: any = { role: m.role, content: m.content || '' };
            if (m.name) out.name = m.name;
            if (m.tool_calls) out.tool_calls = m.tool_calls;
            if (m.tool_call_id) out.tool_call_id = m.tool_call_id;

            const last = normalizedMessages[normalizedMessages.length - 1];

            // Merge consecutive user messages
            if (last && last.role === 'user' && out.role === 'user') {
                last.content = (last.content + '\n\n' + out.content).trim();
                continue;
            }

            // Merge consecutive assistant messages (even if one has tool_calls)
            if (last && last.role === 'assistant' && out.role === 'assistant') {
                last.content = (last.content + '\n\n' + out.content).trim();
                if (out.tool_calls) {
                    // Combine tool calls if both have them (rare), otherwise just adopt them
                    last.tool_calls = last.tool_calls
                        ? [...last.tool_calls, ...out.tool_calls]
                        : out.tool_calls;
                }
                continue;
            }

            normalizedMessages.push(out);
        }

        const formattedTools = tools && tools.length > 0
            ? tools.map(t => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.parameters }
            }))
            : undefined;

        let response;
        try {
            response = await client.chat.completions.create({
                model,
                messages: normalizedMessages,
                ...(formattedTools ? { tools: formattedTools } : {})
            });
        } catch (error: any) {
            // Log full error for debugging but provide clean error to user
            console.error(`[ProxyPal] Error calling model '${model}':`, error);

            // Check if ProxyPal returned a structured error response
            if (error.status === 434 || error.response?.data?.msg) {
                const msg = error.response?.data?.msg || error.message;
                throw new Error(`ProxyPal upstream error for '${model}': ${msg}`);
            }
            throw new Error(`ProxyPal connection failed for '${model}': ${error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error(
                `ProxyPal rate-limit exhausted credentials for model '${model}'. ` +
                `The upstream API keys (e.g. Qwen/Claude/OpenAI) added to ProxyPal are likely cooling down. ` +
                `Please try another model using <code>/model</code>.`
            );
        }

        const choice = response.choices[0];
        const resMessage: Message = { role: 'assistant', content: choice.message.content || '' };

        if (choice.message.tool_calls) {
            resMessage.tool_calls = choice.message.tool_calls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: (tc as any).function.name, arguments: (tc as any).function.arguments }
            }));
        }

        return {
            message: resMessage,
            usage: {
                promptTokens: response.usage?.prompt_tokens || 0,
                completionTokens: response.usage?.completion_tokens || 0,
                totalTokens: response.usage?.total_tokens || 0,
            }
        };
    }

    /**
     * Check if ProxyPal is reachable (ping /v1/models with a short timeout).
     * Returns true if the proxy is running and responding.
     */
    static async isAvailable(): Promise<boolean> {
        try {
            const client = new OpenAI({
                apiKey: env.PROXYPAL_API_KEY || 'proxypal-local',
                baseURL: env.PROXYPAL_BASE_URL || 'http://127.0.0.1:8317/v1',
                timeout: 3000, // 3-second timeout for health check
            });
            const models = await client.models.list();
            return models.data.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Fetch all available models from ProxyPal /v1/models.
     * Results are cached for 5 minutes to avoid hammering the local proxy.
     */
    static async listModels(): Promise<ProxyPalModel[]> {
        const now = Date.now();
        if (ProxyPalProvider.cachedModels && (now - ProxyPalProvider.cacheTimestamp) < ProxyPalProvider.CACHE_TTL_MS) {
            return ProxyPalProvider.cachedModels;
        }

        try {
            const client = new OpenAI({
                apiKey: env.PROXYPAL_API_KEY || 'proxypal-local',
                baseURL: env.PROXYPAL_BASE_URL || 'http://127.0.0.1:8317/v1',
                timeout: 5000,
            });
            const models = await client.models.list();
            const result: ProxyPalModel[] = models.data.map(m => ({
                id: m.id,
                owned_by: m.owned_by,
                created: m.created,
            }));

            // Sort by owned_by, then by id
            result.sort((a, b) => a.owned_by.localeCompare(b.owned_by) || a.id.localeCompare(b.id));

            ProxyPalProvider.cachedModels = result;
            ProxyPalProvider.cacheTimestamp = now;
            return result;
        } catch (e) {
            console.error('[ProxyPal] Failed to fetch models:', e);
            return ProxyPalProvider.cachedModels || [];
        }
    }

    /**
     * Get model IDs only (convenience wrapper).
     */
    static async listModelIds(): Promise<string[]> {
        const models = await ProxyPalProvider.listModels();
        return models.map(m => m.id);
    }

    /**
     * Get models grouped by their upstream provider (owned_by field).
     */
    static async listModelsByProvider(): Promise<Record<string, string[]>> {
        const models = await ProxyPalProvider.listModels();
        const grouped: Record<string, string[]> = {};
        for (const m of models) {
            if (!grouped[m.owned_by]) grouped[m.owned_by] = [];
            grouped[m.owned_by].push(m.id);
        }
        return grouped;
    }

    /** Invalidate the model cache (e.g. after ProxyPal restarts). */
    static invalidateCache(): void {
        ProxyPalProvider.cachedModels = null;
        ProxyPalProvider.cacheTimestamp = 0;
    }

    /**
     * Build a formatted report of all available ProxyPal models for display.
     */
    static async getModelReport(): Promise<string> {
        const grouped = await ProxyPalProvider.listModelsByProvider();
        const lines: string[] = ['*ProxyPal Models*\n'];

        // Filter out internal/tab models
        const HIDDEN_PREFIXES = ['tab_'];

        for (const [provider, models] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
            const visibleModels = models.filter(m => !HIDDEN_PREFIXES.some(p => m.startsWith(p)));
            if (visibleModels.length === 0) continue;

            const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
            lines.push(`  *${providerLabel}:*`);
            for (const model of visibleModels.sort()) {
                const isDefault = model === ProxyPalProvider.defaultModel;
                const isReasoning = model === ProxyPalProvider.reasoningModel;
                const tag = isDefault ? ' (default)' : isReasoning ? ' (reasoning)' : '';
                lines.push(`    \`${model}\`${tag}`);
            }
        }

        return lines.join('\n');
    }
}
