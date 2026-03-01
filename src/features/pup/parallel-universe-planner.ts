// src/features/pup/parallel-universe-planner.ts
// Parallel Universe Planning — Concurrent branch exploration with collapse

import { randomUUID } from 'crypto';
import { LLMProvider } from '../../core/llm/types';
import { PlanBranch, CollapseDecision, PUPResult } from './types';

export interface PUPConfig {
    nBranches: number;         // Default: 3
    collapseInterval: number;  // Steps between collapse evaluations. Default: 3
    maxBranchTokens: number;   // Per-branch token cap
}

export class ParallelUniversePlanner {
    private sharedArtifactStore = new Map<string, { value: unknown; discoveredBy: string }>();
    private collapseHistory: CollapseDecision[] = [];
    private config: PUPConfig;

    constructor(
        private readonly llmProvider: LLMProvider,
        config: Partial<PUPConfig> = {}
    ) {
        this.config = { nBranches: 3, collapseInterval: 3, maxBranchTokens: 3000, ...config };
    }

    async execute(task: string, context: Record<string, unknown>): Promise<PUPResult> {
        const planVariants = await this.generatePlanVariants(task);
        const branches: PlanBranch[] = planVariants.map(plan => ({
            branchId: randomUUID(), planVariant: plan, divergencePoint: 0,
            stepsCompleted: [], artifactsDiscovered: new Map(),
            currentScore: 0, tokenCost: 0, status: 'running',
        }));
        return this.runWithCollapse(branches, task, context);
    }

    private async generatePlanVariants(task: string): Promise<string[]> {
        const response = await this.llmProvider.complete({
            messages: [{
                role: 'user',
                content: `Generate ${this.config.nBranches} DISTINCT plans to accomplish:\n${task}\n\nEach plan must differ in approach. Separate with "---PLAN---".`,
            }],
            temperature: 0.9, maxTokens: 1000,
        });
        return response.content.split('---PLAN---').map(p => p.trim()).filter(Boolean).slice(0, this.config.nBranches);
    }

    private async runWithCollapse(branches: PlanBranch[], task: string, context: Record<string, unknown>): Promise<PUPResult> {
        let stepIndex = 0;
        let activeBranches = [...branches];

        while (activeBranches.some(b => b.status === 'running')) {
            // Execute one step per running branch concurrently (READ-ONLY tools only)
            await Promise.all(
                activeBranches.filter(b => b.status === 'running').map(b => this.executeBranchStep(b, task, stepIndex, context))
            );
            stepIndex++;

            if (stepIndex % this.config.collapseInterval === 0 && activeBranches.filter(b => b.status === 'running').length > 1) {
                const decision = await this.evaluateAndCollapse(activeBranches, stepIndex);
                this.collapseHistory.push(decision);

                activeBranches = activeBranches.map(b =>
                    decision.prunedBranchIds.includes(b.branchId) ? { ...b, status: 'pruned' as const } : b
                );

                for (const [key, value] of decision.mergedArtifacts) {
                    this.sharedArtifactStore.set(key, { value, discoveredBy: decision.winningBranchId });
                }

                if (activeBranches.filter(b => b.status === 'running').length <= 1) break;
            }
        }

        const winner = activeBranches.find(b => b.status === 'running' || b.branchId === this.collapseHistory.at(-1)?.winningBranchId)!;
        const finalOutput = await this.generateFinalOutput(winner, task);

        return {
            finalOutput, winningBranch: winner, allBranches: branches,
            collapseHistory: this.collapseHistory,
            totalTokenCost: branches.reduce((sum, b) => sum + b.tokenCost, 0),
            artifactsDiscovered: new Map(
                [...this.sharedArtifactStore.entries()].map(([k, v]) => [k, v.value])
            ),
        };
    }

    private async executeBranchStep(branch: PlanBranch, task: string, stepIndex: number, _context: Record<string, unknown>): Promise<void> {
        if (branch.tokenCost >= this.config.maxBranchTokens) { branch.status = 'pruned'; return; }

        const response = await this.llmProvider.complete({
            messages: [{
                role: 'user',
                content: `Execute step ${stepIndex} of this plan (READ-ONLY tools only):\n${branch.planVariant}\n\nShared artifacts: ${JSON.stringify(Object.fromEntries(this.sharedArtifactStore))}\n\nTask: ${task}`,
            }],
            temperature: 0.3, maxTokens: 500,
        });

        branch.stepsCompleted.push({ step: `Step ${stepIndex}`, result: response.content, tokenCost: response.tokensUsed.total });
        branch.tokenCost += response.tokensUsed.total;
        branch.currentScore = branch.stepsCompleted.length * 0.4 + (1 - branch.tokenCost / this.config.maxBranchTokens) * 0.3;

        if (response.content.includes('[COMPLETE]')) branch.status = 'complete';
    }

    private async evaluateAndCollapse(branches: PlanBranch[], checkpoint: number): Promise<CollapseDecision> {
        const running = branches.filter(b => b.status === 'running' || b.status === 'complete');
        const winner = running.reduce((best, b) => b.currentScore > best.currentScore ? b : best);
        return {
            winningBranchId: winner.branchId,
            rationale: `Score ${winner.currentScore.toFixed(2)} at checkpoint ${checkpoint}`,
            mergedArtifacts: winner.artifactsDiscovered,
            prunedBranchIds: running.filter(b => b.branchId !== winner.branchId).map(b => b.branchId),
            checkpointStep: checkpoint,
        };
    }

    private async generateFinalOutput(winner: PlanBranch, task: string): Promise<string> {
        const response = await this.llmProvider.complete({
            messages: [{
                role: 'user',
                content: `Generate final answer.\nTask: ${task}\nCompleted steps: ${JSON.stringify(winner.stepsCompleted)}\nArtifacts: ${JSON.stringify(Object.fromEntries(this.sharedArtifactStore))}`,
            }],
            temperature: 0.3, maxTokens: 1500,
        });
        return response.content;
    }
}
