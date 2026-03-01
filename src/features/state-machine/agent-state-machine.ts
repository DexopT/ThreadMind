// src/features/state-machine/agent-state-machine.ts
// Persona State Machine — Implementation

import { AgentState, StateConfig, STATE_CONFIGS, VALID_TRANSITIONS, StateTransitionEvent } from './types';

export class InvalidTransitionError extends Error {
    constructor(from: AgentState, to: AgentState) {
        super(`Invalid transition: ${from} -> ${to}. Allowed: ${VALID_TRANSITIONS[from].join(', ')}`);
    }
}

export class AgentStateMachine {
    private currentState: AgentState;
    private history: StateTransitionEvent[] = [];
    private stateEntryTime = Date.now();

    constructor(
        private readonly sessionId: string,
        private readonly channelType: string,
        initialState: AgentState = 'explore'
    ) {
        this.currentState = initialState;
    }

    get state(): AgentState { return this.currentState; }
    get config(): StateConfig { return STATE_CONFIGS[this.currentState]; }

    transition(toState: AgentState, reason: string, triggeredBy: StateTransitionEvent['triggeredBy']): StateTransitionEvent {
        if (!VALID_TRANSITIONS[this.currentState].includes(toState)) {
            throw new InvalidTransitionError(this.currentState, toState);
        }
        const event: StateTransitionEvent = {
            fromState: this.currentState, toState, reason, triggeredBy,
            timestamp: Date.now(), sessionId: this.sessionId, channelType: this.channelType,
        };
        this.history.push(event);
        this.currentState = toState;
        this.stateEntryTime = Date.now();
        return event;
    }

    suggestTransition(context: {
        planComplete?: boolean; toolError?: boolean; outputReady?: boolean;
        waitingForHuman?: boolean; verificationNeeded?: boolean;
    }): AgentState | null {
        const valid = VALID_TRANSITIONS[this.currentState];
        if (context.toolError && valid.includes('recover')) return 'recover';
        if (context.waitingForHuman && valid.includes('wait')) return 'wait';
        if (context.outputReady && valid.includes('report')) return 'report';
        if (context.planComplete && valid.includes('execute')) return 'execute';
        if (context.verificationNeeded && valid.includes('verify')) return 'verify';
        return null;
    }

    timeInCurrentStateMs(): number { return Date.now() - this.stateEntryTime; }
    getHistory(): StateTransitionEvent[] { return [...this.history]; }
}
