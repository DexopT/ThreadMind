# ThreadMind Architecture Guide

This document provides a deep dive into the technical architecture of ThreadMind.

## Core Design Philosophy

ThreadMind is built on the **ReAct (Reason + Act)** pattern. It doesn't just generate text; it thinks, acts via tools, and observes the results to refine its next steps.

## Orchestration Flow

1. **Gateway (`src/core/gateway.ts`)**: The entry point. It manages session state, handles the `AbortController` for stopping tasks, and routes events to the appropriate agent logic.
2. **Channel (`src/channels/`)**: Currently supports Telegram via `grammy`. It translates platform-specific events into a unified `ChannelEvent` format.
3. **Agent Loop (`src/agent/loop.ts`)**: The heart of the system.
   - **Context Assembly Optimizer**: Dynamically selects relevant tools based on the user's query to stay within token limits.
   - **Universal Parser**: Extracts tool calls from raw LLM output, supporting XML, JSON, and specific model formats (like Mistral).

## Memory System

ThreadMind uses a **Hybrid Memory** approach:
- **Episodic Memory**: Short-term conversation history stored in SQLite (FTS5) for fast retrieval and as Markdown files for long-term logging.
- **Semantic Memory**: Knowledge relationships stored as a JSON graph.
- **Core Memory**: User preferences and persistent facts stored in `MEMORY.md`.

## Execution Environment

All code execution and shell commands (unless in `/privileged` mode) are strictly sandboxed in **Docker containers**.
- **Volume Mounting**: The `/projects` directory on the host is mapped into the container, allowing persistent project work.
- **Resource Guarding**: Memory and CPU limits are enforced to prevent system-wide OOM or performance issues during heavy compilation tasks.

## Proactive Systems

- **Doctor Agent**: Periodically analyzes session history to detect and break infinite loops or repetitive failures.
- **Heartbeat**: Manages scheduled tasks and proactive user interactions based on core memory.
