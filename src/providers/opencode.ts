import OpenAI from 'openai';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { OAuthStore } from '../core/oauth-store';
import { providerManager } from './index';
import { env } from '../core/env';

/**
 * OpenCode (generic) provider — same catalog as Zen, uses free models by default.
 * API expects bare model names (no opencode/ prefix).
 */
export class OpenCodeProvider implements Provider {
    public name = 'opencode';

    static readonly FREE_MODELS = [
        'kimi-k2.5',
        'minimax-m2.5-free',
        'glm-5-free',
        'big-pickle',
    ];

    static readonly PAID_MODELS = [
        'claude-sonnet-4-20250514',
        'claude-opus-4-5',
        'gpt-5.1-codex',
        'gpt-5.2',
    ];

    static readonly DEFAULT_MODEL = 'kimi-k2.5';
    static readonly REASONING_MODEL = 'big-pickle';

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        const store = OAuthStore.getInstance();
        const apiKey = await store.getApiKey('opencode');

        const client = new OpenAI({
            apiKey,
            baseURL: env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1',
        });

        let override = providerManager.modelOverride;
        if (override?.startsWith('opencode/')) {
            override = override.replace('opencode/', '');
        }

        const model = override
            || (options?.thinkingLevel && options.thinkingLevel !== 'off'
                ? OpenCodeProvider.REASONING_MODEL
                : OpenCodeProvider.DEFAULT_MODEL);

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

        const response = await client.chat.completions.create({
            model,
            messages: formattedMessages,
            ...(formattedTools ? { tools: formattedTools } : {})
        });

        if (!response.choices || response.choices.length === 0) {
            throw new Error(
                `OpenCode API returned no choices for model '${model}'. ` +
                `Possible causes: invalid API key, model unavailable, or rate limit. ` +
                `Run /auth opencode to re-authenticate.`
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
}
