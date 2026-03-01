// src/features/causal-graph/types.ts
// Causal Attribution Graph — Type Definitions

export type NodeType =
    | 'user_input'
    | 'ambiguity_resolve'
    | 'plan_step'
    | 'tool_call'
    | 'tool_result'
    | 'reasoning'
    | 'synthesis'
    | 'final_output';

export interface CausalNode {
    id: string;
    nodeType: NodeType;
    content: string;                        // Human-readable summary
    rawData?: unknown;                      // Full payload
    timestamp: number;                      // Unix ms
    tokenCost: number;
    confidence: number;                     // 0.0 - 1.0
    parentIds: string[];
    childIds: string[];
    metadata: Record<string, unknown>;
    cacheable: boolean;
    cacheKey?: string;                      // sha256 for cache lookup
    channel?: string;                       // Which channel triggered this node
}

export interface CausalGraph {
    taskId: string;
    sessionId: string;
    channelType: string;
    nodes: Map<string, CausalNode>;
    rootId?: string;
    terminalId?: string;
    totalTokenCost: number;
    wallTimeMs: number;
    createdAt: number;
}
