import { ProviderResponse } from '../core/types';

export class UsageTracker {
    private totalPromptTokens = 0;
    private totalCompletionTokens = 0;
    private totalCost = 0; // Simulated cost tracking
    private callCount = 0;

    track(response: ProviderResponse) {
        if (!response.usage) return;
        this.totalPromptTokens += response.usage.promptTokens;
        this.totalCompletionTokens += response.usage.completionTokens;
        this.callCount++;

        // Rough estimation: $0.01 per 1K output, $0.005 per 1K input mapping
        this.totalCost += (response.usage.promptTokens / 1000) * 0.005;
        this.totalCost += (response.usage.completionTokens / 1000) * 0.01;
    }

    getReport(): string {
        return `📊 *Usage Report*\n` +
            `Total LLM Calls: ${this.callCount}\n` +
            `Prompt Tokens: ${this.totalPromptTokens}\n` +
            `Completion Tokens: ${this.totalCompletionTokens}\n` +
            `Estimated Cost: $${this.totalCost.toFixed(4)}`;
    }
}

export const metrics = new UsageTracker();
