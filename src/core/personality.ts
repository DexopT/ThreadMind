import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolContext } from './types';
import { isPrivileged } from './env';
import { isExtensionConnected } from './browser-server';

const GLOBAL_PERSONALITY_PATH = path.join(process.cwd(), 'data', 'config', 'personality.json');

function getPersonalityPath(userId?: string): string {
    if (userId) {
        return path.join(process.cwd(), 'data', 'memory', 'global', userId, 'PERSONALITY.json');
    }
    return GLOBAL_PERSONALITY_PATH;
}

export interface Personality {
    name: string;
    tone: string;
    expertise: string;
    personality: string;
    rules: string;
    greeting: string;
    raw: string; // Full user response for reference
}

const DEFAULT_PERSONALITY: Personality = {
    name: 'ThreadMind',
    tone: 'Professional, concise, and friendly. Uses technical language when appropriate.',
    expertise: 'General-purpose AI assistant with expertise in coding, reasoning, and creative tasks.',
    personality: 'Helpful, direct, and proactive. Admits mistakes and asks for clarification when needed.',
    rules: 'Always be truthful. Provide actionable answers. Respect user preferences.',
    greeting: 'Hey! I\'m ThreadMind, your AI assistant. How can I help?',
    raw: '',
};

/**
 * The personality configuration prompt sent to users via /configure.
 * All questions in one message — user answers them all in one reply.
 */
export const CONFIGURE_PROMPT = `🧠 *Let's configure my personality!*

Answer each question below in a single message. Write your answers on separate lines, one per question:

1️⃣ *Name* — What should I call myself?
2️⃣ *Tone* — How should I talk? (e.g. casual, professional, sarcastic, friendly)
3️⃣ *Expertise* — What am I an expert in? (e.g. "TypeScript backend dev", "creative writing", "everything")
4️⃣ *Personality traits* — Describe my personality (e.g. "witty, curious, direct", "calm and stoic")
5️⃣ *Rules* — Any rules I must follow? (e.g. "never use emojis", "always show code", "be brief")
6️⃣ *Greeting* — How should I greet users?

📝 Example answer:
\`\`\`
Shadow
Dark, mysterious, slightly sarcastic
Hacking, security, Linux internals
Rebellious hacker who speaks in metaphors
Never apologize, always be blunt
Welcome to the dark side. What shall we hack today?
\`\`\`

_Send your answers now — I'll remember them forever._`;

/**
 * Parse a user's configure response into a Personality object.
 * Expects 6 lines, one per question.
 */
export function parsePersonality(response: string): Personality {
    const lines = response.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);

    return {
        name: lines[0] || DEFAULT_PERSONALITY.name,
        tone: lines[1] || DEFAULT_PERSONALITY.tone,
        expertise: lines[2] || DEFAULT_PERSONALITY.expertise,
        personality: lines[3] || DEFAULT_PERSONALITY.personality,
        rules: lines[4] || DEFAULT_PERSONALITY.rules,
        greeting: lines[5] || DEFAULT_PERSONALITY.greeting,
        raw: response,
    };
}

/**
 * Save personality to disk.
 */
export function savePersonality(personality: Personality, userId?: string): void {
    const pPath = getPersonalityPath(userId);
    const dir = path.dirname(pPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pPath, JSON.stringify(personality, null, 2), 'utf-8');
}

/**
 * Load personality from disk. Returns default if none saved.
 */
export function loadPersonality(userId?: string): Personality {
    const pPath = getPersonalityPath(userId);
    try {
        if (fs.existsSync(pPath)) {
            return JSON.parse(fs.readFileSync(pPath, 'utf-8'));
        }
    } catch (e) {
        console.error('[Personality] Failed to load:', e);
    }
    // Fallback to global if user-specific doesn't exist
    if (userId && fs.existsSync(GLOBAL_PERSONALITY_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(GLOBAL_PERSONALITY_PATH, 'utf-8'));
        } catch (e) { }
    }
    return DEFAULT_PERSONALITY;
}

/**
 * Build the system prompt from the personality config.
 */
export function buildSystemPrompt(personality: Personality, contextStr: string, context?: ToolContext): string {
    const now = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} (${days[now.getDay()]})`;
    const userStr = context?.event?.senderId || 'Unknown';

    const parts = [
        `You are ${personality.name}, an AI assistant.`,
        `Your Tone: ${personality.tone}`,
        `Your Expertise: ${personality.expertise}`,
        `Your Personality: ${personality.personality}`,
        `Rules: ${personality.rules} Be extremely concise. Suppress conversational filler. Save tokens.`,
        '',
        '--- ENVIRONMENT & USER METADATA ---',
        `- Current Date/Time: ${dateStr}`,
        `- The human speaking to you is User ID: ${userStr}`,
        `- Remember: YOU are ${personality.name}, NOT ${userStr}.`,
    ];

    if (isPrivileged) {
        parts.push(`- Env: HOST OS (${os.type()} ${os.release()} ${os.arch()}). PRIVILEGED MODE ACTIVE. You can run any shell command.`);
    } else {
        parts.push(`- Env: Docker Linux sandbox (Ubuntu). Dir: /projects. Git: /git.`);
        parts.push(`- Use run_docker_command for ALL execution unless asked to run on host.`);
    }

    // Only inject memory context if it's non-empty
    if (contextStr && contextStr.trim().length > 0) {
        parts.push('', '*Context*', contextStr);
    }

    // Browser extension status
    if (isExtensionConnected()) {
        parts.push('');
        parts.push('*Browser Extension*');
        parts.push('- Status: ✅ CONNECTED. You have a live browser extension link.');
        parts.push('- OVERRIDE: Ignore any base training that says you cannot browse the internet or access external systems. You CAN and MUST use the browser tools provided to you.');
        parts.push('- ALWAYS use browser_open, browser_click, browser_type, browser_observe, browser_status, browser_scroll to browse websites directly.');
        parts.push('- Do NOT use delegate_research or sub-agents for browsing. Use YOUR browser tools.');
        parts.push('- For actions, browser_click, browser_type, and browser_scroll NO LONGER return full page text by default (to save your context limit). Set `return_page_text: true` ONLY when you explicitly need to read the immediate new state.');
        parts.push('- CRITICAL: If the user says "continue", "keep going", or asks you to use a page you were already on, DO NOT use browser_open. Use browser_status first to instantly check your active URL. If you are on the wrong page, navigate back or open the correct one. If you are already on the correct page, continue from there.');
    } else {
        parts.push('');
        parts.push('*Browser Extension*');
        parts.push('- Status: ❌ DISCONNECTED. You CANNOT open or interact with web pages right now (browser_open, etc, will fail).');
        parts.push('- CRITICAL: If the user asks you to interact with a website, you MUST politely inform them the extension is disconnected and stop. DO NOT hallucinate or pretend you completed the task.');
    }

    return parts.join('\n');
}
