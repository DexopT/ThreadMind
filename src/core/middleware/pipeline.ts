// src/core/middleware/pipeline.ts
// Middleware Pipeline — chains middleware layers around a core executor

import { AgentContext, AgentResponse } from '../types-new';
import { AgentMiddleware } from './base';

type CoreExecutor = (ctx: AgentContext) => Promise<AgentResponse>;

export class MiddlewarePipeline {
    private layers: AgentMiddleware[] = [];
    private coreExecutor?: CoreExecutor;

    use(middleware: AgentMiddleware): this {
        this.layers.push(middleware);
        return this;
    }

    setCore(executor: CoreExecutor): this {
        this.coreExecutor = executor;
        return this;
    }

    enable(name: string): this {
        const layer = this.layers.find(l => l.name === name);
        if (layer) layer.enabled = true;
        return this;
    }

    disable(name: string): this {
        const layer = this.layers.find(l => l.name === name);
        if (layer) layer.enabled = false;
        return this;
    }

    async execute(ctx: AgentContext): Promise<AgentResponse> {
        if (!this.coreExecutor) throw new Error('No core executor set');

        // Forward pass: beforeRun on each enabled layer
        let context = ctx;
        for (const layer of this.layers) {
            if (layer.enabled) context = await layer.beforeRun(context);
        }

        // Core execution
        let result: AgentResponse;
        try {
            result = await this.coreExecutor(context);
        } catch (err) {
            // Error pass: reverse order, first recovery wins
            for (const layer of [...this.layers].reverse()) {
                if (layer.enabled) {
                    const recovery = await layer.onError(context, err as Error);
                    if (recovery) return recovery;
                }
            }
            throw err;
        }

        // Reverse pass: afterRun on each enabled layer
        for (const layer of [...this.layers].reverse()) {
            if (layer.enabled) result = await layer.afterRun(context, result);
        }

        return result;
    }
}
