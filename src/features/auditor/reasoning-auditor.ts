// src/features/auditor/reasoning-auditor.ts
// Real-Time Reasoning Auditor — In-stream anomaly detection

import { LLMProvider } from '../../core/llm/types';
import { AuditEvent, AuditReport, AnomalyType, AuditorAction } from './types';

export interface AuditorConfig {
    haltThreshold: number;        // Default: 0.9
    injectThreshold: number;      // Default: 0.6
    bufferWindowTokens: number;   // Default: 200
    checkIntervalTokens: number;  // Default: 50
}

const DEFAULT_CONFIG: AuditorConfig = {
    haltThreshold: 0.9,
    injectThreshold: 0.6,
    bufferWindowTokens: 200,
    checkIntervalTokens: 50,
};

export class ReasoningAuditor {
    private tokenBuffer: string[] = [];
    private auditEvents: AuditEvent[] = [];
    private tokenCount = 0;
    private originalTask = '';
    private haltSignal = false;
    private correctionQueue: string[] = [];
    private config: AuditorConfig;

    constructor(
        private readonly llmProvider: LLMProvider,
        config: Partial<AuditorConfig> = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    setOriginalTask(task: string): void { this.originalTask = task; }
    get shouldHalt(): boolean { return this.haltSignal; }
    get pendingCorrections(): string[] { return [...this.correctionQueue]; }
    clearCorrections(): void { this.correctionQueue = []; }

    async ingestToken(token: string): Promise<AuditorAction> {
        this.tokenBuffer.push(token);
        this.tokenCount++;

        if (this.tokenBuffer.length > this.config.bufferWindowTokens) {
            this.tokenBuffer.shift();
        }

        // Fast check every token
        const fastAnomaly = this.checkRepetition();
        if (fastAnomaly) return this.handleAnomaly(fastAnomaly);

        // Heavier semantic checks every N tokens
        if (this.tokenCount % this.config.checkIntervalTokens === 0) {
            const buffer = this.tokenBuffer.join('');
            const checks = await Promise.all([
                this.checkGoalDrift(buffer),
                this.checkHallucinationSignals(buffer),
                this.checkCircularReasoning(buffer),
                this.checkPromptInjection(buffer),
            ]);
            for (const anomaly of checks) {
                if (anomaly) {
                    const action = this.handleAnomaly(anomaly);
                    if (action === 'halt' || action === 'escalate') return action;
                }
            }
        }

        return 'continue';
    }

    getReport(taskId: string, sessionId: string, channelType: string): AuditReport {
        return {
            taskId, sessionId, channelType,
            events: [...this.auditEvents],
            totalAnomalies: this.auditEvents.length,
            haltedEarly: this.haltSignal,
            injectionCount: this.correctionQueue.length,
            escalatedToHuman: this.auditEvents.some(e => e.suggestedAction === 'escalate'),
        };
    }

    private checkRepetition(): AuditEvent | null {
        if (this.tokenBuffer.length < 100) return null;
        const firstHalf = this.tokenBuffer.slice(0, 50).join('');
        const secondHalf = this.tokenBuffer.slice(50, 100).join('');
        if (this.roughSimilarity(firstHalf, secondHalf) > 0.85) {
            return this.createEvent('repetition_loop', 0.7, 'High similarity between consecutive token windows');
        }
        return null;
    }

    private async checkGoalDrift(buffer: string): Promise<AuditEvent | null> {
        if (!this.originalTask) return null;
        const response = await this.llmProvider.complete({
            messages: [{
                role: 'user',
                content: `Original task: "${this.originalTask}"\nCurrent reasoning: "${buffer.slice(-300)}"\nIs reasoning on-task? Reply ONLY with 0.0-1.0 (1.0=aligned).`,
            }],
            maxTokens: 5,
            temperature: 0,
        });
        const alignment = parseFloat(response.content.trim());
        if (!isNaN(alignment) && alignment < 0.4) {
            return this.createEvent('goal_drift', 1 - alignment, `Alignment score: ${alignment}`);
        }
        return null;
    }

    private async checkHallucinationSignals(buffer: string): Promise<AuditEvent | null> {
        const patterns = [
            /\bthe answer is\b/i,
            /\bdefinitely\b/i,
            /\bcertainly\b/i,
            /\bI know for a fact\b/i,
            /\bit is confirmed that\b/i,
        ];
        const matches = patterns.filter(p => p.test(buffer));
        if (matches.length >= 2) {
            return this.createEvent('hallucination_signal', 0.6, `Ungrounded confident assertions detected`);
        }
        return null;
    }

    private async checkCircularReasoning(buffer: string): Promise<AuditEvent | null> {
        if (this.auditEvents.length === 0) return null;
        const prevEvidence = this.auditEvents.slice(-3).map(e => e.evidence).join(' ');
        if (this.roughSimilarity(buffer.slice(-200), prevEvidence) > 0.7) {
            return this.createEvent('circular_reasoning', 0.65, 'Reasoning revisiting previously covered logic');
        }
        return null;
    }

    private async checkPromptInjection(buffer: string): Promise<AuditEvent | null> {
        const injectionPatterns = [
            /ignore (previous|all|your) instructions/i,
            /you are now/i,
            /new system prompt/i,
            /disregard your/i,
            /override (your|all) (rules|instructions)/i,
            /forget everything/i,
        ];
        const match = injectionPatterns.find(p => p.test(buffer));
        if (match) {
            return this.createEvent('prompt_injection', 0.95, `Injection pattern: "${match.source}"`);
        }
        return null;
    }

    private handleAnomaly(event: AuditEvent): AuditorAction {
        this.auditEvents.push(event);
        if (event.severity >= this.config.haltThreshold) {
            this.haltSignal = true;
            return 'halt';
        }
        if (event.severity >= this.config.injectThreshold) {
            if (event.correctionPrompt) this.correctionQueue.push(event.correctionPrompt);
            return 'inject_correction';
        }
        return 'continue';
    }

    private createEvent(
        anomalyType: AnomalyType,
        severity: number,
        evidence: string,
        correctionPrompt?: string
    ): AuditEvent {
        const action: AuditorAction =
            severity >= this.config.haltThreshold ? 'halt' :
                severity >= this.config.injectThreshold ? 'inject_correction' :
                    'continue';

        return { anomalyType, severity, tokenPosition: this.tokenCount, evidence, suggestedAction: action, correctionPrompt, timestamp: Date.now() };
    }

    private roughSimilarity(a: string, b: string): number {
        const setA = new Set(a.split(' '));
        const setB = new Set(b.split(' '));
        const intersection = [...setA].filter(w => setB.has(w)).length;
        return intersection / Math.max(setA.size, setB.size, 1);
    }
}
