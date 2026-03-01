// src/features/economics/types.ts
// Economics-Aware Execution Engine — Type Definitions

export interface TaskBudget {
    tokenBudget: number;
    timeBudgetMs: number;
    qualityTier: 'economy' | 'standard' | 'premium';
    allowBudgetOverride: boolean;
}

export interface SpendEvent {
    stepId: string;
    actionType: 'llm_call' | 'tool_call' | 'reasoning' | 'overhead';
    tokensSpent: number;
    timeSpentMs: number;
    cumulativeTokens: number;
    cumulativeTimeMs: number;
    budgetRemainingPct: number;
    qualityMode: string;
    channelType: string;
}

export interface SpendReport {
    taskId: string;
    sessionId: string;
    channelType: string;
    totalTokens: number;
    totalTimeMs: number;
    budgetUtilizationPct: number;
    events: SpendEvent[];
    modelBreakdown: Record<string, number>;
    toolBreakdown: Record<string, number>;
    qualityTier: string;
    budgetExceeded: boolean;
    finalQualityMode: string;
}
