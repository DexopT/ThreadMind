import { Tool } from '../core/types';

export const systemTools: Tool[] = [
    {
        name: 'system_wait',
        description: 'Wait for a specified number of seconds before continuing. Use this to simulate real time passing, wait for elements to load, or pause between messages in a conversation.',
        parameters: {
            type: 'object',
            properties: {
                seconds: { type: 'number', description: 'The number of seconds to wait (e.g. 10, 60, 300)' }
            },
            required: ['seconds']
        },
        execute: async (args: Record<string, any>) => {
            const numSeconds = Number(args.seconds);
            if (isNaN(numSeconds) || numSeconds <= 0) {
                return 'Error: Invalid number of seconds. Must be a positive number.';
            }

            // Cap waiting at 5 minutes maximum to prevent the process from hanging forever maliciously
            const safeSeconds = Math.min(numSeconds, 300);

            await new Promise(resolve => setTimeout(resolve, safeSeconds * 1000));
            return `Successfully waited for ${safeSeconds} seconds.`;
        }
    }
];
