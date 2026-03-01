// src/features/pup/types.ts
// Parallel Universe Planning — Type Definitions

export interface PlanBranch {
    branchId: string;
    planVariant: string;
    divergencePoint: number;
    stepsCompleted: Array<{ step: string; result: unknown; tokenCost: number }>;
    artifactsDiscovered: Map<string, unknown>;
    currentScore: number;
    tokenCost: number;
    status: 'running' | 'collapsed_in' | 'pruned' | 'complete';
}

export interface CollapseDecision {
    winningBranchId: string;
    rationale: string;
    mergedArtifacts: Map<string, unknown>;
    prunedBranchIds: string[];
    checkpointStep: number;
}

export interface PUPResult {
    finalOutput: string;
    winningBranch: PlanBranch;
    allBranches: PlanBranch[];
    collapseHistory: CollapseDecision[];
    totalTokenCost: number;
    artifactsDiscovered: Map<string, unknown>;
}
