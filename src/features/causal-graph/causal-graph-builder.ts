// src/features/causal-graph/causal-graph-builder.ts
// Causal Attribution Graph — Builder

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { CausalNode, CausalGraph, NodeType } from './types';

export class CausalGraphBuilder {
    private graph: CausalGraph;

    constructor(taskId: string, sessionId: string, channelType: string) {
        this.graph = {
            taskId,
            sessionId,
            channelType,
            nodes: new Map(),
            totalTokenCost: 0,
            wallTimeMs: 0,
            createdAt: Date.now(),
        };
    }

    addNode(partial: Omit<CausalNode, 'id' | 'timestamp' | 'childIds'>): string {
        const id = randomUUID();
        const node: CausalNode = {
            ...partial,
            id,
            timestamp: Date.now(),
            childIds: [],
            cacheKey: this.computeCacheKey(partial),
        };
        this.graph.nodes.set(id, node);
        this.graph.totalTokenCost += node.tokenCost;
        if (!this.graph.rootId) this.graph.rootId = id;
        return id;
    }

    link(parentId: string, childId: string): void {
        const parent = this.graph.nodes.get(parentId);
        const child = this.graph.nodes.get(childId);
        if (!parent || !child) throw new Error(`Node not found: ${parentId} or ${childId}`);
        parent.childIds.push(childId);
        child.parentIds.push(parentId);
    }

    setTerminal(nodeId: string): void {
        this.graph.terminalId = nodeId;
        this.graph.wallTimeMs = Date.now() - this.graph.createdAt;
    }

    getAncestorChain(nodeId: string): CausalNode[] {
        const chain: CausalNode[] = [];
        const visited = new Set<string>();

        const walk = (id: string) => {
            if (visited.has(id)) return;
            visited.add(id);
            const node = this.graph.nodes.get(id);
            if (!node) return;
            node.parentIds.forEach(walk);
            chain.push(node);
        };

        walk(nodeId);
        return chain;
    }

    async rerunFrom(
        nodeId: string,
        newRawData: unknown,
        executor: (node: CausalNode) => Promise<unknown>
    ): Promise<CausalGraph> {
        // Re-run only the downstream subgraph from nodeId, cache the rest
        const affectedIds = this.getDescendants(nodeId);
        const newBuilder = new CausalGraphBuilder(randomUUID(), this.graph.sessionId, this.graph.channelType);

        for (const [id, node] of this.graph.nodes) {
            if (!affectedIds.has(id)) {
                newBuilder.graph.nodes.set(id, { ...node });
            } else {
                const result = await executor({ ...node, rawData: newRawData });
                newBuilder.addNode({ ...node, rawData: result });
            }
        }

        return newBuilder.build();
    }

    exportMermaid(): string {
        const lines: string[] = ['graph TD'];
        for (const [id, node] of this.graph.nodes) {
            const label = `${node.nodeType}\\n${node.content.slice(0, 40)}`;
            lines.push(`  ${id.slice(0, 8)}["${label}"]`);
            for (const childId of node.childIds) {
                lines.push(`  ${id.slice(0, 8)} --> ${childId.slice(0, 8)}`);
            }
        }
        return lines.join('\n');
    }

    exportJson(): string {
        return JSON.stringify({
            ...this.graph,
            nodes: Object.fromEntries(this.graph.nodes),
        }, null, 2);
    }

    build(): CausalGraph {
        return this.graph;
    }

    private getDescendants(nodeId: string): Set<string> {
        const result = new Set<string>();
        const queue = [nodeId];
        while (queue.length) {
            const id = queue.shift()!;
            result.add(id);
            this.graph.nodes.get(id)?.childIds.forEach(c => queue.push(c));
        }
        return result;
    }

    private computeCacheKey(node: Omit<CausalNode, 'id' | 'timestamp' | 'childIds'>): string {
        const payload = JSON.stringify({
            nodeType: node.nodeType,
            parentIds: [...node.parentIds].sort(),
            content: node.content,
        });
        return createHash('sha256').update(payload).digest('hex');
    }
}
