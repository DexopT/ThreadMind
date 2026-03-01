// src/features/cba/cognitive-budget-allocator.ts
// Cognitive Budget Allocation — Zero-LLM-call task complexity estimation

import { CognitiveBudget, QualityTier } from './types';

interface TaskFeatures {
    wordCount: number;
    hasMultipleConstraints: boolean;
    requiresExternalData: boolean;
    isAmbiguous: boolean;
    isCreative: boolean;
    isCodeGeneration: boolean;
    isFactualRecall: boolean;
    hasLongDocument: boolean;
    hasMultipleSubtasks: boolean;
    isMultiTurn: boolean;
}

const COMPLEXITY_WEIGHTS: Partial<Record<keyof TaskFeatures, number>> = {
    hasMultipleConstraints: 1.8,
    requiresExternalData: 1.5,
    isAmbiguous: 2.5,
    isCreative: 1.3,
    isCodeGeneration: 2.2,
    isFactualRecall: -1.0,
    hasLongDocument: 1.7,
    hasMultipleSubtasks: 2.0,
    isMultiTurn: 0.5,
};

const BUDGET_TABLE = [
    { maxComplexity: 2, cotDepth: 1, temperature: 0.1, tier: 'economy' as QualityTier, tokenCap: 500 },
    { maxComplexity: 4, cotDepth: 2, temperature: 0.2, tier: 'economy' as QualityTier, tokenCap: 1500 },
    { maxComplexity: 6, cotDepth: 4, temperature: 0.4, tier: 'standard' as QualityTier, tokenCap: 4000 },
    { maxComplexity: 8, cotDepth: 7, temperature: 0.6, tier: 'standard' as QualityTier, tokenCap: 8000 },
    { maxComplexity: 10, cotDepth: 10, temperature: 0.7, tier: 'premium' as QualityTier, tokenCap: 16000 },
];

export class CognitiveBudgetAllocator {

    allocate(task: string, context: Record<string, unknown> = {}): CognitiveBudget {
        const features = this.extractFeatures(task, context);
        const complexity = this.scoreComplexity(features);
        return this.mapToBudget(complexity, features);
    }

    private extractFeatures(task: string, context: Record<string, unknown>): TaskFeatures {
        const lower = task.toLowerCase();
        return {
            wordCount: task.split(/\s+/).length,
            hasMultipleConstraints: (task.match(/\band\b|\balso\b|\bwhile\b/gi) ?? []).length >= 2,
            requiresExternalData: /current|latest|now|today|recent|fetch|search/i.test(lower),
            isAmbiguous: /maybe|perhaps|something like|sort of/i.test(lower),
            isCreative: /write|create|generate|design|craft/i.test(lower),
            isCodeGeneration: /code|function|script|implement|program/i.test(lower),
            isFactualRecall: /what is|who is|when did|define/i.test(lower),
            hasLongDocument: typeof context.documentLength === 'number' && context.documentLength > 2000,
            hasMultipleSubtasks: (task.match(/then|after that|next|step \d/gi) ?? []).length >= 2,
            isMultiTurn: typeof context.turnCount === 'number' && context.turnCount > 1,
        };
    }

    private scoreComplexity(features: TaskFeatures): number {
        let score = 1.0 + Math.log1p(features.wordCount / 20) * 0.5;
        for (const [key, weight] of Object.entries(COMPLEXITY_WEIGHTS)) {
            if (features[key as keyof TaskFeatures]) score += weight ?? 0;
        }
        return Math.max(1.0, Math.min(10.0, score));
    }

    private mapToBudget(complexity: number, features: TaskFeatures): CognitiveBudget {
        const row = BUDGET_TABLE.find(r => complexity <= r.maxComplexity) ?? BUDGET_TABLE[BUDGET_TABLE.length - 1];
        return {
            complexityScore: complexity,
            estimatedTokenCost: row.tokenCap * 0.6,
            confidenceCeiling: features.requiresExternalData ? 0.7 : features.isAmbiguous ? 0.65 : 0.9,
            recommendedCotDepth: row.cotDepth,
            recommendedTemperature: row.temperature,
            recommendedQualityTier: row.tier,
            useTools: features.requiresExternalData || features.isCodeGeneration,
            requiresVerificationPass: complexity >= 7,
            tokenBudgetCap: row.tokenCap,
        };
    }
}
