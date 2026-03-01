import fs from 'fs';
import path from 'path';
import { Memory, MemoryEntry } from '../core/types';

interface GraphNode {
    id: string;
    label: string;
    properties: Record<string, any>;
}

interface GraphEdge {
    sourceId: string;
    targetId: string;
    relation: string;
}

interface KnowledgeGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export class GraphMemory implements Memory {
    public name = 'directed-graph';
    private graphPath: string;
    private nodes: GraphNode[] = [];
    private edges: GraphEdge[] = [];

    constructor(namespace: string = 'global') {
        this.graphPath = path.join(process.cwd(), 'data', 'memory', namespace, 'graph.json');
        const dir = path.dirname(this.graphPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.saveGraph({ nodes: [], edges: [] });
    }

    private loadGraph(): KnowledgeGraph {
        try {
            const data = fs.readFileSync(this.graphPath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return { nodes: [], edges: [] };
        }
    }

    private saveGraph(graph: KnowledgeGraph) {
        fs.writeFileSync(this.graphPath, JSON.stringify(graph, null, 2), 'utf8');
    }

    async add(userId: string, content: string, type: MemoryEntry['type'] = 'semantic'): Promise<void> {
        // In a real graph memory, the LLM would translate the 'content' string into Nodes/Edges via tools
        // Here we simulate adding a standalone episodic node for the user if it's raw text
        const graph = this.loadGraph();

        // Find or create user node
        let userNode = graph.nodes.find(n => n.label === 'User' && n.id === userId);
        if (!userNode) {
            userNode = { id: userId, label: 'User', properties: {} };
            graph.nodes.push(userNode);
        }

        const nodeId = 'node_' + Date.now() + Math.random().toString(36).substring(7);
        graph.nodes.push({
            id: nodeId,
            label: 'Memory',
            properties: { content, type, createdAt: Date.now() }
        });

        graph.edges.push({
            sourceId: userId,
            targetId: nodeId,
            relation: 'HAS_MEMORY'
        });

        this.saveGraph(graph);
    }

    async query(userId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
        const graph = this.loadGraph();
        const results: MemoryEntry[] = [];

        // Simple sub-graph extraction: find User node, follow HAS_MEMORY edges, filter content
        const userEdges = graph.edges.filter(e => e.sourceId === userId && e.relation === 'HAS_MEMORY');

        for (const edge of userEdges) {
            const targetNode = graph.nodes.find(n => n.id === edge.targetId);
            if (targetNode && targetNode.properties.content && targetNode.properties.content.toLowerCase().includes(query.toLowerCase())) {
                results.push({
                    id: targetNode.id,
                    userId,
                    content: targetNode.properties.content,
                    type: targetNode.properties.type || 'semantic',
                    createdAt: targetNode.properties.createdAt || Date.now(),
                    updatedAt: Date.now(),
                    accessCount: 1
                });
            }
        }

        return results.reverse().slice(0, limit);
    }

    async consolidate(userId: string): Promise<void> {
        // Graph consolidation merges duplicate nodes or conflicting edges
        console.log(`[GraphMemory] Consolidation triggered for user ${userId}. (Stub)`);
    }

    // Graph specific LLM CRUD ops exposed internally
    public addNode(node: GraphNode) {
        const graph = this.loadGraph();
        graph.nodes.push(node);
        this.saveGraph(graph);
    }

    public addEdge(edge: GraphEdge) {
        const graph = this.loadGraph();
        graph.edges.push(edge);
        this.saveGraph(graph);
    }
}
