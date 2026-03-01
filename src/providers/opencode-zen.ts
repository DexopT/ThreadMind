import OpenAI from 'openai';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { OAuthStore } from '../core/oauth-store';
import { providerManager } from './index';
import { env } from '../core/env';

/**
 * OpenCode Zen provider — wraps OpenCode's Zen API (OpenAI-compatible).
 * Zen curates high-performance coding models including several FREE models.
 *
 * Base URL: https://opencode.ai/zen/v1
 * Model list: https://opencode.ai/zen/v1/models
 *
 * NOTE: The `opencode/<model-id>` format is for OpenCode CLI config only.
 *       The API `/chat/completions` endpoint expects bare model IDs
 *       (e.g. `glm-5-free`, NOT `opencode/glm-5-free`).
 */
export class OpenCodeZenProvider implements Provider {
    public name = 'opencode-zen';

    /**
     * 🆓 Free models — no cost, available to all users:
     *  - kimi-k2.5    — Kimi K2.5, on par with Opus 4.5, rate-limited
     *  - minimax-m2.5-free — MiniMax M2.5, fast for search/retrieval
     *  - glm-5-free        — GLM 5, decent general-purpose fallback
     *  - big-pickle         — Big Pickle (GLM 4.6), stealth model
     *
     * 💰 Paid models — pay-as-you-go:
     *  - claude-sonnet-4-20250514 — Claude Sonnet 4
     *  - claude-opus-4-5          — Claude Opus 4.5
     *  - claude-haiku-4-5         — Claude Haiku 4.5
     *  - gpt-5.1-codex            — GPT 5.1 Codex
     *  - gpt-5.1                  — GPT 5.1
     *  - gpt-5.2                  — GPT 5.2
     *  - gpt-5.2-codex            — GPT 5.2 Codex
     */
    static readonly FREE_MODELS = [
        'kimi-k2.5',
        'minimax-m2.5-free',
        'glm-5-free',
        'big-pickle',
    ];

    static readonly PAID_MODELS = [
        'claude-sonnet-4-20250514',
        'claude-opus-4-5',
        'claude-haiku-4-5',
        'gpt-5.1-codex',
        'gpt-5.1',
        'gpt-5.2',
        'gpt-5.2-codex',
    ];

    static readonly ALL_MODELS = [...OpenCodeZenProvider.FREE_MODELS, ...OpenCodeZenProvider.PAID_MODELS];

    /** Default model for normal chat — uses FREE Kimi K2.5 */
    static readonly DEFAULT_MODEL = 'kimi-k2.5';

    /** Default model for thinking/reasoning mode — uses FREE Big Pickle */
    static readonly REASONING_MODEL = 'big-pickle';

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        const store = OAuthStore.getInstance();
        const apiKey = await store.getApiKey('opencode-zen');

        const client = new OpenAI({
            apiKey,
            baseURL: env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
        });

        // Strip 'opencode/' prefix from modelOverride if user typed it that way
        let override = providerManager.modelOverride;
        if (override?.startsWith('opencode/')) {
            override = override.replace('opencode/', '');
        }

        // Use modelOverride if set, otherwise free defaults
        const model = override
            || (options?.thinkingLevel && options.thinkingLevel !== 'off'
                ? OpenCodeZenProvider.REASONING_MODEL
                : OpenCodeZenProvider.DEFAULT_MODEL);

        const formattedMessages = messages.map(m => {
            const out: any = { role: m.role, content: m.content || '' };
            if (m.name) out.name = m.name;
            if (m.tool_calls) out.tool_calls = m.tool_calls;
            if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
            return out;
        });

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
                messages: formattedMessages,
                ...(formattedTools ? { tools: formattedTools } : {})
            });
        } catch (error: any) {
            console.error(`[OpenCode Zen] Error calling model '${model}':`, error.message);
            if (error.status === 500) {
                throw new Error(`Upstream API Error (500) from OpenCode Zen for model '${model}'. The provider's server crashed, often because this specific model does not support the requested tools or features. Try a different model (e.g. /model opencode/kimi-k2.5). Raw error: ${error.message}`);
            }
            throw new Error(`OpenCode Zen connection failed for '${model}': ${error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error(
                `OpenCode Zen API returned no choices for model '${model}'. ` +
                `Possible causes: invalid API key, model unavailable, or rate limit. ` +
                `Run /auth opencode-zen to re-authenticate.`
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

    /** Fetch available models from the OpenCode Zen API (live) */
    static async listModels(apiKey: string): Promise<string[]> {
        try {
            const client = new OpenAI({
                apiKey,
                baseURL: env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
            });
            const models = await client.models.list();
            return models.data.map(m => m.id).sort();
        } catch {
            return OpenCodeZenProvider.ALL_MODELS;
        }
    }
}
