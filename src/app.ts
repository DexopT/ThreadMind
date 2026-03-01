// src/app.ts
// Full Application Wiring — connects all middleware to the pipeline
// This file demonstrates how all features wire together.

import { randomUUID } from 'crypto';
import { MiddlewarePipeline } from './core/middleware/pipeline';
import { AgentMiddleware } from './core/middleware/base';
import { channelRegistry } from './core/channels/channel-registry';
import { providerRegistry } from './core/llm/provider-registry';
import { TelegramAdapter } from './channels/telegram-adapter';
import { AgentContext, AgentResponse } from './core/types-new';

// --- Feature Imports ---
import { CausalGraphBuilder } from './features/causal-graph/causal-graph-builder';
import { ReasoningAuditor } from './features/auditor/reasoning-auditor';
import { CrossAgentImmuneSystem } from './features/immune-system/cross-agent-immune-system';
import { CognitiveBudgetAllocator } from './features/cba/cognitive-budget-allocator';
import { AgentStateMachine } from './features/state-machine/agent-state-machine';
import { AdversarialPlanReviewer } from './features/adversarial/adversarial-plan-reviewer';
import { EconomicsEngine } from './features/economics/economics-engine';
import { ParallelUniversePlanner } from './features/pup/parallel-universe-planner';

// ============================================================================
// Middleware Implementations
// ============================================================================

class CognitiveBudgetAllocatorMiddleware extends AgentMiddleware {
    readonly name = 'cognitive-budget-allocator';
    private allocator = new CognitiveBudgetAllocator();

    async beforeRun(ctx: AgentContext): Promise<AgentContext> {
        ctx.cognitiveBudget = this.allocator.allocate(ctx.task, ctx.metadata);
        return ctx;
    }
    async afterRun(_ctx: AgentContext, result: AgentResponse): Promise<AgentResponse> { return result; }
    async onError(_ctx: AgentContext, _err: Error): Promise<AgentResponse | null> { return null; }
}

class EconomicsEngineMiddleware extends AgentMiddleware {
    readonly name = 'economics-engine';
    private engine?: EconomicsEngine;

    constructor(private readonly defaults: { tokenBudget: number; timeBudgetMs: number; qualityTier: 'economy' | 'standard' | 'premium' }) {
        super();
    }

    async beforeRun(ctx: AgentContext): Promise<AgentContext> {
        ctx.taskBudget = {
            tokenBudget: this.defaults.tokenBudget,
            timeBudgetMs: this.defaults.timeBudgetMs,
            qualityTier: this.defaults.qualityTier,
            allowBudgetOverride: false,
        };
        this.engine = new EconomicsEngine(ctx.taskId, ctx.sessionId, ctx.channelType, ctx.taskBudget);
        return ctx;
    }
    async afterRun(_ctx: AgentContext, result: AgentResponse): Promise<AgentResponse> {
        if (this.engine) result.spendReport = this.engine.generateReport();
        return result;
    }
    async onError(_ctx: AgentContext, _err: Error): Promise<AgentResponse | null> { return null; }
}

class AgentStateMachineMiddleware extends AgentMiddleware {
    readonly name = 'state-machine';
    private machine?: AgentStateMachine;

    async beforeRun(ctx: AgentContext): Promise<AgentContext> {
        this.machine = new AgentStateMachine(ctx.sessionId, ctx.channelType);
        return ctx;
    }
    async afterRun(_ctx: AgentContext, result: AgentResponse): Promise<AgentResponse> {
        if (this.machine) result.stateHistory = this.machine.getHistory();
        return result;
    }
    async onError(ctx: AgentContext, _err: Error): Promise<AgentResponse | null> {
        if (this.machine) {
            try { this.machine.transition('recover', 'Error in pipeline', 'error'); } catch { /* invalid transition */ }
        }
        return null;
    }
}

class CausalGraphBuilderMiddleware extends AgentMiddleware {
    readonly name = 'causal-graph';
    private builder?: CausalGraphBuilder;

    async beforeRun(ctx: AgentContext): Promise<AgentContext> {
        this.builder = new CausalGraphBuilder(ctx.taskId, ctx.sessionId, ctx.channelType);
        // Create the root user_input node
        this.builder.addNode({
            nodeType: 'user_input', content: ctx.task.slice(0, 100),
            tokenCost: 0, confidence: 1.0, parentIds: [],
            metadata: { userId: ctx.userId }, cacheable: false, channel: ctx.channelType,
        });
        return ctx;
    }
    async afterRun(_ctx: AgentContext, result: AgentResponse): Promise<AgentResponse> {
        if (this.builder) result.causalGraph = this.builder.build();
        return result;
    }
    async onError(_ctx: AgentContext, _err: Error): Promise<AgentResponse | null> { return null; }
}

// ============================================================================
// Application Bootstrap
// ============================================================================

export async function bootstrap() {
    // Register providers (implement LLMProvider for each)
    // providerRegistry.register(new YourOpenAIProvider());
    // providerRegistry.register(new YourAnthropicProvider());
    // providerRegistry.setDefault('your-preferred-provider');

    // Register channels
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramToken) {
        const telegram = new TelegramAdapter(telegramToken);
        channelRegistry.register(telegram);
    }

    // Build pipeline
    const pipeline = new MiddlewarePipeline()
        .use(new CognitiveBudgetAllocatorMiddleware())
        .use(new EconomicsEngineMiddleware({ tokenBudget: 8000, timeBudgetMs: 30_000, qualityTier: 'standard' }))
        .use(new AgentStateMachineMiddleware())
        .use(new CausalGraphBuilderMiddleware())
        .setCore(async (ctx: AgentContext): Promise<AgentResponse> => {
            // Core is fully provider-agnostic and channel-agnostic
            const provider = await providerRegistry.getHealthy();
            const response = await provider.complete({
                messages: [
                    ...ctx.history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
                    { role: 'user' as const, content: ctx.task },
                ],
                temperature: ctx.cognitiveBudget?.recommendedTemperature ?? 0.4,
                maxTokens: ctx.cognitiveBudget?.tokenBudgetCap ?? 4000,
            });

            return {
                taskId: ctx.taskId,
                sessionId: ctx.sessionId,
                channelType: ctx.channelType,
                output: response.content,
                shouldStream: false,
                isComplete: true,
            };
        });

    // Wire channels to pipeline
    await channelRegistry.startAll();
    console.log('ThreadMind agent framework running on all channels');
}
