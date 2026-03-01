import fs from 'fs';
import path from 'path';
import { Provider, ToolContext } from '../core/types';

export class VibeCoding {
    private active = false;
    private dialogBuffer: string[] = [];

    constructor(private providerFn: () => Provider) { }

    get isActive() { return this.active; }

    start() {
        this.active = true;
        this.dialogBuffer = [];
        return "🏎️ [VIBE CODING MODE ACTIVATED]. I AM TAKING THE WHEEL. ANSWER MY QUESTIONS RAPIDLY. WHAT ARE WE BUILDING?";
    }

    stop() {
        this.active = false;
        this.dialogBuffer = [];
        return "🛑 [VIBE CODING MODE DEACTIVATED]. Returning control back to you.";
    }

    async processInput(input: string, context: ToolContext): Promise<string> {
        if (input.trim().toLowerCase() === '/stopvibe' || input.toLowerCase() === 'stop') {
            return this.stop();
        }

        this.dialogBuffer.push(`User: ${input}`);

        const systemPrompt = `You are in VIBE CODING MODE. This is a highly urgent, prompt-driven mode where you have seized control.
You MUST:
1. Analyze the user's initial request and IMMEDIATELY ask ALL necessary architectural questions, required dependencies, and missing context in a single, comprehensive numbered list.
2. ALWAYS print your questions/demands in ALL CAPS to indicate urgency and dominance of the session.
3. Be extremely brief and direct. Do not wait for pleasantries.
4. Do not ask questions one-by-one. Batch them to save time. When all are answered, emit the final script or code files.
5. IF writing a project with multiple files, output EACH file in a Markdown code block with its exact relative filepath directly above the block. For example:
### src/index.js
\`\`\`javascript
...code...
\`\`\`

Context so far:
${this.dialogBuffer.join('\n')}
`;

        const response = await this.providerFn().generateResponse([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Generate your next urgent response.' }
        ]);

        const reply = response.message.content;
        this.dialogBuffer.push(`Agent: ${reply}`);

        // Look for code blocks prefixed by a file path
        const fileMatchRegex = /(?:###|##|\*\*)\s*([a-zA-Z0-9_\-\.\/]+)\s*(?:\*\*|)?\s*\n```[a-zA-Z]*\n([\s\S]*?)```/g;
        let match;
        const filesToZip: { path: string, content: string }[] = [];
        const codeBlockMatches: string[] = [];

        while ((match = fileMatchRegex.exec(reply)) !== null) {
            filesToZip.push({ path: match[1].trim(), content: match[2] });
            codeBlockMatches.push(match[0]);
        }

        // If files were generated, automatically bundle and upload them
        if (filesToZip.length > 0 && context.event?.replyWithDocument) {
            try {
                const vibeDir = path.join(process.cwd(), 'data', 'vibe_exports', `vibe_${Date.now()}`);
                fs.mkdirSync(vibeDir, { recursive: true });

                for (const file of filesToZip) {
                    const fullPath = path.join(vibeDir, file.path);
                    const fileDir = path.dirname(fullPath);
                    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
                    fs.writeFileSync(fullPath, file.content, 'utf-8');
                }

                // Zip the directory (Requires 'zip' on the host, or JS zip library. We'll use child_process for ease)
                const zipPath = `${vibeDir}.zip`;
                const { execSync } = require('child_process');
                // Cross-platform zip using powershell on Windows, or standard zip on Unix
                if (process.platform === 'win32') {
                    execSync(`powershell Compress-Archive -Path "${vibeDir}\\*" -DestinationPath "${zipPath}" -Force`);
                } else {
                    execSync(`cd "${vibeDir}" && zip -r "${zipPath}" ./*`);
                }

                await context.event.replyWithDocument(zipPath);

                // Strip the exact code blocks from the text to save space in the chat
                let cleanReply = reply;
                for (const matchStr of codeBlockMatches) {
                    cleanReply = cleanReply.replace(matchStr, '');
                }

                return `⚡ I have generated the code and beamed the project zip file directly to your device.\n\n${cleanReply.trim()}`;
            } catch (err: any) {
                console.error("Vibe Coding Zip Error:", err);
                return `⚡ ${reply}\n\n[Warning: Failed to automatically build zip file: ${err.message}]`;
            }
        }

        return `⚡ ${reply}`;
    }
}
