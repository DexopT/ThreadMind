export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    name?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

export interface ToolContext {
    // Methods or properties provided to tools during execution
    sendMessage?: (text: string) => Promise<void>;
    event?: ChannelEvent; // Expose the raw channel event for advanced reply features (like documents)
    userId?: string;      // The ID of the user triggering the tool call
}

export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
    permissions?: string[]; // E.g. ['admin']
    execute: (args: Record<string, any>, context: ToolContext) => Promise<string>;
}

export interface ProviderResponse {
    message: Message;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface ProviderOptions {
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}

export interface Provider {
    name: string;
    generateResponse: (messages: Message[], tools?: Tool[], options?: ProviderOptions) => Promise<ProviderResponse>;
}

export interface ChannelEvent {
    id: string;
    type: 'message' | 'command' | 'voice' | 'photo';
    content: string;
    senderId: string;
    metadata?: Record<string, any>;
    reply: (text: string) => Promise<void>;
    replyWithDocument?: (filePath: string) => Promise<void>;
    replyWithTyping: () => Promise<() => void>; // Returns a function to stop typing
}

export interface Channel {
    name: string;
    onEvent: (handler: (event: ChannelEvent) => Promise<void>) => void;
    start: () => Promise<void>;
    stop: () => Promise<void>;
}

export interface MemoryEntry {
    id: string;
    userId: string;
    content: string;
    type: 'core' | 'episodic' | 'semantic';
    createdAt: number;
    updatedAt: number;
    accessCount: number;
}

export interface Memory {
    name: string;
    add: (userId: string, content: string, type: MemoryEntry['type']) => Promise<void>;
    query: (userId: string, query: string, limit?: number) => Promise<MemoryEntry[]>;
    // To support self-evolving memory
    consolidate: (userId: string) => Promise<void>;
}

export interface Plugin {
    name: string;
    init?: () => Promise<void>;
    providers?: Provider[];
    channels?: Channel[];
    tools?: Tool[];
    memory?: Memory;
}
