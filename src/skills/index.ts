import fs from 'fs/promises';
import path from 'path';
import { Tool, ToolContext } from '../core/types';

export const loadSkills = async (): Promise<Tool[]> => {
    const skillsDir = path.join(process.cwd(), 'skills');
    await fs.mkdir(skillsDir, { recursive: true }).catch(() => { });

    return [
        {
            name: 'list_available_skills',
            description: 'Lists available .md skills. Use load_skill to read one and learn how to do complex tasks.',
            parameters: { type: 'object', properties: {} },
            execute: async () => {
                try {
                    const files = await fs.readdir(skillsDir);
                    const mdFiles = files.filter(f => f.endsWith('.md'));
                    if (mdFiles.length === 0) return 'No installed skills found.';
                    return `Available skills: \n${mdFiles.join('\n')}\nUse load_skill to read them.`;
                } catch (e: any) {
                    return `Error listing skills: ${e.message}`;
                }
            }
        },
        {
            name: 'load_skill',
            description: 'Loads the full content of a specific SKILL.md file into context. Use this ON-DEMAND when you need specific capabilities.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'The exact filename to load, e.g., web-scraper.md' }
                },
                required: ['filename']
            },
            execute: async (args: Record<string, any>, context: ToolContext) => {
                try {
                    const safePath = path.resolve(skillsDir, args.filename);
                    if (!safePath.startsWith(skillsDir)) throw new Error('Path traversal not allowed.');
                    const content = await fs.readFile(safePath, 'utf8');
                    return `[SKILL LOADED: ${args.filename}]\n\n${content}`;
                } catch (e: any) {
                    return `Error loading skill: ${e.message}`;
                }
            }
        },
        {
            name: 'create_skill',
            description: 'Writes a new .md skill file documenting a complex workflow you have successfully learned, so you can easily reuse it in the future without re-learning.',
            parameters: {
                type: 'object',
                properties: {
                    filename: { type: 'string', description: 'Name of the skill file, e.g., deploy-react-app.md' },
                    content: { type: 'string', description: 'Markdown content detailing exactly how to execute the skill step-by-step.' }
                },
                required: ['filename', 'content']
            },
            execute: async (args: Record<string, any>, context: ToolContext) => {
                try {
                    const safePath = path.resolve(skillsDir, args.filename);
                    if (!safePath.startsWith(skillsDir)) throw new Error('Path traversal not allowed.');
                    if (!args.filename.endsWith('.md')) throw new Error('Skill must be a .md file.');
                    await fs.writeFile(safePath, args.content, 'utf8');
                    return `Skill saved: ${args.filename}. You can now use load_skill to access it in future tasks.`;
                } catch (e: any) {
                    return `Error saving skill: ${e.message}`;
                }
            }
        }
    ];
};
