// src/channels/telegram-adapter.ts
// Telegram Channel Adapter — implements ChannelAdapter for Telegram using node-telegram-bot-api pattern
// NOTE: This adapter uses the grammy Bot SDK (already a project dependency) instead of node-telegram-bot-api

import { Bot } from 'grammy';
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from '../core/channels/types';

export class TelegramAdapter implements ChannelAdapter {
    readonly channelType = 'telegram';

    private bot: Bot;
    private messageHandler?: (msg: IncomingMessage) => Promise<void>;
    private errorHandler?: (err: Error) => void;
    private connected = false;
    private streamingMessages = new Map<string, number>(); // sessionId -> telegram messageId

    constructor(private readonly botToken: string) {
        this.bot = new Bot(botToken);
    }

    async start(): Promise<void> {
        this.bot.on('message:text', async (ctx) => {
            if (!this.messageHandler || !ctx.message.text) return;

            const incoming: IncomingMessage = {
                id: `tg-${ctx.message.message_id}`,
                channelType: 'telegram',
                channelMessageId: String(ctx.message.message_id),
                sessionId: `tg-${ctx.chat.id}`,
                userId: String(ctx.from?.id ?? ctx.chat.id),
                text: ctx.message.text,
                attachments: [],
                replyToId: ctx.message.reply_to_message
                    ? `tg-${ctx.message.reply_to_message.message_id}`
                    : undefined,
                metadata: {
                    chatId: ctx.chat.id,
                    chatType: ctx.chat.type,   // "private" | "group" | "supergroup"
                    username: ctx.from?.username,
                    firstName: ctx.from?.first_name,
                },
                receivedAt: new Date(ctx.message.date * 1000),
            };

            try {
                await this.messageHandler(incoming);
            } catch (err) {
                this.errorHandler?.(err as Error);
            }
        });

        this.bot.start();
        this.connected = true;
    }

    async stop(): Promise<void> {
        await this.bot.stop();
        this.connected = false;
    }

    isConnected(): boolean { return this.connected; }

    async send(message: OutgoingMessage): Promise<void> {
        const chatId = this.extractChatId(message.sessionId);

        if (message.isStreaming && message.streamChunk !== undefined) {
            await this.handleStreamChunk(chatId, message);
        } else {
            await this.bot.api.sendMessage(chatId, message.text, { parse_mode: 'Markdown' });
        }
    }

    async sendTypingIndicator(sessionId: string): Promise<void> {
        const chatId = this.extractChatId(sessionId);
        await this.bot.api.sendChatAction(chatId, 'typing');
    }

    onMessage(handler: (message: IncomingMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    onError(handler: (error: Error) => void): void {
        this.errorHandler = handler;
    }

    private extractChatId(sessionId: string): number {
        return Number(sessionId.replace('tg-', ''));
    }

    private async handleStreamChunk(chatId: number, message: OutgoingMessage): Promise<void> {
        const existing = this.streamingMessages.get(message.sessionId);
        if (!existing) {
            const sent = await this.bot.api.sendMessage(chatId, message.streamChunk ?? '...', {
                parse_mode: 'Markdown',
            });
            this.streamingMessages.set(message.sessionId, sent.message_id);
        } else {
            await this.bot.api.editMessageText(chatId, existing, message.streamChunk ?? '', {
                parse_mode: 'Markdown',
            });
        }
        if (message.isStreamEnd) {
            this.streamingMessages.delete(message.sessionId);
        }
    }
}
