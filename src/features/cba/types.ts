// src/features/cba/types.ts
// Cognitive Budget Allocation — Type Definitions

export type QualityTier = 'economy' | 'standard' | 'premium';

export interface CognitiveBudget {
    complexityScore: number;          // 1.0 - 10.0
    estimatedTokenCost: number;
    confidenceCeiling: number;        // 0.0 - 1.0
    recommendedCotDepth: number;      // 1 - 10 reasoning steps
    recommendedTemperature: number;
    recommendedQualityTier: QualityTier;
    useTools: boolean;
    requiresVerificationPass: boolean;
    tokenBudgetCap: number;
}
