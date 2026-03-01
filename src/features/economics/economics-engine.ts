// src/features/economics/economics-engine.ts
// Economics-Aware Execution Engine — Budget tracking with auto-downgrade

import { randomUUID } from 'crypto';
import { TaskBudget, SpendEvent, SpendReport } from './types';

type QualityMode = 'economy' | 'standard' | 'premium' | 'abort';

export const QUALITY_MODE_CONFIG = {
    economy: { maxCotDepth: 2, maxToolCalls: 3, skipVerification: true, compressContext: true, temperature: 0.1 },
    standard: { maxCotDepth: 5, maxToolCalls: 10, skipVerification: false, compressContext: false, temperature: 0.4 },
    premium: { maxCotDepth: 10, maxToolCalls: 30, skipVerification: false, compressContext: false, temperature: 0.6 },
};

export class EconomicsEngine {
    private spentTokens = 0;
    private spentTimeMs = 0;
    private events: SpendEvent[] = [];
    private currentMode: QualityMode;
    private modelBreakdown: Record<string, number> = {};
    private toolBreakdown: Record<string, number> = {};
    private startTime = Date.now();

    constructor(
        private readonly taskId: string,
        private readonly sessionId: string,
        private readonly channelType: string,
        private readonly budget: TaskBudget
    ) {
        this.currentMode = budget.qualityTier;
    }

    get mode(): QualityMode { return this.currentMode; }
    get modeConfig() { return QUALITY_MODE_CONFIG[this.currentMode as keyof typeof QUALITY_MODE_CONFIG] ?? QUALITY_MODE_CONFIG.economy; }

    canAfford(estimatedCost: number): boolean {
        return this.spentTokens + estimatedCost <= this.budget.tokenBudget;
    }

    getRemainingPct(): number {
        return 1 - this.spentTokens / this.budget.tokenBudget;
    }

    applyModeAdjustment(): boolean {
        const remaining = this.getRemainingPct();
        const elapsed = Date.now() - this.startTime;

        if (remaining < 0.05 || elapsed > this.budget.timeBudgetMs) {
            this.currentMode = 'abort'; return true;
        }
        if (remaining < 0.4 && this.currentMode !== 'economy') {
            this.currentMode = 'economy'; return true;
        }
        if (remaining < 0.6 && this.currentMode === 'premium') {
            this.currentMode = 'standard'; return true;
        }
        return false;
    }

    recordSpend(
        actionType: SpendEvent['actionType'],
        tokensSpent: number,
        timeSpentMs: number,
        meta?: { model?: string; toolName?: string }
    ): string {
        const stepId = randomUUID();
        this.spentTokens += tokensSpent;
        this.spentTimeMs += timeSpentMs;
        if (meta?.model) this.modelBreakdown[meta.model] = (this.modelBreakdown[meta.model] ?? 0) + tokensSpent;
        if (meta?.toolName) this.toolBreakdown[meta.toolName] = (this.toolBreakdown[meta.toolName] ?? 0) + tokensSpent;

        this.events.push({
            stepId, actionType, tokensSpent, timeSpentMs,
            cumulativeTokens: this.spentTokens, cumulativeTimeMs: this.spentTimeMs,
            budgetRemainingPct: this.getRemainingPct(),
            qualityMode: this.currentMode, channelType: this.channelType,
        });

        this.applyModeAdjustment();
        return stepId;
    }

    generateReport(): SpendReport {
        return {
            taskId: this.taskId, sessionId: this.sessionId, channelType: this.channelType,
            totalTokens: this.spentTokens, totalTimeMs: this.spentTimeMs,
            budgetUtilizationPct: this.spentTokens / this.budget.tokenBudget,
            events: [...this.events],
            modelBreakdown: { ...this.modelBreakdown }, toolBreakdown: { ...this.toolBreakdown },
            qualityTier: this.budget.qualityTier,
            budgetExceeded: this.spentTokens > this.budget.tokenBudget,
            finalQualityMode: this.currentMode,
        };
    }
}
