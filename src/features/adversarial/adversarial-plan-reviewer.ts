// src/features/adversarial/adversarial-plan-reviewer.ts
// Adversarial Self-Play — Red-team plan review with iterative revision

import { randomUUID } from 'crypto';
import { LLMProvider } from '../../core/llm/types';
import { RedTeamObjection, AdversarialReviewResult, ObjectionCategory } from './types';

const RED_TEAM_PROMPT = `You are a red-team agent. Find every way this plan could fail.
You are REWARDED for finding failures, PENALIZED for missing them.
Reply ONLY as JSON array:
[{"category":"logical_flaw|missing_step|tool_failure_risk|assumption_violation|resource_constraint|edge_case|security_risk","severity":0.0-1.0,"description":"...","affectedSteps":[1,2],"suggestedFix":"..."}]
Return [] if you find zero issues.`;

export class AdversarialPlanReviewer {
    constructor(
        private readonly llmProvider: LLMProvider,
        private readonly maxRounds = 3
    ) { }

    async run(initialPlan: string, task: string, context: Record<string, unknown>): Promise<AdversarialReviewResult> {
        let currentPlan = initialPlan;
        let allObjections: RedTeamObjection[] = [];
        let totalTokenCost = 0;
        let roundCount = 0;

        for (let round = 0; round < this.maxRounds; round++) {
            roundCount++;
            const { objections, tokenCost } = await this.review(currentPlan, task);
            totalTokenCost += tokenCost;

            const newObjections = objections.filter(
                o => !allObjections.some(e => this.roughSimilarity(e.description, o.description) > 0.8)
            );
            if (newObjections.length === 0) break;

            allObjections.push(...newObjections.map(o => ({ ...o, id: randomUUID() })));
            const critical = newObjections.filter(o => o.severity >= 0.7);

            if (critical.length > 0) {
                const { revised, tokenCost: rc } = await this.revisePlan(currentPlan, critical, task);
                currentPlan = revised;
                totalTokenCost += rc;
                critical.forEach(o => {
                    const found = allObjections.find(a => a.description === o.description);
                    if (found) found.resolutionStatus = 'resolved';
                });
            } else {
                newObjections.forEach(o => {
                    const found = allObjections.find(a => a.description === o.description);
                    if (found) found.resolutionStatus = 'accepted_risk';
                });
                break;
            }
        }

        allObjections.filter(o => o.resolutionStatus === 'open' && o.severity >= 0.7)
            .forEach(o => { o.resolutionStatus = 'escalated'; });

        return {
            originalPlan: initialPlan, revisedPlan: currentPlan, objections: allObjections,
            resolvedCount: allObjections.filter(o => o.resolutionStatus === 'resolved').length,
            escalatedCount: allObjections.filter(o => o.resolutionStatus === 'escalated').length,
            acceptedRiskCount: allObjections.filter(o => o.resolutionStatus === 'accepted_risk').length,
            reviewTokenCost: totalTokenCost,
            approvedForExecution: !allObjections.some(o => o.resolutionStatus === 'escalated'),
            roundCount,
        };
    }

    private async review(plan: string, task: string): Promise<{ objections: RedTeamObjection[]; tokenCost: number }> {
        const response = await this.llmProvider.complete({
            messages: [{ role: 'user', content: `${RED_TEAM_PROMPT}\n\nTask: ${task}\nPlan:\n${plan}` }],
            temperature: 0.7, maxTokens: 1000,
        });
        try {
            const raw = JSON.parse(response.content.replace(/```json|```/g, '').trim()) as any[];
            return {
                objections: raw.map(o => ({
                    id: randomUUID(), category: o.category as ObjectionCategory,
                    severity: Number(o.severity), description: String(o.description),
                    affectedSteps: Array.isArray(o.affectedSteps) ? o.affectedSteps : [],
                    suggestedFix: String(o.suggestedFix),
                    resolutionStatus: 'open', resolutionNotes: '',
                })),
                tokenCost: response.tokensUsed.total,
            };
        } catch {
            return { objections: [], tokenCost: response.tokensUsed.total };
        }
    }

    private async revisePlan(plan: string, critical: RedTeamObjection[], task: string): Promise<{ revised: string; tokenCost: number }> {
        const issues = critical.map(o => `- ${o.description} -> Fix: ${o.suggestedFix}`).join('\n');
        const response = await this.llmProvider.complete({
            messages: [{ role: 'user', content: `Revise this plan to address:\n${issues}\n\nOriginal plan:\n${plan}\n\nTask: ${task}\n\nRevised plan:` }],
            temperature: 0.3, maxTokens: 800,
        });
        return { revised: response.content, tokenCost: response.tokensUsed.total };
    }

    private roughSimilarity(a: string, b: string): number {
        const setA = new Set(a.toLowerCase().split(' '));
        const setB = new Set(b.toLowerCase().split(' '));
        const intersection = [...setA].filter(w => setB.has(w)).length;
        return intersection / Math.max(setA.size, setB.size, 1);
    }
}
