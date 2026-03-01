import { ChannelEvent, ToolContext, ProviderOptions, Tool, Message } from './types';
import { AgentComms } from '../agent/comms';
import { CommandParser } from '../ux/commands';
import { VibeCoding } from '../agent/vibe';
import { MeshWorkflow } from '../agent/mesh';
import { SwarmManager } from '../agent/swarm';
import { HybridMemory } from '../memory/hybrid';
import { loadPersonality, buildSystemPrompt } from './personality';
import { AgentLoop } from '../agent/loop';
import { providerManager } from '../providers';
import { ControlPlane } from '../agent/controlPlane';
import { metrics } from '../ux/metrics';
import * as fs from 'fs';
import * as path from 'path';

const SESSIONS_FILE = path.join(process.cwd(), 'data', 'gateway_sessions.json');

export class Gateway {
    private queues: Map<string, ChannelEvent[]> = new Map();
    private processing: Set<string> = new Set();
    public sessionId: string = 'default';

    /** Active abort controllers per user — allows /stop to cancel generation */
    private activeAborts: Map<string, AbortController> = new Map();

    /** Persistent conversation history per user session */
    private sessionHistory: Map<string, Message[]> = new Map();

    /** Track whether we've already shown the ProxyPal setup picker */
    private proxyPalSetupShown: boolean = false;

    constructor(
        private comms: AgentComms,
        private vibe: VibeCoding,
        private mesh: MeshWorkflow,
        private swarm: SwarmManager,
        private memory: HybridMemory,
        private allTools: Tool[],
        public options: ProviderOptions,
        private onPickerAction?: (chatId: string, action: string, options: ProviderOptions) => Promise<void>
    ) {
        this.loadSessions();
    }

    private loadSessions() {
        try {
            if (fs.existsSync(SESSIONS_FILE)) {
                const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
                for (const [userId, history] of Object.entries(data)) {
                    this.sessionHistory.set(userId, history as Message[]);
                }
                console.log(`[Gateway] Loaded chat history for ${Object.keys(data).length} sessions.`);
            }
        } catch (e: any) {
            console.error('[Gateway] Failed to load session history:', e.message);
        }
    }

    private saveSessions() {
        try {
            const dir = path.dirname(SESSIONS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const data: Record<string, Message[]> = {};
            for (const [userId, history] of this.sessionHistory.entries()) {
                data[userId] = history;
            }
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e: any) {
            console.error('[Gateway] Failed to save session history:', e.message);
        }
    }

    /** Abort any running generation for a user */
    public abortUser(userId: string): boolean {
        const controller = this.activeAborts.get(userId);
        if (controller) {
            controller.abort();
            this.activeAborts.delete(userId);
            return true;
        }
        return false;
    }

    /** Clear session history for a user */
    public clearSession(userId: string): void {
        this.sessionHistory.delete(userId);
        this.saveSessions();
    }

    public async handleEvent(event: ChannelEvent) {
        // Enforce strict serialization per user channel
        const queueId = `${event.id}:${event.senderId}`;

        if (!this.queues.has(queueId)) {
            this.queues.set(queueId, []);
        }

        this.queues.get(queueId)!.push(event);
        this.processQueue(queueId);
    }

    private async processQueue(queueId: string) {
        if (this.processing.has(queueId)) return;

        this.processing.add(queueId);
        const queue = this.queues.get(queueId)!;

        while (queue.length > 0) {
            const event = queue.shift()!;
            try {
                await this.processEvent(event);
            } catch (error: any) {
                console.error(`Error processing event for ${queueId}:`, error);
                // Escape markdown-breaking characters in error messages
                const safeMsg = (error.message || 'Unknown error')
                    .replace(/_/g, '\\_')
                    .replace(/`/g, '\\`')
                    .replace(/\*/g, '\\*');
                try {
                    await event.reply(`❌ Core Fault: ${safeMsg}`);
                } catch {
                    // If markdown still fails, send plain via catch in telegram.ts
                    await event.reply(`Error: ${error.message || 'Unknown error'}`);
                }
            }
        }

        this.processing.delete(queueId);
    }

    private async processEvent(event: ChannelEvent) {
        const stopTyping = await event.replyWithTyping();

        try {
            const sender = event.senderId;

            // Load Localized User Config from AGENTS.md
            const agentConfig = this.memory.readAgentConfig(sender);

            // Override Provider Options
            const activeOptions: ProviderOptions = {
                ...this.options,
                thinkingLevel: (agentConfig['THINKING_LEVEL'] as any) || this.options.thinkingLevel
            };

            // Instantiate isolated ControlPlane to prevent concurrent user budget corruption
            const maxToolCalls = parseInt(agentConfig['MAX_TOOL_LIMIT'] || '15', 10);
            const userControlPlane = new ControlPlane(this.allTools, {
                maxToolCallsPerSession: maxToolCalls,
                maxTokensPerSession: 8000
            });

            // Check slash commands first
            const cmdResult = await CommandParser.handle(event, activeOptions, this);
            if (cmdResult === true) {
                return; // Handled internally
            } else if ((cmdResult as any)?.action === 'CLEAR_CACHE_AND_SESSION') {
                this.clearSession(sender);
                this.sessionId = Date.now().toString();
                this.comms.getSessions().delete(this.sessionId);

                // --- RAM Cleanup (Dynamic Reloading) ---
                // Only clear modules loaded from /src/ so we don't accidentally unload node_modules or core node internals
                const srcPathMatch = path.join(process.cwd(), 'src');
                let clearedCount = 0;

                for (const key of Object.keys(require.cache)) {
                    // Do not purge index, gateway, or browser-server to preserve execution context and WebSocket connections
                    if (key.includes(srcPathMatch) &&
                        !key.endsWith('index.ts') &&
                        !key.endsWith('gateway.ts') &&
                        !key.endsWith('browser-server.ts')) {
                        delete require.cache[key];
                        clearedCount++;
                    }
                }

                console.log(`[Cache Busting] Cleared ${clearedCount} internal modules from RAM (Session reset by ${sender}).`);
                return;
            } else if ((cmdResult as any)?.action === 'COMPACT_MEMORY') {
                await this.memory.consolidate(sender);
                await event.reply('Memory compacted and decayed.');
                return;
            } else if ((cmdResult as any)?.action?.startsWith('SHOW_')) {
                // Delegate to the picker callback (inline keyboards)
                if (this.onPickerAction) {
                    await this.onPickerAction(sender, (cmdResult as any).action, activeOptions);
                }
                return;
            }

            // ProxyPal first-run model selection
            if (providerManager.pendingProxyPalSetup && !this.proxyPalSetupShown) {
                this.proxyPalSetupShown = true;
                if (this.onPickerAction) {
                    await this.onPickerAction(sender, 'SHOW_PROXYPAL_MODEL_PICKER', activeOptions);
                }
            }

            // Define Tool Context
            const ctx: ToolContext = {
                sendMessage: async (text: string) => { await event.reply(text); },
                event: event,
                userId: sender
            };

            // Vibe Coding Intercept Loop
            if (event.content.trim() === '/vibe') {
                const initMsg = this.vibe.start();
                await event.reply(initMsg);
                return;
            } else if (event.content.trim().startsWith('/vibe ')) {
                await event.reply('Usage: `/vibe` (no arguments required to start)');
                return;
            }

            if (this.vibe.isActive) {
                const vibeResponse = await this.vibe.processInput(event.content, ctx);
                await event.reply(vibeResponse);
                return;
            }

            // Hook Mesh workflow separately
            if (event.content.trim().startsWith('/mesh')) {
                const goal = event.content.trim().substring(5).trim();
                if (!goal) {
                    await event.reply('⚠️ Usage: `/mesh <goal>`');
                    return;
                }
                const result = await this.mesh.runGoal(goal, ctx);
                await event.reply(`🕸️ **Mesh Workflow Result:**\n${result}`);
                return;
            }

            // Hook Swarm separately
            if (event.content.trim().startsWith('/swarm')) {
                const parts = event.content.trim().split(' ').filter(Boolean);
                const validRoles = this.swarm.getAvailableRoles();
                if (parts.length < 3) {
                    await event.reply(`⚠️ Usage: \`/swarm <${validRoles.join('|')}> <task>\``);
                    return;
                }
                const role = parts[1];
                const task = parts.slice(2).join(' ');

                if (validRoles.includes(role)) {
                    await event.reply(`🐝 Spawning ${role} swarm...`);
                    const result = await this.swarm.spawn(role, task, ctx);
                    await event.reply(`🐝 **Swarm Result (${role}):**\n${result}`);
                    return;
                } else {
                    await event.reply(`⚠️ Invalid role. Available: ${validRoles.join(', ')}.\nUsage: \`/swarm <role> <task>\``);
                    return;
                }
            }

            // Normal Flow: Save Memory -> Build Context -> Generate Response
            await this.memory.add(sender, event.content, 'episodic');

            // Build conversation messages with persistent session history
            const recentMems = await this.memory.query(sender, '', 10);
            let contextStr = recentMems.map((m: any) => `[Mem] ${m.content}`).join('\n');
            if (contextStr.length > 1500) contextStr = contextStr.substring(0, 1500) + '...';
            const systemMessage: Message = { role: 'system', content: buildSystemPrompt(loadPersonality(sender), contextStr, ctx) };

            // Get or initialize session history for this user
            if (!this.sessionHistory.has(sender)) {
                this.sessionHistory.set(sender, []);
            }
            const history = this.sessionHistory.get(sender)!;

            // Append user message to session
            history.push({ role: 'user', content: event.content });
            this.saveSessions();

            // Cap history to prevent infinite growth (keep last 60 items)
            // Increased from 40 to accommodate tool messages
            const MAX_HISTORY = 60;
            if (history.length > MAX_HISTORY) {
                // Find a safe spot to truncate (don't split tool call and its result)
                let truncateIndex = history.length - MAX_HISTORY;
                while (truncateIndex < history.length && history[truncateIndex].role === 'tool') {
                    truncateIndex++;
                }
                history.splice(0, truncateIndex);
            }

            // Build full message list: system prompt + session history
            const messages: Message[] = [systemMessage, ...history];

            // Create abort controller for this generation
            const abortController = new AbortController();
            this.activeAborts.set(sender, abortController);

            const dynamicLoop = new AgentLoop(() => providerManager.getActive(), userControlPlane);

            try {
                const resultHistory = await dynamicLoop.run(messages, ctx, activeOptions, 30, abortController.signal);

                // Extract new messages added by the agent loop (everything after our input)
                const newMessages = resultHistory.slice(messages.length);

                // Add assistant and tool messages to persistent session history
                for (const msg of newMessages) {
                    if (msg.role === 'assistant' || msg.role === 'tool') {
                        const cloned = { ...msg };

                        // Sanitize content to prevent history bloat
                        if (cloned.content && cloned.content.length > 5000) {
                            cloned.content = cloned.content.substring(0, 5000) + '... [truncated for context efficiency]';
                        }

                        // Don't save completely empty messages unless they have tool_calls
                        if ((!cloned.content || cloned.content.trim() === '') && (!cloned.tool_calls || cloned.tool_calls.length === 0)) {
                            continue;
                        }
                        history.push(cloned);
                    }
                }
                this.saveSessions();

                // Find the last assistant message for the final reply
                const responseMessage = resultHistory[resultHistory.length - 1];

                // Inject metrics
                const providerReqs = Math.floor(resultHistory.length / 2);
                metrics.track({ message: responseMessage, usage: { promptTokens: 100 * providerReqs, completionTokens: 50 * providerReqs, totalTokens: 150 * providerReqs } });

                await this.memory.add(sender, responseMessage.content, 'core');

                // Sanitize: last-resort cleanup for any raw tool-call syntax that leaked through.
                let replyText = responseMessage.content || "Agent produced no output.";
                replyText = replyText.replace(/<function=[\s\S]*?<\/function>/g, '');
                replyText = replyText.replace(/<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/g, '');
                replyText = replyText.replace(/\[TOOL_CALLS\]\s*\[[\s\S]*?\]/g, '');
                replyText = replyText.replace(/<\/?tool_call>/g, '');
                replyText = replyText.replace(/<function=.*$/gm, '');
                replyText = replyText.trim();
                if (!replyText) replyText = "⚙️ The model attempted to use a tool but the request was malformed. Please try again.";

                await event.reply(replyText);

            } finally {
                // Always clean up the abort controller
                this.activeAborts.delete(sender);
            }

        } finally {
            stopTyping();
        }
    }
}
