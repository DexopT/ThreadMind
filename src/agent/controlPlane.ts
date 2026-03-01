import { Tool, ToolContext } from '../core/types';
import { env } from '../core/env';

export interface BudgetConfig {
    maxToolCallsPerSession: number;
    maxTokensPerSession: number;
}

export class ControlPlane {
    private tools: Map<string, Tool> = new Map();
    private callExecutionCount: number = 0;

    constructor(tools: Tool[], private budget: BudgetConfig = { maxToolCallsPerSession: 15, maxTokensPerSession: 8000 }) {
        tools.forEach(t => this.tools.set(t.name, t));
    }

    public getAvailableTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    public async executeTool(name: string, argsStr: string, context: ToolContext): Promise<string> {
        if (this.callExecutionCount >= this.budget.maxToolCallsPerSession) {
            return `System Error [Control Plane]: BUDGET_EXCEEDED. You reached the max tool calls (${this.budget.maxToolCallsPerSession}). Synthesize your final answer now.`;
        }

        const tool = this.tools.get(name);
        if (!tool) {
            return `System Error [Control Plane]: Tool '${name}' not found.`;
        }

        // Apply Guardrails Taxonomies (e.g. prompt injection, path traversal in basic form)
        if (argsStr.includes('../../../') || argsStr.includes('/etc/passwd')) {
            return `System Error [Control Plane]: GUARDRAIL_VIOLATION - Unsafe path traversal detected. Blocked.`;
        }

        // Apply Permissions checks
        if (tool.permissions && tool.permissions.length > 0) {
            const isAdminReq = tool.permissions.includes('admin');
            const isUserAdmin = context.userId === env.ADMIN_USER_ID;

            if (isAdminReq && !isUserAdmin) {
                return `System Error [Control Plane]: PERMISSION_DENIED. This tool requires admin privileges.`;
            }
        }

        try {
            const args = JSON.parse(argsStr || '{}');
            this.callExecutionCount++;
            return await tool.execute(args, context);
        } catch (e: any) {
            return `Error executing tool: ${e.message}`;
        }
    }

    public resetBudget() {
        this.callExecutionCount = 0;
    }

    public getUsageMetrics() {
        return { calls: this.callExecutionCount, limit: this.budget.maxToolCallsPerSession };
    }
}
