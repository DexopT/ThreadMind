import { Bot, Context, InlineKeyboard } from 'grammy';
import { Channel, ChannelEvent } from '../core/types';
import { RateLimiter } from '../ux/rate-limiter';

const MAX_MESSAGE_LENGTH = 4000;


export type CallbackHandler = (chatId: string, data: string, ctx: Context) => Promise<void>;

export class TelegramChannel implements Channel {
    public name = 'telegram';
    private bot: Bot;
    private eventHandler?: (event: ChannelEvent) => Promise<void>;
    private callbackHandler?: CallbackHandler;
    private rateLimiter: RateLimiter;

    constructor(token: string) {
        this.bot = new Bot(token);
        this.rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 20 }); // 20 requests per minute per user

        this.bot.on('message', async (ctx: Context) => {
            if (!this.eventHandler) return;

            const senderId = ctx.chat?.id.toString();
            if (!senderId) return;

            let type: ChannelEvent['type'] = 'message';
            let content = ctx.message?.text || '';

            if (ctx.message?.voice) {
                type = 'voice';
                content = ctx.message.voice.file_id;
            } else if (ctx.message?.photo) {
                type = 'photo';
                content = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            } else if (content.startsWith('/')) {
                type = 'command';
            }

            // Input Validation
            if (content.length > MAX_MESSAGE_LENGTH) {
                content = content.substring(0, MAX_MESSAGE_LENGTH);
                await ctx.reply("⚠️ Message truncated due to length limits.");
            }

            // Rate Limiting
            if (!this.rateLimiter.consume(senderId)) {
                if (this.rateLimiter.isBlocked(senderId)) {
                    // Only send the clear message if they just got blocked
                }
                await ctx.reply("🚦 You are sending messages too quickly. Please wait a minute.");
                return;
            }

            const event: ChannelEvent = {
                id: ctx.message?.message_id.toString() || Date.now().toString(),
                type,
                content,
                senderId,
                metadata: {
                    chatName: ctx.chat?.type === 'private' ? ctx.from?.first_name : ctx.chat?.title,
                    isGroup: ctx.chat?.type !== 'private'
                },
                reply: async (text: string) => {
                    const MAX_LEN = 4000;
                    if (!text) return;

                    // Convert standard markdown to Telegram-safe HTML
                    let safeHtml = text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');

                    // Code blocks
                    safeHtml = safeHtml.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/gi, '<pre><code>$1</code></pre>');
                    // Inline code
                    safeHtml = safeHtml.replace(/`([^`]+)`/g, '<code>$1</code>');
                    // Bold
                    safeHtml = safeHtml.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');
                    // Italic (using _ or *) - careful not to match mid-word underscores or single bullet points
                    safeHtml = safeHtml.replace(/(?<=^|\s)_([^_\n]+)_(?=\s|$)/g, '<i>$1</i>');
                    safeHtml = safeHtml.replace(/(?<=^|\s)\*([^\*\n]+)\*(?=\s|$)/g, '<i>$1</i>');
                    // Links
                    safeHtml = safeHtml.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

                    if (safeHtml.length <= MAX_LEN) {
                        await ctx.reply(safeHtml, { parse_mode: 'HTML' }).catch(e => {
                            console.error(`Failed to parse HTML, falling back to plain text: ${e.message}`);
                            return ctx.reply(text);
                        });
                        return;
                    }

                    for (let i = 0; i < text.length; i += MAX_LEN) {
                        const chunk = text.substring(i, i + MAX_LEN);
                        await ctx.reply(chunk).catch(e => {
                            console.error("Failed to send chunk:", e);
                        });
                        await new Promise(r => setTimeout(r, 100));
                    }
                },
                replyWithDocument: async (filePath: string) => {
                    const { InputFile } = await import('grammy');
                    await ctx.replyWithDocument(new InputFile(filePath));
                },
                replyWithTyping: async () => {
                    let isTyping = true;
                    const typingAction = async () => {
                        while (isTyping) {
                            try {
                                await ctx.replyWithChatAction('typing');
                            } catch (e) {
                                // Ignore errors if chat action fails
                            }
                            await new Promise(resolve => setTimeout(resolve, 4000));
                        }
                    };
                    typingAction();
                    return () => { isTyping = false; };
                }
            };

            await this.eventHandler(event);
        });

        // Handle inline keyboard callback queries
        this.bot.on('callback_query:data', async (ctx: Context) => {
            const data = ctx.callbackQuery?.data;
            const chatId = ctx.chat?.id.toString();
            if (!data || !chatId) {
                await ctx.answerCallbackQuery();
                return;
            }

            // Provide simple rate limiting for callbacks too
            if (!this.rateLimiter.consume(chatId)) {
                await ctx.answerCallbackQuery({ text: "🚦 Rate limit exceeded. Please wait.", show_alert: true });
                return;
            }

            if (this.callbackHandler) {
                await this.callbackHandler(chatId, data, ctx);
            }
            await ctx.answerCallbackQuery();
        });
    }

    onEvent(handler: (event: ChannelEvent) => Promise<void>): void {
        this.eventHandler = handler;
    }

    onCallback(handler: CallbackHandler): void {
        this.callbackHandler = handler;
    }

    /** Send a message with an inline keyboard to a specific chat */
    async sendInlineKeyboard(chatId: string, text: string, keyboard: InlineKeyboard): Promise<void> {
        await this.bot.api.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
        });
    }

    /** Edit an existing message with new text and keyboard */
    async editMessage(chatId: string, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
        try {
            await this.bot.api.editMessageText(chatId, messageId, text, {
                parse_mode: 'HTML',
                reply_markup: keyboard,
            });
        } catch (e: any) {
            // Telegram returns 400 when the message content is identical — safe to ignore
            if (!e?.message?.includes('message is not modified')) {
                throw e;
            }
        }
    }

    async start(): Promise<void> {
        // Register bot commands for the menu button
        await this.bot.api.setMyCommands([
            { command: 'help', description: '📋 Show all commands' },
            { command: 'stop', description: '⛔ Stop current generation' },
            { command: 'model', description: '🤖 Switch AI model' },
            { command: 'provider', description: '🔌 Switch AI provider' },
            { command: 'auth', description: '🔐 Manage OAuth providers' },
            { command: 'authcode', description: '🔑 Manually verify OAuth callback' },
            { command: 'think', description: '🧠 Set thinking level' },
            { command: 'configure', description: '🎭 Set bot personality' },
            { command: 'swarm', description: '🐝 Spawn a specialized sub-agent' },
            { command: 'vibe', description: '🏎️ Vibe Coding mode' },
            { command: 'rotate', description: '🔄 Rotate API Keys/Tokens' },
            { command: 'status', description: '🟢 Check system status' },
            { command: 'usage', description: '📊 Token usage stats' },
            { command: 'new', description: '🔄 Start fresh session' },
            { command: 'compact', description: '🗜️ Compact memories' },
            { command: 'docker', description: '📦 Sandbox Docker environment' },
            { command: 'sandbox', description: '📦 Sandbox Manager (Alias)' },
            { command: 'privileged', description: '🔓 Toggle Privileged Mode (Admin)' },
        ]);

        this.bot.start({
            onStart: (botInfo) => {
                console.log(`Telegram Bot started as @${botInfo.username}`);
                console.log(`Menu button registered with 14 commands.`);
            }
        });
    }

    async stop(): Promise<void> {
        await this.bot.stop();
    }
}

