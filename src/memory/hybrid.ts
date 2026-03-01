import { Memory, MemoryEntry } from '../core/types';
import { SQLiteMemory } from './sqlite';
import { FileBasedMemory } from './file';
import { GraphMemory } from './graph';

export class HybridMemory implements Memory {
    public name = 'hybrid';

    private sqlite: SQLiteMemory;
    private file: FileBasedMemory;
    private graph: GraphMemory;

    constructor(namespace: string = 'global') {
        this.sqlite = new SQLiteMemory(namespace);
        this.file = new FileBasedMemory(namespace);
        this.graph = new GraphMemory(namespace);
    }

    async add(userId: string, content: string, type: MemoryEntry['type'] = 'episodic'): Promise<void> {
        // Route memory saving based on context/type
        if (type === 'episodic') {
            await this.file.add(userId, content, type); // OpenClaw daily log
            await this.sqlite.add(userId, content, type); // Vector search fallback (SQLite)
        } else if (type === 'semantic') {
            await this.graph.add(userId, content, type); // Directed knowledge graph
            await this.file.add(userId, content, type); // SOUL.md fallback
        } else if (type === 'core') {
            await this.file.add(userId, content, type); // MEMORY.md
            await this.sqlite.add(userId, content, type);
        }
    }

    async query(userId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
        // Query all memory subsystems and merge/deduplicate results
        const [sqliteRes, fileRes, graphRes] = await Promise.all([
            this.sqlite.query(userId, query, Math.ceil(limit / 3)),
            this.file.query(userId, query, Math.ceil(limit / 3)),
            this.graph.query(userId, query, Math.ceil(limit / 3))
        ]);

        const merged = [...sqliteRes, ...fileRes, ...graphRes];

        // Remove exact duplicates based on content
        const unique = merged.filter((v, i, a) => a.findIndex(t => (t.content === v.content)) === i);

        // Sort by recency/access logic
        return unique.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    }

    async consolidate(userId: string): Promise<void> {
        await Promise.all([
            this.sqlite.consolidate(userId),
            this.file.consolidate(userId),
            this.graph.consolidate(userId)
        ]);
    }

    public readAgentConfig(userId: string): Record<string, string> {
        return this.file.readAgentConfig(userId);
    }
}
