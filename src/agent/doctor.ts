import { Message } from '../core/types';

export class DoctorAgent {
    public analyze(sessionMsgs: Message[]): { isStuck: boolean; recoveryPrompt?: string } {
        if (sessionMsgs.length < 5) return { isStuck: false };

        // Analyze the recent context window
        const recentMsgs = sessionMsgs.slice(-8);
        const toolErrors = recentMsgs.filter(m => m.role === 'tool' && m.content.toLowerCase().includes('error'));
        const toolCalls = recentMsgs.filter(m => m.role === 'assistant' && (m.tool_calls?.length || 0) > 0);

        // Heuristic 1: High frequency of tool errors (Bug Loop)
        if (toolErrors.length >= 3) {
            return {
                isStuck: true,
                recoveryPrompt: "SYSTEM [DOCTOR AGENT]: RECOVERY INTERVENTION. You are stuck in a failure loop. You have generated multiple consecutive tool errors. STOP using your current approach. Discard the failing tool, explicitly state what went wrong, and formulate a completely different strategy."
            };
        }

        // Heuristic 2: Repetitive identical tool calls (Circular Logic)
        if (toolCalls.length >= 4) {
            const latestCall = toolCalls[toolCalls.length - 1];
            const previousCall = toolCalls[toolCalls.length - 3]; // compare skipping the tool execution role

            if (latestCall.tool_calls?.[0]?.function.name === previousCall.tool_calls?.[0]?.function.name &&
                latestCall.tool_calls?.[0]?.function.arguments === previousCall.tool_calls?.[0]?.function.arguments) {
                return {
                    isStuck: true,
                    recoveryPrompt: "SYSTEM [DOCTOR AGENT]: CIRCULAR LOGIC DETECTED. You are repeating the exact same tool call without making progress. Yield an answer immediately or switch to a different tool."
                };
            }
        }

        return { isStuck: false };
    }
}
