// src/features/immune-system/types.ts
// Cross-Agent Immune System — Type Definitions

export type ThreatType =
    | 'instruction_override'
    | 'data_exfiltration'
    | 'persona_hijack'
    | 'permission_escalation'
    | 'scope_expansion'
    | 'injection_payload';

export interface AgentTrustProfile {
    agentId: string;
    trustScore: number;            // 0.0 - 1.0
    violationHistory: ThreatEvent[];
    sandboxMode: boolean;
    allowedTools: string[];
    deniedTools: string[];
    maxOutputTokens: number;
    canSpawnSubagents: boolean;
    createdAt: number;
    lastViolationAt?: number;
}

export interface ThreatEvent {
    id: string;
    threatType: ThreatType;
    severity: number;
    sourceAgentId: string;
    targetAgentId: string;
    interceptedPayload: string;
    actionTaken: 'blocked' | 'sanitized' | 'quarantined' | 'logged';
    timestamp: number;
}

export interface InspectionResult {
    allowed: boolean;
    sanitizedPayload?: string;
    threats: ThreatEvent[];
    action: 'allow' | 'block' | 'sanitize' | 'logged';
}
