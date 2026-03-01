import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolContext } from '../core/types';
import { isPrivileged } from '../core/env';

const execAsync = promisify(exec);

export const shellTool: Tool = {
    name: 'run_shell_command',
    description: 'Executes a safe shell command on the host machine. Returns stdout and stderr.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The shell command to execute'
            },
            timeout: {
                type: 'number',
                description: 'Timeout in milliseconds. Defaults to 10000.'
            }
        },
        required: ['command']
    },
    permissions: ['admin'],
    execute: async (args: Record<string, any>, context: ToolContext): Promise<string> => {
        const { command, timeout = 10000 } = args;

        // Basic allowlist validation
        const allowlistPrefixes = ['ls', 'pwd', 'echo', 'date', 'git', 'cat', 'grep', 'find'];
        const isAllowed = allowlistPrefixes.some(prefix => command.trim().startsWith(prefix));

        if (!isPrivileged && !isAllowed) {
            return `Error: Command execution rejected. Not in allowlist: ${allowlistPrefixes.join(', ')}\n(Restart with /privileged flag to allow all commands)`;
        }

        try {
            if (context.sendMessage) {
                await context.sendMessage(`Executing: \`${command}\``);
            }

            const { stdout, stderr } = await execAsync(command, { timeout });

            let output = '';
            if (stdout) output += `STDOUT:\n${stdout}\n`;
            if (stderr) output += `STDERR:\n${stderr}\n`;

            if (output.trim() === '') {
                return 'Command executed successfully with no output.';
            }

            // Truncate if too long to prevent LLM overflow
            if (output.length > 8000) {
                return output.substring(0, 8000) + '...\n[Output truncated due to length]';
            }

            return output;
        } catch (error: any) {
            return `Failed to execute command: ${error.message}`;
        }
    }
};
