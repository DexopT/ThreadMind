import { Tool } from '../core/types';
import { GraphMemory } from '../memory/graph';

const graph = new GraphMemory();

export const memoryTools: Tool[] = [
    {
        name: 'add_graph_node',
        description: 'Adds a new node to the Directed Knowledge Graph for long-term relational memory.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Unique identifier for the node (e.g., UserId_Topic)' },
                label: { type: 'string', description: 'Type of node (e.g., User, Concept, Fact)' },
                content: { type: 'string', description: 'The actual semantic content or knowledge to store' }
            },
            required: ['id', 'label', 'content']
        },
        execute: async (args, context) => {
            if (!context.userId) return "Error: Missing user context.";
            const namespacedId = `${context.userId}_${args.id}`;
            graph.addNode({
                id: namespacedId,
                label: args.label,
                properties: { content: args.content, type: 'semantic', createdAt: Date.now(), owner: context.userId }
            });
            return `Successfully added node ${namespacedId} to Graph Memory.`;
        }
    },
    {
        name: 'add_graph_edge',
        description: 'Links two existing nodes in the Directed Knowledge Graph. Crucial for connecting concepts.',
        parameters: {
            type: 'object',
            properties: {
                sourceId: { type: 'string', description: 'ID of the source node' },
                targetId: { type: 'string', description: 'ID of the target node' },
                relation: { type: 'string', description: 'Relationship (e.g., LIKES, KNOWS, BELIEVES)' }
            },
            required: ['sourceId', 'targetId', 'relation']
        },
        execute: async (args, context) => {
            if (!context.userId) return "Error: Missing user context.";
            const namespacedSource = `${context.userId}_${args.sourceId}`;
            const namespacedTarget = `${context.userId}_${args.targetId}`;
            graph.addEdge({
                sourceId: namespacedSource,
                targetId: namespacedTarget,
                relation: args.relation
            });
            return `Successfully added edge ${args.relation} between ${namespacedSource} and ${namespacedTarget}.`;
        }
    }
];
