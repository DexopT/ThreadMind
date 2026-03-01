// src/core/middleware/base.ts
// Abstract middleware class — every feature middleware extends this

import { AgentContext, AgentResponse } from '../types-new';

export abstract class AgentMiddleware {
    abstract readonly name: string;
    enabled = true;

    abstract beforeRun(ctx: AgentContext): Promise<AgentContext>;
    abstract afterRun(ctx: AgentContext, result: AgentResponse): Promise<AgentResponse>;
    abstract onError(ctx: AgentContext, err: Error): Promise<AgentResponse | null>;
}
