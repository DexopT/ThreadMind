import { CronJob } from 'cron';
import { Tool, ToolContext } from '../core/types';

const jobs = new Map<string, CronJob>();

export const schedulerTools: Tool[] = [
    {
        name: 'schedule_task',
        description: 'Schedules a command/task using a cron expression.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Unique name for the job' },
                cron: { type: 'string', description: 'Cron expression (e.g. "0 * * * *" for hourly)' },
                prompt: { type: 'string', description: 'What the agent should do when this triggers' }
            },
            required: ['name', 'cron', 'prompt']
        },
        execute: async (args: Record<string, any>, context: ToolContext): Promise<string> => {
            const { name, cron, prompt } = args;

            if (jobs.has(name)) {
                return `Job '${name}' already exists. Use delete_job first.`;
            }

            try {
                const job = new CronJob(cron, async () => {
                    console.log(`[Cron Triggered] ${name}`);
                    if (context.sendMessage) {
                        await context.sendMessage(`[Cron Trigger: ${name}] Action required: ${prompt}`);
                    }
                });

                job.start();
                jobs.set(name, job);
                return `Successfully scheduled job '${name}' with cron '${cron}'.`;
            } catch (err: any) {
                return `Failed to parse cron or start job: ${err.message}`;
            }
        }
    },
    {
        name: 'list_jobs',
        description: 'Lists all scheduled jobs.',
        parameters: { type: 'object', properties: {} },
        execute: async (): Promise<string> => {
            if (jobs.size === 0) return 'No active jobs.';
            const list = Array.from(jobs.keys()).map(k => {
                const j = jobs.get(k)!;
                return `- ${k}: running=${(j as any).running}, next=${j.nextDate().toISO()}`;
            });
            return list.join('\n');
        }
    },
    {
        name: 'delete_job',
        description: 'Deletes a scheduled job.',
        parameters: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name']
        },
        execute: async (args: Record<string, any>): Promise<string> => {
            const job = jobs.get(args.name);
            if (!job) return `Job '${args.name}' not found.`;
            job.stop();
            jobs.delete(args.name);
            return `Stopped and deleted job '${args.name}'.`;
        }
    }
];
