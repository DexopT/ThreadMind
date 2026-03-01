import { ChannelEvent, ProviderOptions, Tool } from '../core/types';
import { Gateway } from '../core/gateway';
import { providerManager } from '../providers';
import { ProxyPalProvider } from '../providers/proxypal';
import { metrics } from './metrics';
import { OAuthFlow } from '../commands/oauth-flow';
import { OAuthStore } from '../core/oauth-store';
import { OAUTH_PROVIDERS } from '../core/oauth-types';
import { CONFIGURE_PROMPT, parsePersonality, savePersonality, loadPersonality } from '../core/personality';
import { executeInDocker, resetDistro, setupDistro, backupDistro, restoreDistro } from '../tools/docker';
import { env, isPrivileged, setPrivileged } from '../core/env';
import { SkillManager } from '../skills/manager';
import { GeneratedSkill } from '../skills/generator';

export class CommandParser {
    /** Track users who are in the middle of /configure */
    private static pendingConfigure: Set<string> = new Set();

    /** Track pending AI-generated skill previews awaiting user confirmation */
    private static pendingSkill: Map<string, GeneratedSkill> = new Map();

    /** Track the original skill name for edits (so /skill save overwrites correctly) */
    private static pendingEditName: Map<string, string> = new Map();

    /** Singleton SkillManager — set on first use via setSkillManager() */
    private static skillManager: SkillManager | null = null;

    /** Called from index.ts bootstrap to inject the shared SkillManager */
    static setSkillManager(sm: SkillManager): void {
        CommandParser.skillManager = sm;
    }

    static async handle(event: ChannelEvent, options: ProviderOptions, gateway?: Gateway): Promise<boolean> {
        // Check if this user is in a pending /configure flow
        if (CommandParser.pendingConfigure.has(event.senderId)) {
            CommandParser.pendingConfigure.delete(event.senderId);
            if (event.content.trim().toLowerCase() === '/cancel') {
                await event.reply("❌ Personality configuration cancelled.");
                return true;
            }
            const personality = parsePersonality(event.content);
            savePersonality(personality, event.senderId);
            const greeting = personality.greeting || 'Configuration saved!';
            await event.reply(
                `✅ *Personality configured!*\n\n` +
                `🪪 *Name:* ${personality.name}\n` +
                `🗣️ *Tone:* ${personality.tone}\n` +
                `🧠 *Expertise:* ${personality.expertise}\n` +
                `🎭 *Personality:* ${personality.personality}\n` +
                `📏 *Rules:* ${personality.rules}\n` +
                `👋 *Greeting:* ${personality.greeting}\n\n` +
                `_I'll use this personality from now on. Run /configure again to change it._`
            );
            return true;
        }

        // ─── Intercept pending skill confirmation ────────────────────────────
        if (CommandParser.pendingSkill.has(event.senderId)) {
            const pending = CommandParser.pendingSkill.get(event.senderId)!;
            const trimmed = event.content.trim();

            if (trimmed.toLowerCase() === '/skill discard') {
                CommandParser.pendingSkill.delete(event.senderId);
                await event.reply('❌ Skill discarded.');
                return true;
            }

            if (trimmed.toLowerCase().startsWith('/skill save')) {
                const saveParts = trimmed.split(' ');
                // For edits, default to the original skill name; for new skills, use the AI-suggested name
                const editOriginal = CommandParser.pendingEditName.get(event.senderId);
                const customName = saveParts[2] ? saveParts[2].trim() : (editOriginal || pending.name);
                const sm = CommandParser.skillManager;
                if (!sm) { await event.reply('❌ SkillManager not initialized.'); return true; }
                try {
                    const filename = await sm.saveSkill(customName, pending.content);
                    CommandParser.pendingSkill.delete(event.senderId);
                    CommandParser.pendingEditName.delete(event.senderId);
                    const action = editOriginal ? 'updated' : 'saved';
                    await event.reply(
                        `✅ *Skill ${action}!*\n\n` +
                        `📄 File: \`${filename}\`\n` +
                        `Run it anytime with: \`/skill ${customName} <your task>\``
                    );
                } catch (e: any) {
                    await event.reply(`❌ Failed to save skill: ${e.message}`);
                }
                return true;
            }
        }

        if (event.type !== 'command') return false;

        const text = event.content.trim();
        const cmd = text.split(' ')[0].toLowerCase();
        const args = text.substring(cmd.length).trim();

        switch (cmd) {
            case '/status':
                await event.reply('🟢 ThreadMind Agent is online and fully functional.');
                return true;

            case '/new':
                await event.reply('🔄 Starting new conversation context and clearing RAM cache.');
                return { action: 'CLEAR_CACHE_AND_SESSION' } as any;

            case '/stop':
                if (gateway) {
                    const stopped = gateway.abortUser(event.senderId);
                    if (stopped) {
                        await event.reply('⛔ Generation stopped.');
                    } else {
                        await event.reply('ℹ️ Nothing is running right now.');
                    }
                } else {
                    await event.reply('⛔ Stop not available.');
                }
                return true;

            case '/compact':
                await event.reply('🗜️ Requesting memory consolidation...');
                return { action: 'COMPACT_MEMORY' } as any;

            case '/provider':
            case '/model':
                if (args) {
                    // Accept both provider names (e.g. "opencode-zen") and model names (e.g. "glm-5-free")
                    try {
                        const result = await providerManager.setActiveModel(args.toLowerCase());
                        if (result.model) {
                            await event.reply(`✅ Switched to model *${result.model}* (via *${result.provider}*).`);
                        } else {
                            await event.reply(`✅ Switched to provider *${result.provider}*.`);
                        }
                    } catch (e: any) {
                        await event.reply(`❌ ${e.message}`);
                    }
                } else {
                    // Show available models and providers
                    const modelReport = await CommandParser.getModelListReport();
                    await event.reply(modelReport);
                    // Also signal to show inline keyboard for quick switching
                    return { action: 'SHOW_MODEL_PICKER' } as any;
                }
                return true;

            case '/think':
                if (args && ['off', 'low', 'medium', 'high'].includes(args)) {
                    options.thinkingLevel = args as any;
                    await event.reply(`🧠 Thinking level set to ${args}.`);
                } else {
                    // No args → signal to show inline keyboard
                    return { action: 'SHOW_THINK_PICKER' } as any;
                }
                return true;

            case '/usage':
                await event.reply(metrics.getReport());
                return true;

            case '/privileged':
                if (env.ADMIN_USER_ID && event.senderId !== env.ADMIN_USER_ID) {
                    await event.reply('❌ The `/privileged` command is restricted to the administrator.');
                    return true;
                }
                setPrivileged(!isPrivileged);
                await event.reply(isPrivileged ? '🔓 *Privileged mode is now ENABLED.*\nYou have full access to the host OS shell and default browser profile.' : '🔒 *Privileged mode is now DISABLED.*\nYou are sandboxed again.');
                return true;

            case '/start':
            case '/help':
            case '/commands':
                const helpText = `👋 *Welcome to ThreadMind AI*
I am an advanced LLM agent powered by Model-Native logic, Graph Memory, and Control Planes.

🛠️ *Available Commands:*
/help — Show this help message
/status — Check if core systems are online
/stop — ⛔ Stop current generation
/new — Wipe short-term context
/compact — Compact old memories
/model — Switch AI model (alias: /provider)
/provider — Switch AI provider (alias: /model)
/think — Set thinking level
/usage — Token usage stats
/auth — Manage OAuth providers
/configure — 🧠 Set my personality
/docker [distro] — 📦 Setup/Manage Docker sandbox
/mesh [goal] — Autonomous reasoning workflow
/vibe — 🏎️ Vibe Coding mode
/swarm <role> <task> — 🐝 Spawn a sub-agent (researcher, coder, reviewer, planner, debugger)
/skill list — 📚 List installed skills
/skill add <description> — ✨ AI-generate a new skill
/skill edit <name> <changes> — ✏️ AI-edit an existing skill
/skill <name> <task> — 🎯 Execute a skill on a task
/rotate <provider> — 🔄 Force API key rotation for an OAuth provider
/authcode <code> — Manually verify OAuth callback
/sandbox — Alias for /docker environment manager

⚠️ *Startup Flags:*
Start bot with \`/privileged\` to bypass sandboxing, access host OS shell, and use default browser profiles.

✨ _I passively remember everything you say and proactively load skills when needed._`;
                await event.reply(helpText);
                return true;

            case '/skill': {
                const sm = CommandParser.skillManager;
                if (!sm) {
                    await event.reply('❌ SkillManager is not initialized.');
                    return true;
                }

                const skillParts = args.split(' ');
                const subCmd = skillParts[0]?.toLowerCase();

                // ── /skill list ───────────────────────────────────────────
                if (!subCmd || subCmd === 'list') {
                    await event.reply(await sm.formatList());
                    return true;
                }

                // ── /skill add <description> ──────────────────────────────
                if (subCmd === 'add') {
                    const description = skillParts.slice(1).join(' ').trim();
                    if (!description) {
                        await event.reply('⚠️ Usage: `/skill add <describe what this skill does>`');
                        return true;
                    }
                    await event.reply('🧠 Generating your skill... please wait.');
                    try {
                        const preview = await sm.generatePreview(description);
                        // Store the draft so the user can confirm
                        CommandParser.pendingSkill.set(event.senderId, preview);
                        // Auto-expire after 10 minutes
                        setTimeout(() => CommandParser.pendingSkill.delete(event.senderId), 10 * 60 * 1000);

                        await event.reply(
                            `✨ *Skill Preview*\n` +
                            `Suggested name: \`${preview.name}\`\n\n` +
                            `\`\`\`markdown\n${preview.content.substring(0, 3000)}${preview.content.length > 3000 ? '\n...(truncated)' : ''}\n\`\`\`\n\n` +
                            `To save this skill:\n  \`/skill save\` — save as \`${preview.name}\`\n  \`/skill save <custom-name>\` — save with a custom name\n\n` +
                            `To discard:\n  \`/skill discard\``
                        );
                    } catch (e: any) {
                        await event.reply(`❌ Skill generation failed: ${e.message}`);
                    }
                    return true;
                }

                // ── /skill edit <name> <changes> ──────────────────────────
                if (subCmd === 'edit') {
                    const editName = skillParts[1];
                    const editInstructions = skillParts.slice(2).join(' ').trim();
                    if (!editName || !editInstructions) {
                        await event.reply('⚠️ Usage: `/skill edit <skill-name> <describe changes>`');
                        return true;
                    }
                    await event.reply(`✏️ Editing skill \`${editName}\`... please wait.`);
                    try {
                        const preview = await sm.editSkillPreview(editName, editInstructions);
                        if (!preview) {
                            const available = await sm.listSkills();
                            const names = available.map(s => `\`${s.name}\``).join(', ');
                            await event.reply(`❌ Skill \`${editName}\` not found.\n\nAvailable: ${names || 'none yet'}.`);
                            return true;
                        }
                        // Store draft + original name for the save flow
                        CommandParser.pendingSkill.set(event.senderId, preview);
                        CommandParser.pendingEditName.set(event.senderId, editName);
                        setTimeout(() => {
                            CommandParser.pendingSkill.delete(event.senderId);
                            CommandParser.pendingEditName.delete(event.senderId);
                        }, 10 * 60 * 1000);

                        await event.reply(
                            `✏️ *Edited Skill Preview*\n` +
                            `Original: \`${editName}\`\n\n` +
                            `\`\`\`markdown\n${preview.content.substring(0, 3000)}${preview.content.length > 3000 ? '\n...(truncated)' : ''}\n\`\`\`\n\n` +
                            `To save:\n  \`/skill save\` — overwrite \`${editName}\`\n  \`/skill save <new-name>\` — save as a new skill\n\n` +
                            `To discard:\n  \`/skill discard\``
                        );
                    } catch (e: any) {
                        await event.reply(`❌ Skill edit failed: ${e.message}`);
                    }
                    return true;
                }

                // ── /skill <name> <task> ───────────────────────────────────
                const skillName = subCmd;
                const taskDescription = skillParts.slice(1).join(' ').trim();

                if (!taskDescription) {
                    await event.reply(`⚠️ Usage: \`/skill ${skillName} <describe your task>\``);
                    return true;
                }

                await event.reply(`🎯 Running skill \`${skillName}\`...`);
                try {
                    const ctx = {
                        sendMessage: async (t: string) => { await event.reply(t); },
                        event: event,
                        userId: event.senderId
                    };
                    const result = await sm.executeSkill(skillName, taskDescription, ctx);
                    await event.reply(result);
                } catch (e: any) {
                    await event.reply(`❌ Skill execution error: ${e.message}`);
                }
                return true;
            }

            case '/auth':
                if (args) {
                    // Direct provider auth: /auth opencode-zen
                    await OAuthFlow.startFlow(event, args.toLowerCase());
                } else {
                    // No args → signal to show inline keyboard
                    return { action: 'SHOW_AUTH_PICKER' } as any;
                }
                return true;

            case '/authcode':
                if (!args) {
                    await event.reply('Usage: /authcode <code>');
                    return true;
                }
                await OAuthFlow.handleAuthCode(event, args);
                return true;

            case '/rotate':
                if (!args) {
                    await event.reply('Usage: /rotate <provider>\nExample: `/rotate opencode-zen`');
                    return true;
                }
                const pName = args.toLowerCase();
                if (!OAUTH_PROVIDERS[pName]) {
                    await event.reply(`❌ Unknown provider '${pName}'.`);
                    return true;
                }
                const oStore = OAuthStore.getInstance();
                if (!oStore.hasValidCredentials(pName) && !oStore.getCredentials(pName)) {
                    await event.reply(`❌ No credentials exist for '${pName}'. Run /auth first.`);
                    return true;
                }
                try {
                    await event.reply(`🔄 Rotating API keys for *${pName}*...`);
                    // getApiKey handles the refresh lock under the hood
                    const creds = oStore.getCredentials(pName);
                    if (creds) {
                        // Artificially expire it to force a refresh on next use
                        creds.expires = 0;
                        oStore.saveCredentials(pName, creds);
                        // Force the refresh right now
                        await oStore.getApiKey(pName);
                        await event.reply(`✅ *${pName}* keys successfully rotated.`);
                    }
                } catch (e: any) {
                    await event.reply(`❌ Failed to rotate keys: ${e.message}`);
                }
                return true;

            case '/configure':
                CommandParser.pendingConfigure.add(event.senderId);
                await event.reply(CONFIGURE_PROMPT + '\n\n_(Type /cancel to abort)_');
                // Set a timeout to auto-expire
                setTimeout(() => CommandParser.pendingConfigure.delete(event.senderId), 10 * 60 * 1000);
                return true;

            case '/docker':
            case '/sandbox':
                if (env.ADMIN_USER_ID && event.senderId !== env.ADMIN_USER_ID) {
                    await event.reply('❌ The `/docker` command is restricted to the administrator.');
                    return true;
                }

                if (!args) {
                    await event.reply(
                        `📦 *Docker Environment Manager*\n\n` +
                        `Commands:\n` +
                        `- \`/docker <distro>\`: Setup environment (ubuntu, debian, alpine, fedora)\n` +
                        `- \`/docker execute <cmd>\`: Run a command in the default environment\n` +
                        `- \`/docker upgrade <distro>\`: Upgrade packages\n` +
                        `- \`/docker backup <distro>\`: Backup environment\n` +
                        `- \`/docker restore <distro>\`: Restore from latest backup\n` +
                        `- \`/docker reset <distro>\`: Wipe and recreate\n`
                    );
                    return true;
                }

                const dockerParts = args.split(' ');
                const dockerAction = dockerParts[0].toLowerCase();

                if (dockerAction === 'execute') {
                    if (dockerParts.length < 2) {
                        await event.reply("Usage: `/docker execute <command>`");
                        return true;
                    }
                    const cmdToRun = dockerParts.slice(1).join(' ');
                    await event.reply(`🏃 Running inside Docker (debian): \`${cmdToRun}\``);
                    try {
                        const out = await executeInDocker('debian', cmdToRun);
                        await event.reply(`\`\`\`\n${out}\n\`\`\``);
                    } catch (e: any) {
                        await event.reply(`❌ Execution Failed: ${e.message}`);
                    }
                } else if (dockerAction === 'reset') {
                    const d = dockerParts[1] || 'debian';
                    await event.reply(`🗑️ Wiping Docker environment for \`${d}\`...`);
                    const result = await resetDistro(d);
                    await event.reply(result);
                } else if (dockerAction === 'upgrade') {
                    const d = dockerParts[1] || 'debian';
                    await event.reply(`🔄 Upgrading packages in Docker environment \`${d}\`...`);
                    try {
                        let cmd = '';
                        if (d === 'alpine') cmd = 'apk update && apk upgrade';
                        else cmd = 'apt-get update && apt-get upgrade -y';

                        const out = await executeInDocker(d, cmd, 120000); // 2min timeout for upgrades
                        await event.reply(`✅ Upgrade complete.\n\`\`\`\n${out}\n\`\`\``);
                    } catch (e: any) {
                        await event.reply(`❌ Upgrade Failed: ${e.message}`);
                    }
                } else if (dockerAction === 'backup') {
                    const d = dockerParts[1] || 'debian';
                    await event.reply(`📦 Backing up Docker environment \`${d}\`... This may take a while.`);
                    try {
                        const result = await backupDistro(d);
                        await event.reply(result);
                    } catch (e: any) {
                        await event.reply(`❌ Backup Failed: ${e.message}`);
                    }
                } else if (dockerAction === 'restore') {
                    const d = dockerParts[1] || 'debian';
                    const backupFile = dockerParts[2]; // optional specific backup file
                    await event.reply(`🔄 Restoring Docker environment \`${d}\`...`);
                    try {
                        const result = await restoreDistro(d, backupFile);
                        await event.reply(result);
                    } catch (e: any) {
                        await event.reply(`❌ Restore Failed: ${e.message}`);
                    }
                } else {
                    // Treat it as a distro setup request (e.g., `/docker debian`)
                    const d = dockerAction;
                    await event.reply(`⏳ Setting up Docker environment for \`${d}\`. This may take a few minutes...`);
                    try {
                        const result = await setupDistro(d, (msg) => {
                            // Don't spam telegram, just log to console
                            console.log(`[Docker Setup] ${msg}`);
                        });
                        await event.reply(`✅ ${result}`);
                    } catch (e: any) {
                        await event.reply(`❌ Setup Failed: ${e.message}`);
                    }
                }
                return true;

            default:
                if (!cmd.startsWith('/mesh') && !cmd.startsWith('/swarm') && !cmd.startsWith('/vibe')) {
                    await event.reply(`Unknown command: ${cmd}\nType /help to see all commands.`);
                    return true;
                }
                return false;
        }
    }

    /** Build a model selection report with current status */
    static getModelStatus(): string {
        const active = providerManager.getActive().name;
        const all = providerManager.getAvailableProviders();
        return all.map(p => `${p === active ? '✅' : '⚪'} ${p}`).join('\n');
    }

    /** Build a detailed model listing with available models per provider */
    static async getModelListReport(): Promise<string> {
        const active = providerManager.getActive().name;
        const all = providerManager.getAvailableProviders();

        const PROVIDER_MODELS: Record<string, string[]> = {
            'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
            'anthropic': ['claude-sonnet-4-20250514', 'claude-3.5-haiku', 'claude-3-opus'],
            'google': ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
            'gemini-cli': ['gemini-2.5-flash', 'gemini-2.5-pro'],
            'antigravity': ['gemini-2.5-flash', 'gemini-2.5-pro'],
            'opencode-zen': [
                'kimi-k2.5 (default)',
                'big-pickle (reasoning)',
                'minimax-m2.5-free',
                'glm-5-free',
                'claude-sonnet-4-20250514',
                'claude-opus-4-5',
                'gpt-5.1-codex',
            ],
            'opencode': [
                'kimi-k2.5 (default)',
                'big-pickle (reasoning)',
                'minimax-m2.5-free',
                'glm-5-free',
                'claude-opus-4-5',
                'gpt-5.1-codex',
            ],
        };

        // Fetch ProxyPal models dynamically if available
        if (all.includes('proxypal')) {
            try {
                const grouped = await ProxyPalProvider.listModelsByProvider();
                const HIDDEN_PREFIXES = ['tab_'];
                const proxypalModels: string[] = [];

                for (const [provider, models] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
                    const visible = models
                        .filter(m => !HIDDEN_PREFIXES.some(p => m.startsWith(p)))
                        .sort();
                    if (visible.length === 0) continue;

                    const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
                    proxypalModels.push(`  [${providerLabel}]`);
                    for (const m of visible) {
                        const isDefault = m === ProxyPalProvider.defaultModel;
                        const isReasoning = m === ProxyPalProvider.reasoningModel;
                        const tag = isDefault ? ' (default)' : isReasoning ? ' (reasoning)' : '';
                        proxypalModels.push(`    ${m}${tag}`);
                    }
                }

                PROVIDER_MODELS['proxypal'] = proxypalModels;
            } catch {
                PROVIDER_MODELS['proxypal'] = ['(ProxyPal offline — models unavailable)'];
            }
        }

        const store = OAuthStore.getInstance();
        const lines: string[] = ['*Available Providers & Models*\n'];

        for (const name of all) {
            const isActive = name === active;
            const icon = isActive ? '>' : ' ';
            const models = PROVIDER_MODELS[name] || ['default'];

            // Check auth status for OAuth providers
            const isOAuth = ['opencode-zen', 'gemini-cli', 'antigravity', 'opencode'].includes(name);
            const isProxyPal = name === 'proxypal';
            let authTag = '';
            if (isOAuth) {
                authTag = store.hasValidCredentials(name) ? ' [key]' : ' [locked]';
            } else if (isProxyPal) {
                authTag = ' [local]';
            }

            lines.push(`${icon} *${name}*${authTag}${isActive ? ' <- active' : ''}`);
            for (const m of models) {
                lines.push(`    \`${m}\``);
            }
        }

        lines.push('\n_Switch with_ `/model <name>`');
        lines.push('_[key] = authenticated, [locked] = auth needed, [local] = local proxy_');
        return lines.join('\n');
    }

    /** Build an auth provider status report */
    static getAuthStatus(): string {
        const store = OAuthStore.getInstance();
        const providers = Object.keys(OAUTH_PROVIDERS);
        return providers.map(p => {
            const hasValid = store.hasValidCredentials(p);
            const config = OAUTH_PROVIDERS[p];
            return `${hasValid ? '✅' : '❌'} ${config.displayName}`;
        }).join('\n');
    }
}

