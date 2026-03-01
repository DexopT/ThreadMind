// src/features/memory/memory-store.ts
// Agent Memory with Forgetting Curves — Ebbinghaus-inspired memory store

import { randomUUID } from 'crypto';
import { LLMProvider } from '../../core/llm/types';
import { MemoryEntry, MemoryType, VectorBackend } from './types';

const DECAY_CONSTANT = 0.1;
const RETRIEVAL_BOOST = 0.15;
const CONSOLIDATION_THRESHOLD = 50;
const ARCHIVE_THRESHOLD = 0.1;

export class MemoryStore {
    private memories = new Map<string, MemoryEntry>();
    private episodicCount = 0;

    constructor(
        private readonly vectorBackend: VectorBackend,
        private readonly llmProvider: LLMProvider,
        private readonly embedFn: (text: string) => Promise<number[]>
    ) { }

    async store(
        content: string,
        opts: { memoryType?: MemoryType; taskId?: string; sessionId?: string; channelType?: string; tags?: string[]; stability?: number } = {}
    ): Promise<MemoryEntry> {
        const embedding = await this.embedFn(content);
        const entry: MemoryEntry = {
            id: randomUUID(), content, embedding,
            memoryType: opts.memoryType ?? 'episodic',
            strength: 1.0, stability: opts.stability ?? 0.5,
            retrievalCount: 0, lastRetrievedAt: Date.now(), createdAt: Date.now(),
            taskIds: opts.taskId ? [opts.taskId] : [],
            sessionIds: opts.sessionId ? [opts.sessionId] : [],
            channelTypes: opts.channelType ? [opts.channelType] : [],
            tags: opts.tags ?? [], isConsolidated: false,
        };
        this.memories.set(entry.id, entry);
        await this.vectorBackend.upsert(entry.id, embedding, { content, memoryType: entry.memoryType });

        if (entry.memoryType === 'episodic') {
            this.episodicCount++;
            if (this.episodicCount >= CONSOLIDATION_THRESHOLD) await this.consolidate();
        }
        return entry;
    }

    async retrieve(query: string, opts: { topK?: number; minStrength?: number } = {}): Promise<MemoryEntry[]> {
        const topK = opts.topK ?? 5;
        const minStrength = opts.minStrength ?? 0.2;
        const queryEmbedding = await this.embedFn(query);
        const matches = await this.vectorBackend.query(queryEmbedding, topK * 2);
        const now = Date.now();
        const results: MemoryEntry[] = [];

        for (const match of matches) {
            const entry = this.memories.get(match.id);
            if (!entry) continue;
            const strength = this.computeStrength(entry, now);
            if (strength < minStrength) continue;
            entry.strength = Math.min(1.0, strength + RETRIEVAL_BOOST);
            entry.retrievalCount++;
            entry.lastRetrievedAt = now;
            results.push(entry);
            if (results.length >= topK) break;
        }
        return results;
    }

    computeStrength(entry: MemoryEntry, now: number): number {
        // Ebbinghaus: R = S * e^(-t / (stability * 10))
        const tHours = (now - entry.lastRetrievedAt) / (1000 * 60 * 60);
        return entry.strength * Math.exp(-DECAY_CONSTANT * tHours / (entry.stability * 10));
    }

    async decayAll(): Promise<void> {
        const now = Date.now();
        const toArchive: string[] = [];
        for (const [id, entry] of this.memories) {
            entry.strength = this.computeStrength(entry, now);
            if (entry.strength < ARCHIVE_THRESHOLD) toArchive.push(id);
        }
        for (const id of toArchive) {
            this.memories.delete(id);
            await this.vectorBackend.delete(id);
        }
    }

    async consolidate(): Promise<void> {
        const episodic = [...this.memories.values()].filter(m => m.memoryType === 'episodic' && !m.isConsolidated);
        if (episodic.length < 5) return;

        const groups = this.clusterByTags(episodic);
        for (const group of groups) {
            if (group.length < 3) continue;
            const contentList = group.map(m => `- ${m.content}`).join('\n');
            const summary = await this.llmProvider.complete({
                messages: [{ role: 'user', content: `Compress these episodic memories into ONE concise semantic summary:\n${contentList}` }],
                maxTokens: 150, temperature: 0.1,
            });
            await this.store(summary.content, { memoryType: 'semantic', stability: 0.8, tags: [...new Set(group.flatMap(m => m.tags))] });
            group.forEach(m => { m.isConsolidated = true; });
        }
        this.episodicCount = 0;
    }

    private clusterByTags(memories: MemoryEntry[]): MemoryEntry[][] {
        const map = new Map<string, MemoryEntry[]>();
        for (const m of memories) {
            const key = m.tags.sort().join(',') || 'untagged';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(m);
        }
        return [...map.values()];
    }
}
