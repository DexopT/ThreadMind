# ThreadMind API & Tool Interface

## Tool Specification

All tools in ThreadMind must implement the `Tool` interface:

```typescript
interface Tool {
    name: string;
    description: string;
    parameters: object; // JSON Schema
    execute(args: any, context: ToolContext): Promise<string>;
    permissions?: string[];
}
```

### Core Tools

#### `run_docker_command`
- **Description**: Executes a shell command inside the Docker sandbox.
- **Parameters**: `command` (string), `distro` (optional string).
- **Permissions**: `admin`.

#### `web_search_free`
- **Description**: Performs an intelligent web search and synthesizes results.
- **Parameters**: `query` (string).

#### `store_memory` / `recall_memory`
- **Description**: Interfaces with the Hybrid Memory system to persist or retrieve facts.

## Provider Specification

The `Provider` interface abstracts the underlying LLM:

```typescript
interface Provider {
    readonly name: string;
    generateResponse(
        messages: Message[],
        tools: Tool[],
        options?: ProviderOptions
    ): Promise<{ message: Message; usage?: any }>;
}
```

### Supported Providers
- **OpenAI**: Native function calling, GPT-4o suite.
- **Anthropic**: Claude 3.5 Sonnet/Haiku.
- **Google**: Gemini 2.0/2.5 Pro/Flash.
- **ProxyPal**: Local LLM gateway bridge.

## Control Plane

The **Control Plane** (`src/agent/controlPlane.ts`) handles:
- **Budgeting**: Limits the number of tool calls and tokens per session.
- **Guardrails**: Prevents path traversal and unsafe command execution.
- **Permissions**: Ensures only authorized users can call sensitive tools.
