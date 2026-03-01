import { AgentLoop } from './loop';
import { Provider, Tool, ToolContext, Message } from '../core/types';
import { ControlPlane } from './controlPlane';

/** Default tool allowlists per role — used when user doesn't override */
const DEFAULT_ROLE_TOOLS: Record<string, string[]> = {
    researcher: [], // Researcher uses delegated research, handled separately
    coder: ['read_file', 'write_file', 'list_directory', 'run_shell_command', 'run_docker_command'],
    reviewer: ['read_file', 'list_directory'],
    planner: ['read_file', 'list_directory', 'web_search_free', 'recall_memory'],
    debugger: ['read_file', 'list_directory', 'run_shell_command', 'run_docker_command', 'web_search_free'],
};

/** Role-specific system prompts */
const ROLE_PROMPTS: Record<string, string> = {
    researcher: '',
    coder: 'You are a Senior Software Engineer. Analyze requirements, propose elegant solutions, and use your file and shell tools to implement them. Write clean, well-documented code.',
    reviewer: 'You are a strict Code Reviewer. Review the code for bugs, security issues, performance problems, and style violations. Output detailed, actionable feedback. Do NOT execute any code yourself.',
    planner: 'You are a Technical Architect. Break down complex tasks into smaller subtasks, identify dependencies, and propose an execution plan. Do not implement anything — only plan.',
    debugger: 'You are a Debugging Expert. Analyze error messages, inspect logs and source code, and systematically identify root causes. Propose targeted fixes.',
};

export class SwarmManager {
    constructor(private providerFn: () => Provider, private allTools: Tool[]) { }

    /**
     * Spawn a swarm agent with a specific role.
     * @param role         The agent role (researcher, coder, reviewer, planner, debugger)
     * @param task         The task description
     * @param context      The tool context for the agent
     * @param customTools  Optional: override the default tool list for this role
     */
    async spawn(
        role: string,
        task: string,
        context: ToolContext,
        customTools?: string[]
    ): Promise<string> {
        // ─── Researcher uses delegated sub-agent (lightweight) ───────────
        if (role === 'researcher') {
            const { runDelegatedResearch } = await import('./researcher');
            return await runDelegatedResearch(task, this.providerFn(), { thinkingLevel: 'medium' }, context);
        }

        // ─── Resolve toolset ─────────────────────────────────────────────
        const allowedNames = customTools || DEFAULT_ROLE_TOOLS[role] || DEFAULT_ROLE_TOOLS['coder'];
        const toolsToUse = this.allTools.filter(t => allowedNames.includes(t.name));

        // ─── Resolve system prompt ───────────────────────────────────────
        const systemPrompt = ROLE_PROMPTS[role] || ROLE_PROMPTS['coder'];

        // ─── Isolate memory per role ─────────────────────────────────────
        const agent = new AgentLoop(this.providerFn, new ControlPlane(toolsToUse));
        const { HybridMemory } = await import('../memory/hybrid');
        const roleMemory = new HybridMemory(`swarm-${role}`);
        const sender = context.event?.senderId || 'swarm-commander';

        await roleMemory.add(sender, task, 'episodic');

        const recentMems = await roleMemory.query(sender, '', 10);
        const contextStr = recentMems.map((m: any) => `[Memory] ${m.content}`).join('\n');

        const messages: Message[] = [
            { role: 'system', content: `${systemPrompt}\n\nIsolated Role Context:\n${contextStr}` },
            { role: 'user', content: `Your task is: ${task}` }
        ];

        const history = await agent.run(messages, context, { thinkingLevel: 'medium' }, 5);
        const finalMessage = history[history.length - 1];

        await roleMemory.add(sender, finalMessage.content, 'core');

        return finalMessage.content;
    }

    /** Get all available roles (including dynamic custom ones) */
    getAvailableRoles(): string[] {
        return Object.keys(ROLE_PROMPTS);
    }
}
