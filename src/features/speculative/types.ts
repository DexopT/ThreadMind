// src/features/speculative/types.ts
// Tool Shadow Caching + Speculative Execution — Type Definitions

export type ToolRiskTier = 'read_only' | 'idempotent' | 'write' | 'destructive' | 'unknown';

export interface ToolDefinition {
    name: string;
    riskTier: ToolRiskTier;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    sandboxExecute?: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCallPrediction {
    toolName: string;
    predictedArgs: Record<string, unknown>;
    confidence: number;
    riskTier: ToolRiskTier;
    speculativeResult?: unknown;
    executedAt?: number;
    promoted: boolean;
    discarded: boolean;
}
