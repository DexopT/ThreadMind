// src/core/llm/types.ts
// Provider-Agnostic LLM Layer — Type Definitions

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  systemPrompt?: string;
  temperature?: number;         // 0.0 - 1.0
  maxTokens?: number;
  stopSequences?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  model: string;               // The model string actually used
  finishReason: 'stop' | 'max_tokens' | 'error' | 'tool_use';
  latencyMs: number;
}

export interface LLMStreamChunk {
  delta: string;               // New text token(s)
  isFinal: boolean;
  tokensUsed?: LLMResponse['tokensUsed'];
}

// The one interface every LLM provider must implement
export interface LLMProvider {
  readonly name: string;                        // e.g. "openai", "anthropic", "ollama", "gemini"
  readonly defaultModel: string;
  readonly supportedModels: string[];

  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk>;
  countTokens(text: string): Promise<number>;   // For budget calculations
  isAvailable(): Promise<boolean>;              // Health check
}
