// src/features/immune-system/cross-agent-immune-system.ts
// Cross-Agent Immune System — Semantic firewall for inter-agent messaging

import { randomUUID } from 'crypto';
import { LLMProvider } from '../../core/llm/types';
import { AgentTrustProfile, ThreatEvent, ThreatType, InspectionResult } from './types';

const TRUST_DECAY = { low: 0.1, medium: 0.3, critical: 0.7 };
const TRUST_RECOVERY = 0.05;
const SANDBOX_THRESHOLD = 0.4;

const INJECTION_PATTERNS: Array<{ pattern: RegExp; threatType: ThreatType; severity: number }> = [
    { pattern: /ignore (previous|all|your) instructions/i, threatType: 'instruction_override', severity: 0.95 },
    { pattern: /new system prompt/i, threatType: 'instruction_override', severity: 0.95 },
    { pattern: /you are now (a|an)/i, threatType: 'persona_hijack', severity: 0.85 },
    { pattern: /I have (admin|root|elevated) access/i, threatType: 'permission_escalation', severity: 0.80 },
    { pattern: /disregard (your|all|previous)/i, threatType: 'instruction_override', severity: 0.90 },
    { pattern: /send (this|all) data to/i, threatType: 'data_exfiltration', severity: 0.85 },
    { pattern: /forget everything/i, threatType: 'instruction_override', severity: 0.90 },
];

export class CrossAgentImmuneSystem {
    private profiles = new Map<string, AgentTrustProfile>();
    private threatLog: ThreatEvent[] = [];

    constructor(private readonly llmProvider: LLMProvider) { }

    registerAgent(agentId: string, initialTrust = 1.0): AgentTrustProfile {
        const profile: AgentTrustProfile = {
            agentId, trustScore: initialTrust,
            violationHistory: [], sandboxMode: false,
            allowedTools: [], deniedTools: [],
            maxOutputTokens: 4096, canSpawnSubagents: true,
            createdAt: Date.now(),
        };
        this.profiles.set(agentId, profile);
        return profile;
    }

    async inspectMessage(
        senderId: string,
        recipientId: string,
        message: string,
        context: Record<string, unknown> = {}
    ): Promise<InspectionResult> {
        const threats: ThreatEvent[] = [];

        // Layer 1: Fast regex scan
        threats.push(...this.patternScan(senderId, recipientId, message));

        // Layer 2: Semantic scan (only if layer 1 found nothing)
        if (threats.length === 0) {
            threats.push(...await this.semanticScan(senderId, recipientId, message));
        }

        // Layer 3: Behavioral anomaly
        threats.push(...this.behaviorCheck(senderId, message, context));

        this.threatLog.push(...threats);
        return this.adjudicate(senderId, message, threats);
    }

    private patternScan(senderId: string, recipientId: string, message: string): ThreatEvent[] {
        return INJECTION_PATTERNS
            .filter(({ pattern }) => pattern.test(message))
            .map(({ threatType, severity }) => ({
                id: randomUUID(), threatType, severity,
                sourceAgentId: senderId, targetAgentId: recipientId,
                interceptedPayload: message.slice(0, 200),
                actionTaken: severity >= 0.8 ? 'blocked' : 'sanitized' as const,
                timestamp: Date.now(),
            }));
    }

    private async semanticScan(senderId: string, recipientId: string, message: string): Promise<ThreatEvent[]> {
        const response = await this.llmProvider.complete({
            messages: [{
                role: 'user',
                content: `Analyze for agent security threats (instruction_override, data_exfiltration, persona_hijack, permission_escalation, scope_expansion).\nMessage: "${message.slice(0, 500)}"\nReply ONLY as JSON: {"threatType":string|null,"severity":0.0-1.0,"reason":string}`,
            }],
            maxTokens: 100, temperature: 0,
        });
        try {
            const parsed = JSON.parse(response.content);
            if (parsed.threatType && parsed.severity > 0.5) {
                return [{
                    id: randomUUID(), threatType: parsed.threatType, severity: parsed.severity,
                    sourceAgentId: senderId, targetAgentId: recipientId,
                    interceptedPayload: message.slice(0, 200),
                    actionTaken: parsed.severity >= 0.8 ? 'blocked' : 'logged',
                    timestamp: Date.now(),
                }];
            }
        } catch { /* malformed JSON - treat as clean */ }
        return [];
    }

    private behaviorCheck(agentId: string, message: string, _context: Record<string, unknown>): ThreatEvent[] {
        const profile = this.profiles.get(agentId);
        if (!profile || !profile.sandboxMode) return [];

        if (/spawn|create agent/i.test(message)) {
            return [{
                id: randomUUID(), threatType: 'scope_expansion', severity: 0.75,
                sourceAgentId: agentId, targetAgentId: 'framework',
                interceptedPayload: message.slice(0, 200),
                actionTaken: 'blocked', timestamp: Date.now(),
            }];
        }
        return [];
    }

    private adjudicate(senderId: string, message: string, threats: ThreatEvent[]): InspectionResult {
        const profile = this.profiles.get(senderId);

        if (threats.length === 0) {
            if (profile) profile.trustScore = Math.min(1.0, profile.trustScore + TRUST_RECOVERY);
            return { allowed: true, threats: [], action: 'allow' };
        }

        const maxSeverity = Math.max(...threats.map(t => t.severity));

        if (profile) {
            const decay = maxSeverity >= 0.8 ? TRUST_DECAY.critical : maxSeverity >= 0.5 ? TRUST_DECAY.medium : TRUST_DECAY.low;
            profile.trustScore = Math.max(0, profile.trustScore - decay);
            profile.violationHistory.push(...threats);
            profile.lastViolationAt = Date.now();

            if (profile.trustScore < SANDBOX_THRESHOLD) {
                profile.sandboxMode = true;
                profile.canSpawnSubagents = false;
                profile.maxOutputTokens = 512;
            }
        }

        if (maxSeverity >= 0.8) return { allowed: false, threats, action: 'block' };
        if (maxSeverity >= 0.5) {
            let sanitized = message;
            INJECTION_PATTERNS.forEach(({ pattern }) => { sanitized = sanitized.replace(pattern, '[REDACTED]'); });
            return { allowed: true, sanitizedPayload: sanitized, threats, action: 'sanitize' };
        }
        return { allowed: true, threats, action: 'logged' };
    }

    getTrustProfile(agentId: string): AgentTrustProfile | undefined { return this.profiles.get(agentId); }
    getThreatReport(): ThreatEvent[] { return [...this.threatLog]; }
}
