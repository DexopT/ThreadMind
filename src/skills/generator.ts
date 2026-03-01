import { Provider } from '../core/types';

/** The result of a skill generation pass */
export interface GeneratedSkill {
    /** Suggested filename (slugified, no extension) */
    name: string;
    /** Full markdown content ready to save */
    content: string;
}

const SKILL_SYSTEM_PROMPT = `You are a Skill Architect for an AI agent called ThreadMind.
Your job is to convert a user's plain-language description of a workflow into a structured, reusable SKILL.md file.

A skill file must follow this exact markdown format:

# <Skill Title>

## Purpose
<One sentence explaining what this skill does>

## When to Use
<Bullet list of triggers or conditions that activate this skill>

## Procedure
<Numbered, step-by-step instructions the agent must follow. Be extremely specific. Reference actual tools where relevant: read_file, write_file, run_shell_command, run_docker_command, web_search_free, recall_memory, etc.>

## Output Format
<Describe the expected shape of the final response to the user>

## Tips
<Optional: edge cases, caveats, or performance hints>

Rules:
- Be highly specific and procedural. Avoid vague language.
- Reference real ThreadMind tools by name where applicable.
- The "Procedure" section should be self-contained; the agent should need no additional context to follow it.
- Return ONLY the raw markdown content. No preamble, no code fences, no extra commentary.`;

export class SkillGenerator {
    constructor(private providerFn: () => Provider) { }

    /**
     * Generate a skill from a user description.
     * Returns a preview of the generated content plus a suggested filename.
     */
    async generate(description: string): Promise<GeneratedSkill> {
        const response = await this.providerFn().generateResponse(
            [
                { role: 'system', content: SKILL_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Generate a skill file for the following workflow:\n\n"${description}"`
                }
            ],
            [],
            { thinkingLevel: 'low' }
        );

        const rawContent = response.message.content.trim();

        // Auto-derive a filename from the first H1 heading, falling back to a slug of the description
        const titleMatch = rawContent.match(/^#\s+(.+)/m);
        const title = titleMatch ? titleMatch[1].trim() : description;
        const name = SkillGenerator.slugify(title);

        return { name, content: rawContent };
    }

    /**
     * Refine an existing skill based on user edit instructions.
     * Preserves structure, applies targeted changes.
     */
    async refine(existingContent: string, editInstructions: string): Promise<GeneratedSkill> {
        const response = await this.providerFn().generateResponse(
            [
                {
                    role: 'system',
                    content: SKILL_SYSTEM_PROMPT + '\n\nYou are EDITING an existing skill. Apply the user\'s requested changes while preserving the overall structure. Return the FULL updated skill markdown.'
                },
                {
                    role: 'user',
                    content: `Here is the existing skill:\n\n${existingContent}\n\n---\n\nApply these changes:\n${editInstructions}`
                }
            ],
            [],
            { thinkingLevel: 'low' }
        );

        const rawContent = response.message.content.trim();
        const titleMatch = rawContent.match(/^#\s+(.+)/m);
        const title = titleMatch ? titleMatch[1].trim() : 'edited-skill';
        const name = SkillGenerator.slugify(title);

        return { name, content: rawContent };
    }

    /** Convert a title to a safe snake-case filename slug */
    static slugify(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')   // strip special chars
            .trim()
            .replace(/[\s-]+/g, '-')          // spaces/hyphens → single hyphen
            .substring(0, 60);                // cap length
    }
}
