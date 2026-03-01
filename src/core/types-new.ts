// src/core/types-new.ts
// New Agent Context & Response types for the middleware pipeline
// These types carry all feature data through the pipeline

import { CausalGraph } from '../features/causal-graph/types';
import { AuditReport } from '../features/auditor/types';
import { SpendReport } from '../features/economics/types';
import { StateTransitionEvent } from '../features/state-machine/types';
import { AdversarialReviewResult } from '../features/adversarial/types';
import { ThreatEvent } from '../features/immune-system/types';
import { MemoryEntry } from '../features/memory/types';
import { CognitiveBudget } from '../features/cba/types';
import { TaskBudget } from '../features/economics/types';

export interface AgentContext {
    taskId: string;
    sessionId: string;
    channelType: string;
    channelMessageId: string;
    userId: string;
    task: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    metadata: Record<string, unknown>;
    cognitiveBudget?: CognitiveBudget;
    taskBudget?: TaskBudget;
}

export interface AgentResponse {
    taskId: string;
    sessionId: string;
    channelType: string;
    output: string;
    causalGraph?: CausalGraph;
    auditReport?: AuditReport;
    spendReport?: SpendReport;
    stateHistory?: StateTransitionEvent[];
    adversarialReview?: AdversarialReviewResult;
    threatLog?: ThreatEvent[];
    memoryUpdates?: MemoryEntry[];
    shouldStream: boolean;
    isComplete: boolean;
    errorMessage?: string;
}
