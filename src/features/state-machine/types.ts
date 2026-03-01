// src/features/state-machine/types.ts
// Persona State Machines — Type Definitions

export type AgentState = 'explore' | 'verify' | 'execute' | 'report' | 'recover' | 'wait';

export interface StateConfig {
    temperature: number;
    cotDepth: number;
    maxTokens: number;
    toolsAllowed: boolean;
    llmCallsAllowed: boolean;
}

export const STATE_CONFIGS: Record<AgentState, StateConfig> = {
    explore: { temperature: 0.8, cotDepth: 8, maxTokens: 2000, toolsAllowed: true, llmCallsAllowed: true },
    verify: { temperature: 0.1, cotDepth: 5, maxTokens: 1000, toolsAllowed: true, llmCallsAllowed: true },
    execute: { temperature: 0.0, cotDepth: 0, maxTokens: 200, toolsAllowed: true, llmCallsAllowed: false },
    report: { temperature: 0.3, cotDepth: 2, maxTokens: 3000, toolsAllowed: false, llmCallsAllowed: true },
    recover: { temperature: 0.2, cotDepth: 6, maxTokens: 1500, toolsAllowed: false, llmCallsAllowed: true },
    wait: { temperature: 0.0, cotDepth: 0, maxTokens: 50, toolsAllowed: false, llmCallsAllowed: false },
};

export const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
    explore: ['verify', 'execute', 'recover'],
    verify: ['execute', 'explore', 'recover'],
    execute: ['report', 'recover', 'wait'],
    report: ['explore', 'wait'],
    recover: ['explore', 'verify', 'wait'],
    wait: ['explore', 'execute'],
};

export interface StateTransitionEvent {
    fromState: AgentState;
    toState: AgentState;
    reason: string;
    triggeredBy: 'task_progress' | 'error' | 'tool_result' | 'human' | 'auditor';
    timestamp: number;
    sessionId: string;
    channelType: string;
}
