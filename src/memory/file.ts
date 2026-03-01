import fs from 'fs';
import path from 'path';
import { Memory, MemoryEntry } from '../core/types';

export class FileBasedMemory implements Memory {
    public name = 'openclaw-file';
    private baseDir: string;

    constructor(namespace: string = 'global') {
        this.baseDir = path.join(process.cwd(), 'data', 'memory', namespace);
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    private getFilePath(userId: string, type: string): string {
        const userDir = path.join(this.baseDir, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        if (type === 'core') return path.join(userDir, 'MEMORY.md');
        if (type === 'semantic') return path.join(userDir, 'SOUL.md');

        // Episodic: daily log
        const dateStr = new Date().toISOString().split('T')[0];
        return path.join(userDir, `${dateStr}.md`);
    }

    async add(userId: string, content: string, type: MemoryEntry['type'] = 'episodic'): Promise<void> {
        const filePath = this.getFilePath(userId, type);
        const timestamp = new Date().toISOString();
        const entry = `- [${timestamp}] ${content}\n`;

        fs.appendFileSync(filePath, entry, 'utf8');
    }

    async query(userId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
        const userDir = path.join(this.baseDir, userId);
        if (!fs.existsSync(userDir)) return [];

        const files = fs.readdirSync(userDir).filter(f => f.endsWith('.md'));
        const results: MemoryEntry[] = [];

        for (const file of files) {
            const filePath = path.join(userDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim() !== '');

            for (const line of lines) {
                if (line.toLowerCase().includes(query.toLowerCase())) {
                    results.push({
                        id: Math.random().toString(36).substring(7),
                        userId,
                        content: line,
                        type: file === 'MEMORY.md' ? 'core' : file === 'SOUL.md' ? 'semantic' : 'episodic',
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        accessCount: 1
                    });
                }
            }
        }

        // Sort by recency (assuming logs are chronological)
        return results.reverse().slice(0, limit);
    }

    public readAgentConfig(userId: string): Record<string, string> {
        const userDir = path.join(this.baseDir, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        const configPath = path.join(userDir, 'AGENTS.md');
        if (!fs.existsSync(configPath)) {
            const defaultYaml = `MAX_TOOL_LIMIT: 20\nTHINKING_LEVEL: medium\n`;
            fs.writeFileSync(configPath, defaultYaml, 'utf8');
            return { MAX_TOOL_LIMIT: '20', THINKING_LEVEL: 'medium' };
        }

        const content = fs.readFileSync(configPath, 'utf8');
        const config: Record<string, string> = {};

        content.split('\n').filter(l => l.includes(':')).forEach(line => {
            const [key, ...vals] = line.split(':');
            config[key.trim().toUpperCase()] = vals.join(':').trim();
        });

        return config;
    }

    async consolidate(userId: string): Promise<void> {
        // Compact episodic logs into MEMORY.md
        console.log(`[FileMemory] Consolidation triggered for user ${userId}.`);

        const userDir = path.join(this.baseDir, userId);
        if (!fs.existsSync(userDir)) return;

        const files = fs.readdirSync(userDir).filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/));

        // Delete logs older than 30 days to free up file bloat
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        let deleted = 0;
        for (const file of files) {
            if (file.replace('.md', '') < thirtyDaysAgo) {
                fs.unlinkSync(path.join(userDir, file));
                deleted++;
            }
        }
        if (deleted > 0) console.log(`[FileMemory] Decayed ${deleted} old episodic logs for user ${userId}`);
    }
}
