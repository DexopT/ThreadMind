// src/features/adversarial/types.ts
// Adversarial Self-Play During Planning — Type Definitions

export type ObjectionCategory =
    | 'logical_flaw' | 'missing_step' | 'tool_failure_risk'
    | 'assumption_violation' | 'resource_constraint' | 'edge_case' | 'security_risk';

export interface RedTeamObjection {
    id: string;
    category: ObjectionCategory;
    severity: number;                    // 0.0 - 1.0
    description: string;
    affectedSteps: number[];
    suggestedFix: string;
    resolutionStatus: 'open' | 'resolved' | 'escalated' | 'accepted_risk';
    resolutionNotes: string;
}

export interface AdversarialReviewResult {
    originalPlan: string;
    revisedPlan: string;
    objections: RedTeamObjection[];
    resolvedCount: number;
    escalatedCount: number;
    acceptedRiskCount: number;
    reviewTokenCost: number;
    approvedForExecution: boolean;
    roundCount: number;
}
