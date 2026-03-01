// src/features/memory/types.ts
// Agent Memory with Forgetting Curves — Type Definitions

export type MemoryType = 'episodic' | 'semantic' | 'procedural';

export interface MemoryEntry {
    id: string;
    content: string;
    embedding?: number[];
    memoryType: MemoryType;
    strength: number;                  // 0.0 - 1.0
    stability: number;                 // Higher = slower decay
    retrievalCount: number;
    lastRetrievedAt: number;
    createdAt: number;
    taskIds: string[];
    sessionIds: string[];
    channelTypes: string[];            // Channels where this memory is relevant
    tags: string[];
    isConsolidated: boolean;
}

// Implement this interface for any vector DB (Chroma, Pinecone, Qdrant, pgvector, etc.)
export interface VectorBackend {
    upsert(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void>;
    query(embedding: number[], topK: number): Promise<Array<{ id: string; score: number }>>;
    delete(id: string): Promise<void>;
}
