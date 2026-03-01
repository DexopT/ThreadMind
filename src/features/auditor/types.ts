// src/features/auditor/types.ts
// Real-Time Reasoning Auditor — Type Definitions

export type AnomalyType =
    | 'circular_reasoning'
    | 'hallucination_signal'
    | 'goal_drift'
    | 'prompt_injection'
    | 'scope_creep'
    | 'confidence_spike'
    | 'repetition_loop';

export type AuditorAction = 'continue' | 'inject_correction' | 'halt' | 'escalate';

export interface AuditEvent {
    anomalyType: AnomalyType;
    severity: number;              // 0.0 - 1.0
    tokenPosition: number;
    evidence: string;              // Exact text snippet triggering alert
    suggestedAction: AuditorAction;
    correctionPrompt?: string;
    timestamp: number;
}

export interface AuditReport {
    taskId: string;
    sessionId: string;
    channelType: string;
    events: AuditEvent[];
    totalAnomalies: number;
    haltedEarly: boolean;
    injectionCount: number;
    escalatedToHuman: boolean;
}
