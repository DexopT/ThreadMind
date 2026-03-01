// src/core/channels/types.ts
// Channel Adapter Interface — Unified message delivery across all channels

export interface IncomingMessage {
    id: string;
    channelType: string;           // "telegram" | "rest" | "websocket" | "discord" | "cli"
    channelMessageId: string;      // Native message ID from the channel
    sessionId: string;             // Conversation continuity key
    userId: string;                // Channel-native user identifier
    text: string;
    attachments?: MessageAttachment[];
    replyToId?: string;
    metadata: Record<string, unknown>;  // Channel-specific extras (e.g. Telegram chat_id)
    receivedAt: Date;
}

export interface OutgoingMessage {
    sessionId: string;
    text: string;
    attachments?: MessageAttachment[];
    replyToId?: string;
    isStreaming?: boolean;
    streamChunk?: string;
    isStreamEnd?: boolean;
    metadata?: Record<string, unknown>;
}

export interface MessageAttachment {
    type: 'image' | 'file' | 'audio' | 'video';
    url?: string;
    base64?: string;
    mimeType: string;
    filename?: string;
}

export interface ChannelAdapter {
    readonly channelType: string;

    start(): Promise<void>;
    stop(): Promise<void>;
    isConnected(): boolean;

    send(message: OutgoingMessage): Promise<void>;
    sendTypingIndicator(sessionId: string): Promise<void>;

    onMessage(handler: (message: IncomingMessage) => Promise<void>): void;
    onError(handler: (error: Error) => void): void;
}
