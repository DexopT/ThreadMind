import { env } from './core/env';

import { providerManager } from './providers';
import { TelegramChannel } from './channels/telegram';
import { HybridMemory } from './memory/hybrid';
import { AgentLoop } from './agent/loop';
import { SwarmManager } from './agent/swarm';
import { AgentComms } from './agent/comms';
import { MeshWorkflow } from './agent/mesh';
import { VibeCoding } from './agent/vibe';
import { DoctorAgent } from './agent/doctor';
import { ControlPlane } from './agent/controlPlane';
import { CommandParser } from './ux/commands';
import { metrics } from './ux/metrics';
import { SkillManager } from './skills/manager';

// Tools
import { shellTool } from './tools/shell';
import { fsTools } from './tools/fs';
import { delegateResearchTool } from './tools/research';
import { memoryTools } from './tools/memory';
import { schedulerTools } from './tools/scheduler';
import { webhookTools } from './tools/webhook';
import { ragTools } from './tools/rag';
import { loadMCPServers } from './tools/mcp';
import { loadSkills } from './skills';
import { runDockerCommandTool, listDockerDistrosTool, ensureDefaultDistro } from './tools/docker';
import { guiBrowserTools } from './tools/browser';
import { systemTools } from './tools/system';

import { HeartbeatSystem } from './proactive/heartbeat';
import { SmartRecommender } from './proactive/recommend';
import { ProviderOptions, ToolContext } from './core/types';
import { ProxyPalProvider } from './providers/proxypal';

async function bootstrap() {
    console.log("Booting ThreadMind AI Agent...");
    providerManager.init();

    // Initialize ProxyPal (async: detects local proxy, fetches models)
    await providerManager.initProxyPal();

    // 1. Initialize Memory
    const memory = new HybridMemory();

    // 2. Load Tools & Skills dynamically
    const mcpTools = await loadMCPServers();
    const skillsTools = await loadSkills();

    const allTools = [
        shellTool,
        runDockerCommandTool,
        listDockerDistrosTool,
        ...fsTools,
        delegateResearchTool,
        ...memoryTools,
        ...schedulerTools,
        ...webhookTools,
        ...ragTools,
        ...mcpTools,
        ...skillsTools,
        ...guiBrowserTools,
        ...systemTools
    ];

    console.log(`✅ Loaded ${allTools.length} tools/skills.`);

    // 2.5 Ensure Docker is ready
    await ensureDefaultDistro();

    // 3. Initialize Agent Architectures
    const controlPlane = new ControlPlane(allTools);
    const loop = new AgentLoop(() => providerManager.getActive(), controlPlane);
    const swarm = new SwarmManager(() => providerManager.getActive(), allTools);
    const comms = new AgentComms(() => providerManager.getActive(), loop);
    const mesh = new MeshWorkflow(() => providerManager.getActive(), loop);
    const vibe = new VibeCoding(() => providerManager.getActive());

    // 3.5 Initialize Skill Manager and inject into CommandParser
    const skillManager = new SkillManager(() => providerManager.getActive(), allTools);
    CommandParser.setSkillManager(skillManager);

    // 4. Initialize Channel
    const telegramToken = env.TELEGRAM_BOT_TOKEN;
    if (!telegramToken || telegramToken === 'your_telegram_bot_token_here') {
        console.error("❌ TELEGRAM_BOT_TOKEN not set or invalid in .env");
        process.exit(1);
    }
    const channel = new TelegramChannel(telegramToken);

    // 5. Initialize Proactive Systems
    const recommender = new SmartRecommender(memory, () => providerManager.getActive());
    const doctor = new DoctorAgent();

    const heartbeat = new HeartbeatSystem(async (context) => {
        // Run Doctor Agent on all active sessions
        for (const [sessionId, msgs] of comms.getSessions()) {
            const diagnosis = doctor.analyze(msgs);
            if (diagnosis.isStuck && diagnosis.recoveryPrompt) {
                console.warn(`[Doctor Agent] 🩺 Detected loop in session ${sessionId}. Injecting recovery prompt.`);
                msgs.push({ role: 'system', content: diagnosis.recoveryPrompt });
                // Note: The LLM will see this urgent system prompt on its next evaluation turn.
            }
        }
    });

    // 6. State Management & Gateway Optimization
    let options: ProviderOptions = { thinkingLevel: 'off' };
    const { Gateway } = await import('./core/gateway');
    const { InlineKeyboard } = await import('grammy');
    const { OAuthStore } = await import('./core/oauth-store');
    const { OAUTH_PROVIDERS } = await import('./core/oauth-types');

    // Inline Keyboard Builder — called when Gateway gets a SHOW_*_PICKER action
    const handlePickerAction = async (chatId: string, action: string, activeOptions: ProviderOptions) => {
        const telegramChannel = channel as import('./channels/telegram').TelegramChannel;

        if (action === 'SHOW_MODEL_PICKER') {
            const active = providerManager.getActive().name;
            const providers = providerManager.getAvailableProviders();
            const keyboard = new InlineKeyboard();

            // 3 buttons per row
            for (let i = 0; i < providers.length; i++) {
                const p = providers[i];
                const label = p === active ? `✅ ${p}` : p;
                keyboard.text(label, `model:${p}`);
                if ((i + 1) % 3 === 0) keyboard.row();
            }

            await telegramChannel.sendInlineKeyboard(
                chatId,
                `🤖 *Select Model Provider*\nCurrent: *${active}*`,
                keyboard
            );
        } else if (action === 'SHOW_AUTH_PICKER') {
            const store = OAuthStore.getInstance();
            const oauthProviders = Object.keys(OAUTH_PROVIDERS);
            const keyboard = new InlineKeyboard();

            for (const p of oauthProviders) {
                const config = OAUTH_PROVIDERS[p];
                const status = store.hasValidCredentials(p) ? '✅' : '❌';
                keyboard.text(`${status} ${config.displayName}`, `auth:${p}`).row();
            }

            // Add "Switch Active" row if any are authenticated
            const activeProvider = providerManager.getActive().name;
            if (oauthProviders.includes(activeProvider)) {
                keyboard.text(`🔄 Active: ${activeProvider}`, `auth:status`);
            }

            await telegramChannel.sendInlineKeyboard(
                chatId,
                `🔐 *OAuth Providers*\n✅ = Authenticated | ❌ = Not configured\n\nTap to login or switch:`,
                keyboard
            );
        } else if (action === 'SHOW_THINK_PICKER') {
            const current = activeOptions.thinkingLevel || 'off';
            const levels = ['off', 'low', 'medium', 'high'];
            const keyboard = new InlineKeyboard();

            for (const level of levels) {
                const label = level === current ? `✅ ${level}` : level;
                keyboard.text(label, `think:${level}`);
            }

            await telegramChannel.sendInlineKeyboard(
                chatId,
                `🧠 *Thinking Level*\nCurrent: *${current}*`,
                keyboard
            );
        } else if (action === 'SHOW_PROXYPAL_MODEL_PICKER') {
            // ProxyPal first-run model selection — fetch models and present grouped keyboard
            try {
                const grouped = await ProxyPalProvider.listModelsByProvider();
                const HIDDEN_PREFIXES = ['tab_'];

                // Pick recommended models (one per upstream provider, sorted by quality)
                const RECOMMENDED = [
                    'claude-opus-4-6-thinking', 'claude-sonnet-4-6',
                    'gemini-3-flash', 'gemini-3-pro-high',
                    'kimi-k2.5', 'kimi-k2',
                    'qwen3-coder-plus', 'deepseek-v3.2',
                    'deepseek-r1', 'glm-5', 'minimax-m2.5',
                ];

                const keyboard = new InlineKeyboard();
                let btnCount = 0;

                // First: recommended models as buttons
                for (const modelId of RECOMMENDED) {
                    // Check model actually exists in the fetched list
                    const exists = Object.values(grouped).some(models => models.includes(modelId));
                    if (!exists) continue;

                    keyboard.text(modelId, `pp-model:${modelId}`);
                    btnCount++;
                    if (btnCount % 2 === 0) keyboard.row();
                }

                // Build a full list as text
                const allModelLines: string[] = [];
                for (const [provider, models] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
                    const visible = models.filter(m => !HIDDEN_PREFIXES.some(p => m.startsWith(p))).sort();
                    if (visible.length === 0) continue;
                    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
                    allModelLines.push(`\n*${label}:*`);
                    for (const m of visible) {
                        allModelLines.push(`  \`${m}\``);
                    }
                }

                await telegramChannel.sendInlineKeyboard(
                    chatId,
                    `*ProxyPal Setup — Choose Default Model*\n\n` +
                    `ProxyPal detected with ${Object.values(grouped).flat().length} models.\n` +
                    `Tap a recommended model below, or use \`/model <name>\` for any model.\n` +
                    allModelLines.join('\n'),
                    keyboard
                );
            } catch (e: any) {
                await telegramChannel.sendInlineKeyboard(
                    chatId,
                    `ProxyPal detected but failed to fetch models: ${e.message}\n\nUse \`/model <name>\` manually.`,
                    new InlineKeyboard()
                );
            }
        }
    };

    const gateway = new Gateway(comms, vibe, mesh, swarm, memory, allTools, options, handlePickerAction);

    // 7. Callback Query Handler (inline keyboard button presses)
    const telegramChannel = channel as import('./channels/telegram').TelegramChannel;
    telegramChannel.onCallback(async (chatId, data, ctx) => {
        try {
            if (data.startsWith('model:')) {
                const providerName = data.replace('model:', '');
                try {
                    providerManager.setActive(providerName);
                    // Edit the message to reflect the change
                    const msgId = ctx.callbackQuery?.message?.message_id;
                    if (msgId) {
                        const active = providerManager.getActive().name;
                        const providers = providerManager.getAvailableProviders();
                        const keyboard = new InlineKeyboard();
                        for (let i = 0; i < providers.length; i++) {
                            const p = providers[i];
                            const label = p === active ? `✅ ${p}` : p;
                            keyboard.text(label, `model:${p}`);
                            if ((i + 1) % 3 === 0) keyboard.row();
                        }
                        await telegramChannel.editMessage(
                            chatId, msgId,
                            `🤖 *Select Model Provider*\nCurrent: *${active}*`,
                            keyboard
                        );
                    }
                } catch (e: any) {
                    await ctx.reply?.(`❌ ${e.message}`);
                }

            } else if (data.startsWith('auth:')) {
                const providerName = data.replace('auth:', '');
                if (providerName === 'status') return;

                const store = OAuthStore.getInstance();
                if (store.hasValidCredentials(providerName)) {
                    // Already authenticated — switch to it
                    providerManager.setActive(providerName);
                    const msgId = ctx.callbackQuery?.message?.message_id;
                    if (msgId) {
                        const oauthProviders = Object.keys(OAUTH_PROVIDERS);
                        const keyboard = new InlineKeyboard();
                        for (const p of oauthProviders) {
                            const config = OAUTH_PROVIDERS[p];
                            const status = store.hasValidCredentials(p) ? '✅' : '❌';
                            keyboard.text(`${status} ${config.displayName}`, `auth:${p}`).row();
                        }
                        await telegramChannel.editMessage(
                            chatId, msgId,
                            `🔐 *OAuth Providers*\n✅ = Authenticated | ❌ = Not configured\n\n🔄 Switched to *${OAUTH_PROVIDERS[providerName].displayName}*`,
                            keyboard
                        );
                    }
                } else {
                    // Not authenticated — tell them to run /auth on the server
                    await ctx.reply?.(`🔐 *${OAUTH_PROVIDERS[providerName]?.displayName}* is not authenticated.\n\nRun \`/auth ${providerName}\` to start the login flow.`);
                }

            } else if (data.startsWith('think:')) {
                const level = data.replace('think:', '') as 'off' | 'low' | 'medium' | 'high';
                options.thinkingLevel = level;
                const msgId = ctx.callbackQuery?.message?.message_id;
                if (msgId) {
                    const levels = ['off', 'low', 'medium', 'high'];
                    const keyboard = new InlineKeyboard();
                    for (const l of levels) {
                        const label = l === level ? `✅ ${l}` : l;
                        keyboard.text(label, `think:${l}`);
                    }
                    await telegramChannel.editMessage(
                        chatId, msgId,
                        `🧠 *Thinking Level*\nCurrent: *${level}*`,
                        keyboard
                    );
                }

            } else if (data.startsWith('pp-model:')) {
                // ProxyPal model selection callback
                const modelName = data.replace('pp-model:', '');
                try {
                    const result = await providerManager.setActiveModel(modelName);
                    const msgId = ctx.callbackQuery?.message?.message_id;
                    if (msgId) {
                        await telegramChannel.editMessage(
                            chatId, msgId,
                            `*ProxyPal configured!*\n\n` +
                            `Default model: \`${modelName}\`\n` +
                            `Provider: *${result.provider}*\n\n` +
                            `_Change anytime with_ \`/model <name>\``,
                            new InlineKeyboard()
                        );
                    }
                } catch (e: any) {
                    await ctx.reply?.(`Failed to set model: ${e.message}`);
                }
            }
        } catch (e: any) {
            console.error('[Callback] Error:', e);
        }
    });

    // 8. Event Handler
    channel.onEvent(async (event) => {
        await gateway.handleEvent(event);
    });

    await channel.start();

    // Start proactive loops with a dummy context for Telegram broadcast (hardcoded mock for now)
    heartbeat.start({ sendMessage: async (t) => console.log('Heartbeat:', t) });

    console.log("✅ ThreadMind is Ready.");
}

bootstrap().catch(console.error);

