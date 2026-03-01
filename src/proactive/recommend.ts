import { Memory, Provider } from '../core/types';

export class SmartRecommender {
    constructor(private memory: Memory, private providerFn: () => Provider) { }

    async generateRecommendations(userId: string): Promise<string[]> {
        // Query recent high-access memories to detect patterns
        const recent = await this.memory.query(userId, '', 20) || [];
        if (recent.length < 5) return [];

        const contextStr = recent.map(m => `[${new Date(m.createdAt).toISOString()}] ${m.content}`).join('\n');

        const prompt = `Based on the user's recent behavior patterns:\n${contextStr}\n\nList 1-3 proactive actions the agent should suggest or take. Be concise. Reply ONLY with a bulleted list.`;

        try {
            const result = await this.providerFn().generateResponse([
                { role: 'system', content: 'You are a proactive recommendation engine.' },
                { role: 'user', content: prompt }
            ]);

            return result.message.content.split('\n').filter(l => l.trim().length > 0);
        } catch {
            return [];
        }
    }
}
