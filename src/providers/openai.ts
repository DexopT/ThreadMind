import OpenAI from 'openai';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { env } from '../core/env';

export class OpenAIProvider implements Provider {
    public name = 'openai';
    private client: OpenAI;

    constructor(apiKey?: string) {
        this.client = new OpenAI({
            apiKey: apiKey || env.OPENAI_API_KEY,
        });
    }

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        let model = 'gpt-4o'; // Default

        if (options?.thinkingLevel && options.thinkingLevel !== 'off') {
            model = 'o3-mini'; // Basic thinking model map
        }

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
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }))
            : undefined;

        const response = await this.client.chat.completions.create({
            model,
            messages: formattedMessages,
            ...(formattedTools ? { tools: formattedTools } : {}),
            reasoning_effort: (model === 'o3-mini' && options?.thinkingLevel) ?
                (options.thinkingLevel === 'high' ? 'high' : options.thinkingLevel === 'medium' ? 'medium' : 'low')
                : undefined
        });

        const choice = response.choices[0];
        const resMessage: Message = {
            role: 'assistant',
            content: choice.message.content || ''
        };

        if (choice.message.tool_calls) {
            resMessage.tool_calls = choice.message.tool_calls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                    name: (tc as any).function.name,
                    arguments: (tc as any).function.arguments
                }
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
