import { Message, Provider, ToolContext } from '../core/types';
import { AgentLoop } from './loop';

export class AgentComms {
    private sessions: Map<string, Message[]> = new Map();

    constructor(private providerFn: () => Provider, private loop: AgentLoop) { }

    async getHistory(sessionId: string): Promise<string> {
        if (!this.sessions.has(sessionId)) return `Session ${sessionId} not found.`;
        const msgs = this.sessions.get(sessionId)!;
        return msgs.map(m => `[${m.role}] ${m.content}`).join('\n');
    }

    listSessions(): string[] {
        return Array.from(this.sessions.keys());
    }

    getSessions(): Map<string, Message[]> {
        return this.sessions;
    }

    async sendMessage(sessionId: string, message: string, context: ToolContext): Promise<string> {
        if (!this.sessions.has(sessionId)) {
            // Initialize new session
            this.sessions.set(sessionId, [
                { role: 'system', content: `You are an autonomous sub-agent in session ${sessionId}.` }
            ]);
        }

        const msgs = this.sessions.get(sessionId)!;
        msgs.push({ role: 'user', content: message });

        const resultMsgs = await this.loop.run(msgs, context);
        this.sessions.set(sessionId, resultMsgs);

        const finalMsg = resultMsgs[resultMsgs.length - 1];
        return finalMsg.content;
    }
}
