import Anthropic from '@anthropic-ai/sdk';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { env } from '../core/env';

export class AnthropicProvider implements Provider {
    public name = 'anthropic';
    private client: Anthropic;

    constructor(apiKey?: string) {
        this.client = new Anthropic({
            apiKey: apiKey || env.ANTHROPIC_API_KEY,
        });
    }

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        let model = 'claude-3-5-sonnet-20241022';
        let max_tokens = 4096;
        let thinking: null | { type: 'enabled', budget_tokens: number } = null;

        if (options?.thinkingLevel && options.thinkingLevel !== 'off') {
            model = 'claude-3-7-sonnet-20250219';
            thinking = {
                type: 'enabled',
                budget_tokens: options.thinkingLevel === 'high' ? 8000 : options.thinkingLevel === 'medium' ? 4000 : 2000
            };
            max_tokens = 16000; // Need higher max_tokens for extended thinking
        }

        const systemMessage = messages.find(m => m.role === 'system')?.content || '';
        const userAndAssistantMessages = messages.filter(m => m.role !== 'system').map(m => {
            if (m.role === 'user') return { role: 'user' as const, content: m.content };
            if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content };
            // Simple mapping - ideally we'd map tool responses properly here but keeping it short
            return { role: 'user' as const, content: `[Tool Result] ${m.content}` };
        });

        const formattedTools = tools?.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: {
                type: 'object' as const,
                properties: t.parameters?.properties || {},
                required: t.parameters?.required || []
            }
        }));

        const createParams: any = {
            model,
            max_tokens,
            messages: userAndAssistantMessages,
            system: systemMessage,
        };

        if (thinking) {
            createParams.thinking = thinking;
        }

        if (formattedTools && formattedTools.length > 0) {
            createParams.tools = formattedTools;
        }

        const response = await this.client.messages.create(createParams);

        const resMessage: Message = {
            role: 'assistant',
            content: response.content
                .filter(b => b.type === 'text')
                .map(b => (b as any).text)
                .join('\n')
        };

        const toolBlocks = response.content.filter(b => b.type === 'tool_use');
        if (toolBlocks.length > 0) {
            resMessage.tool_calls = toolBlocks.map((b: any) => ({
                id: b.id,
                type: 'function',
                function: {
                    name: b.name,
                    arguments: JSON.stringify(b.input)
                }
            }));
        }

        return {
            message: resMessage,
            usage: {
                promptTokens: response.usage.input_tokens || 0,
                completionTokens: response.usage.output_tokens || 0,
                totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
            }
        };
    }
}
