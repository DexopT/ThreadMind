import fs from 'fs/promises';
import path from 'path';
import { Provider, ToolContext } from '../core/types';
import { SkillGenerator, GeneratedSkill } from './generator';
import { AgentLoop } from '../agent/loop';
import { ControlPlane } from '../agent/controlPlane';
import { Tool } from '../core/types';

const SKILLS_DIR = path.join(process.cwd(), 'skills');

export interface SkillMeta {
    filename: string;
    name: string;
    purpose: string; // Extracted from the first "## Purpose" section
}

export class SkillManager {
    private generator: SkillGenerator;

    constructor(
        private providerFn: () => Provider,
        private allTools: Tool[]
    ) {
        this.generator = new SkillGenerator(providerFn);
    }

    // ─── Skill Discovery ─────────────────────────────────────────────────────

    /** List all skill files in the skills directory */
    async listSkills(): Promise<SkillMeta[]> {
        await fs.mkdir(SKILLS_DIR, { recursive: true }).catch(() => { });
        const files = await fs.readdir(SKILLS_DIR);
        const mdFiles = files.filter(f => f.endsWith('.md'));

        const metas: SkillMeta[] = [];
        for (const filename of mdFiles) {
            const content = await fs.readFile(path.join(SKILLS_DIR, filename), 'utf8').catch(() => '');
            const titleMatch = content.match(/^#\s+(.+)/m);
            const purposeMatch = content.match(/## Purpose\s*\n+(.+)/);
            metas.push({
                filename,
                name: filename.replace('.md', ''),
                purpose: purposeMatch ? purposeMatch[1].trim() : (titleMatch ? titleMatch[1].trim() : filename)
            });
        }
        return metas;
    }

    /** Format a /skill list response for Telegram */
    async formatList(): Promise<string> {
        const skills = await this.listSkills();
        if (skills.length === 0) {
            return `📂 *No skills installed yet.*\n\nAdd one with:\n\`/skill add <describe your skill>\``;
        }

        const lines = ['📚 *Installed Skills*\n'];
        for (const s of skills) {
            lines.push(`🔹 \`${s.name}\` — ${s.purpose}`);
        }
        lines.push(`\n_Run a skill:_ \`/skill <name> <task>\`\n_Add a skill:_ \`/skill add <description>\``);
        return lines.join('\n');
    }

    // ─── Skill Generation ────────────────────────────────────────────────────

    /**
     * AI-generate a skill from a user description.
     * Returns the draft — does NOT save yet (user must confirm).
     */
    async generatePreview(description: string): Promise<GeneratedSkill> {
        return this.generator.generate(description);
    }

    /** Save a previously generated skill to disk */
    async saveSkill(name: string, content: string): Promise<string> {
        await fs.mkdir(SKILLS_DIR, { recursive: true }).catch(() => { });
        const filename = `${name}.md`;
        const safePath = path.resolve(SKILLS_DIR, filename);

        // Guard against path traversal
        if (!safePath.startsWith(SKILLS_DIR)) {
            throw new Error('Invalid skill name.');
        }

        await fs.writeFile(safePath, content, 'utf8');
        return filename;
    }

    /** Delete a skill by name */
    async deleteSkill(name: string): Promise<boolean> {
        const safePath = path.resolve(SKILLS_DIR, `${name}.md`);
        if (!safePath.startsWith(SKILLS_DIR)) throw new Error('Invalid skill name.');
        try {
            await fs.unlink(safePath);
            return true;
        } catch {
            return false;
        }
    }

    // ─── Skill Editing ───────────────────────────────────────────────────────

    /** Load raw markdown content of a skill by name */
    async loadSkillContent(name: string): Promise<string | null> {
        const filename = name.endsWith('.md') ? name : `${name}.md`;
        const safePath = path.resolve(SKILLS_DIR, filename);
        if (!safePath.startsWith(SKILLS_DIR)) return null;
        try {
            return await fs.readFile(safePath, 'utf8');
        } catch {
            return null;
        }
    }

    /**
     * AI-edit an existing skill based on user instructions.
     * Returns a preview — does NOT save (user must confirm).
     */
    async editSkillPreview(skillName: string, editInstructions: string): Promise<GeneratedSkill | null> {
        const existing = await this.loadSkillContent(skillName);
        if (!existing) return null;
        return this.generator.refine(existing, editInstructions);
    }

    // ─── Skill Execution ─────────────────────────────────────────────────────

    /**
     * Run a skill by name with the given user task.
     * Loads the skill's markdown, injects it as a system prompt, and runs the agent loop.
     */
    async executeSkill(skillName: string, userTask: string, context: ToolContext): Promise<string> {
        // Resolve filename — accept with or without .md
        const filename = skillName.endsWith('.md') ? skillName : `${skillName}.md`;
        const safePath = path.resolve(SKILLS_DIR, filename);
        if (!safePath.startsWith(SKILLS_DIR)) throw new Error('Invalid skill name.');

        let skillContent: string;
        try {
            skillContent = await fs.readFile(safePath, 'utf8');
        } catch {
            const available = await this.listSkills();
            const names = available.map(s => `\`${s.name}\``).join(', ');
            return `❌ Skill \`${skillName}\` not found.\n\nAvailable: ${names || 'none yet'}.\nUse \`/skill add <description>\` to create one.`;
        }

        const controlPlane = new ControlPlane(this.allTools);
        const loop = new AgentLoop(this.providerFn, controlPlane);

        const messages = [
            {
                role: 'system' as const,
                content:
                    `You are executing the following skill procedure. Follow it precisely.\n\n` +
                    `--- SKILL ---\n${skillContent}\n--- END SKILL ---`
            },
            {
                role: 'user' as const,
                content: userTask
            }
        ];

        const history = await loop.run(messages, context, { thinkingLevel: 'low' }, 8);
        return history[history.length - 1].content;
    }
}
