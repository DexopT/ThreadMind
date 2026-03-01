import { GoogleGenerativeAI } from '@google/generative-ai';
import { Message, Provider, ProviderOptions, ProviderResponse, Tool } from '../core/types';
import { OAuthStore } from '../core/oauth-store';

/**
 * Gemini CLI provider — wraps Google Generative AI,
 * sourcing its API key dynamically from the OAuth credential store.
 * The OAuthStore handles projectId embedding into the key string.
 */
export class GeminiCliProvider implements Provider {
    public name = 'gemini-cli';

    async generateResponse(messages: Message[], tools?: Tool[], options?: ProviderOptions): Promise<ProviderResponse> {
        const store = OAuthStore.getInstance();
        const oauthKeyStr = await store.getApiKey('gemini-cli');

        let accessToken: string;
        let projectId: string | undefined;

        try {
            const parsed = JSON.parse(oauthKeyStr);
            accessToken = parsed.token;
            projectId = parsed.projectId;
        } catch (e) {
            // Fallback for non-JSON or legacy format
            accessToken = oauthKeyStr;
        }

        const client = new GoogleGenerativeAI(accessToken);


        const modelName = options?.thinkingLevel && options.thinkingLevel !== 'off'
            ? 'gemini-2.5-pro'
            : 'gemini-2.5-flash';

        const model = client.getGenerativeModel({ model: modelName });

        const systemInstruction = messages.find(m => m.role === 'system')?.content;
        const history: any[] = [];

        for (const m of messages.filter(m => m.role !== 'system')) {
            const role = m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user';
            const parts: any[] = [];

            if (m.role === 'tool') {
                parts.push({ functionResponse: { name: m.name!, response: { result: m.content } } });
            } else {
                if (m.content) parts.push({ text: m.content });
            }

            if (m.tool_calls) {
                for (const call of m.tool_calls) {
                    parts.push({ functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) } });
                }
            }
            history.push({ role, parts });
        }

        const formattedTools = tools?.map(t => ({
            name: t.name, description: t.description, parameters: t.parameters as any
        }));

        const toolConfig = formattedTools && formattedTools.length > 0 ? [{ functionDeclarations: formattedTools }] : undefined;

        const request: any = { contents: history };
        if (toolConfig) request.tools = toolConfig;
        if (systemInstruction) request.systemInstruction = { role: 'system', parts: [{ text: systemInstruction }] };

        const result = await model.generateContent(request);
        const response = result.response;

        const resMessage: Message = { role: 'assistant', content: response.text() };

        const functionCalls = response.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
            resMessage.tool_calls = functionCalls.map(fc => ({
                id: Math.random().toString(36).substring(7),
                type: 'function' as const,
                function: { name: fc.name, arguments: JSON.stringify(fc.args) }
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
