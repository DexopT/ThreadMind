import Database from 'better-sqlite3';
import { Memory, MemoryEntry } from '../core/types';
import path from 'path';
import fs from 'fs';

export class SQLiteMemory implements Memory {
    public name = 'sqlite';
    private db: any;

    constructor(namespace: string = 'global') {
        const dbPath = path.join(process.cwd(), 'data', 'memory', namespace, 'sqlite.db');
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.initSchema();
    }

    private initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                accessCount INTEGER DEFAULT 0
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='rowid');

            -- Ensure it's populated for existing DBs
            INSERT INTO memories_fts(rowid, content) 
            SELECT rowid, content FROM memories 
            WHERE rowid NOT IN (SELECT rowid FROM memories_fts);

            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
              INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
              INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
              INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
              INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
            END;

            CREATE INDEX IF NOT EXISTS idx_userId ON memories(userId);
            CREATE INDEX IF NOT EXISTS idx_type ON memories(type);
        `);
    }

    async add(userId: string, content: string, type: MemoryEntry['type'] = 'episodic'): Promise<void> {
        // Simple deduplication logic: if similar memory exists recently for same user, merge or ignore
        const existingstmt = this.db.prepare(`
            SELECT id, content, accessCount FROM memories 
            WHERE userId = ? AND type = ? AND content = ?
            LIMIT 1
        `);
        const existing = existingstmt.get(userId, type, content) as any;

        if (existing) {
            const updateStmt = this.db.prepare(`
                UPDATE memories SET accessCount = accessCount + 1, updatedAt = ? WHERE id = ?
            `);
            updateStmt.run(Date.now(), existing.id);
            return;
        }

        const stmt = this.db.prepare(`
            INSERT INTO memories (id, userId, content, type, createdAt, updatedAt, accessCount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            Date.now().toString() + Math.random().toString(36).substring(7),
            userId,
            content,
            type,
            Date.now(),
            Date.now(),
            1
        );
    }

    async query(userId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
        let results: MemoryEntry[] = [];
        const safeQuery = query.trim().replace(/"/g, '""'); // escape quotes

        if (!safeQuery) {
            // Fetch latest recent memories without filtering
            const stmt = this.db.prepare(`
                SELECT * FROM memories
                WHERE userId = ?
                ORDER BY updatedAt DESC
                LIMIT ?
            `);
            results = stmt.all(userId, limit) as MemoryEntry[];
        } else {
            // Full Text Search for contextual relevance
            const stmt = this.db.prepare(`
                SELECT m.* FROM memories m
                JOIN memories_fts f ON m.rowid = f.rowid
                WHERE m.userId = ? AND memories_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            `);
            results = stmt.all(userId, `"${safeQuery}"`, limit) as MemoryEntry[];
        }

        // Update access counts for retrieved memories (simulate tracking)
        if (results.length > 0) {
            const ids = results.map(r => r.id).join("','");
            this.db.exec(`UPDATE memories SET accessCount = accessCount + 1, updatedAt = ${Date.now()} WHERE id IN('${ids}')`);
        }

        return results;
    }

    async consolidate(userId: string): Promise<void> {
        // Decay logic: delete old memories that are rarely accessed
        // We define 'old' as > 30 days and accessCount < 3
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        const deleteStmt = this.db.prepare(`
            DELETE FROM memories 
            WHERE userId = ? AND updatedAt < ? AND accessCount < 3
            `);
        const info = deleteStmt.run(userId, thirtyDaysAgo);
        console.log(`[Memory] Decayed ${info.changes} old memories for user ${userId}`);

        // Merge duplicate logic (simulated by finding highly similar fragments, skipped here for simplicity but architecture supports it)
    }
}
