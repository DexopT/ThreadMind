import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { env } from '../core/env';

export class GoogleProvider implements Provider {
    public name = 'google';
    private client: GoogleGenerativeAI;

    constructor(apiKey?: string) {
        this.client = new GoogleGenerativeAI(apiKey || env.GOOGLE_API_KEY || '');
    }

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        let modelName = 'gemini-2.5-flash';

        if (options?.thinkingLevel && options.thinkingLevel !== 'off') {
            modelName = 'gemini-2.5-pro'; // Higher reasoning model mapped to thinking level
        }

        const model = this.client.getGenerativeModel({ model: modelName });

        const systemInstruction = messages.find(m => m.role === 'system')?.content;

        const history: any[] = [];
        for (const m of messages.filter(m => m.role !== 'system')) {
            const role = m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user';
            const parts: any[] = [];

            if (m.role === 'tool') {
                parts.push({
                    functionResponse: {
                        name: m.name!,
                        response: { result: m.content }
                    }
                });
            } else {
                if (m.content) parts.push({ text: m.content });
            }

            if (m.tool_calls) {
                for (const call of m.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: call.function.name,
                            args: JSON.parse(call.function.arguments)
                        }
                    });
                }
            }
            history.push({ role, parts });
        }

        // We do not pop the last message. We send the whole history to generateContent
        const formattedTools = tools?.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters as any
        }));

        let toolConfig = formattedTools && formattedTools.length > 0 ? [{ functionDeclarations: formattedTools }] : undefined;

        const request: any = {
            contents: history,
        };

        if (toolConfig) {
            request.tools = toolConfig;
        }

        if (systemInstruction) {
            request.systemInstruction = { role: 'system', parts: [{ text: systemInstruction }] };
        }

        const result = await model.generateContent(request);
        const response = result.response;

        const resMessage: Message = {
            role: 'assistant',
            content: response.text()
        };

        const functionCalls = response.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
            resMessage.tool_calls = functionCalls.map(fc => ({
                id: Math.random().toString(36).substring(7),
                type: 'function',
                function: {
                    name: fc.name,
                    arguments: JSON.stringify(fc.args)
                }
            }));
        }

        return {
            message: resMessage,
            usage: {
                promptTokens: response.usageMetadata?.promptTokenCount || 0,
                completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
                totalTokens: response.usageMetadata?.totalTokenCount || 0,
            }
        };
    }
}
