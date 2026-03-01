import { Provider, ToolContext, Message } from '../core/types';
import { AgentLoop } from './loop';

/** Configuration for Mesh retry behavior */
interface MeshConfig {
    maxRetries: number;
    maxStepsOverride?: number;
}

const DEFAULT_CONFIG: MeshConfig = { maxRetries: 2 };

export class MeshWorkflow {
    constructor(
        private providerFn: () => Provider,
        private loop: AgentLoop,
        private config: MeshConfig = DEFAULT_CONFIG
    ) { }

    async runGoal(goal: string, context: ToolContext): Promise<string> {
        if (context.sendMessage) {
            await context.sendMessage(`🕸️ [Mesh] Analyzing goal: ${goal}`);
        }

        // ─── Step 1: Decompose the goal into a plan ──────────────────────
        let steps: string[];
        try {
            const planMsg = await this.providerFn().generateResponse([
                {
                    role: 'system',
                    content:
                        'You are a Mesh Workflow planner. Break the user goal into 3-5 distinct, sequential steps. ' +
                        'Return ONLY a numbered list of steps (e.g. "1. Do X\\n2. Do Y"). No prose.'
                },
                { role: 'user', content: goal }
            ]);

            steps = planMsg.message.content
                .split('\n')
                .map((s: string) => s.trim())
                .filter((s: string) => /^\d+[\.\)]/.test(s)); // Only keep numbered lines

            if (steps.length === 0) {
                // Fallback: if the model didn't number them, take all non-empty lines
                steps = planMsg.message.content.split('\n').filter((s: string) => !!s.trim());
            }
        } catch (err: any) {
            return `❌ [Mesh] Failed to generate plan: ${err.message}`;
        }

        if (context.sendMessage) {
            await context.sendMessage(`📋 [Mesh] Plan (${steps.length} steps):\n${steps.join('\n')}`);
        }

        // ─── Step 2: Execute each step with retry logic ──────────────────
        let workflowContext = `Goal: ${goal}\n\n`;
        const stepResults: { step: string; status: 'success' | 'failed'; result: string; attempts: number }[] = [];

        for (let idx = 0; idx < steps.length; idx++) {
            const step = steps[idx];
            let lastError = '';
            let succeeded = false;
            let resultText = '';
            let attempts = 0;

            for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
                attempts = attempt + 1;

                if (context.sendMessage) {
                    const retryLabel = attempt > 0 ? ` (retry ${attempt}/${this.config.maxRetries})` : '';
                    await context.sendMessage(`⚙️ [Mesh] Step ${idx + 1}/${steps.length}${retryLabel}: ${step}`);
                }

                try {
                    const stepMessages: Message[] = [
                        {
                            role: 'system',
                            content:
                                `You are executing step ${idx + 1} of a larger workflow.\n\n` +
                                `Previous context:\n${workflowContext}\n\n` +
                                `Current step to execute:\n${step}` +
                                (lastError ? `\n\n⚠️ Previous attempt failed with: ${lastError}\nPlease try a different approach.` : '')
                        }
                    ];

                    const stepResult = await this.loop.run(stepMessages, context);
                    resultText = stepResult[stepResult.length - 1].content;

                    // Basic success heuristic: if the result doesn't contain obvious error markers
                    const hasError = /\b(error|exception|failed|crash|fatal)\b/i.test(resultText) &&
                        resultText.length < 200; // Short error messages are likely real errors

                    if (hasError && attempt < this.config.maxRetries) {
                        lastError = resultText.substring(0, 300);
                        continue; // Retry
                    }

                    succeeded = true;
                    break;

                } catch (err: any) {
                    lastError = err.message || 'Unknown execution error';
                    if (attempt >= this.config.maxRetries) {
                        resultText = `❌ Step failed after ${attempts} attempt(s): ${lastError}`;
                    }
                }
            }

            stepResults.push({
                step,
                status: succeeded ? 'success' : 'failed',
                result: resultText,
                attempts
            });

            workflowContext += `Step ${idx + 1}: ${step}\nStatus: ${succeeded ? '✅' : '❌'}\nResult: ${resultText}\n\n`;
        }

        // ─── Step 3: Generate summary ────────────────────────────────────
        const successCount = stepResults.filter(s => s.status === 'success').length;
        const failCount = stepResults.filter(s => s.status === 'failed').length;

        const summaryHeader = failCount === 0
            ? `✅ [Mesh] Workflow complete. All ${successCount} steps succeeded.`
            : `⚠️ [Mesh] Workflow finished. ${successCount}/${stepResults.length} steps succeeded, ${failCount} failed.`;

        if (context.sendMessage) {
            await context.sendMessage(summaryHeader);
        }

        // Build detailed report
        let report = `${summaryHeader}\n\n`;
        for (const sr of stepResults) {
            const icon = sr.status === 'success' ? '✅' : '❌';
            const retryNote = sr.attempts > 1 ? ` (${sr.attempts} attempts)` : '';
            report += `${icon} ${sr.step}${retryNote}\n`;
        }
        report += `\n---\n\n${workflowContext}`;

        return report;
    }
}
