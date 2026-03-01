import path from 'path';
import { Tool, ToolContext } from '../core/types';
import { executeInDocker, DEFAULT_DISTRO } from './docker';

const DOCKER_DIR = path.join(process.cwd(), 'data');

/**
 * Get the host-side path for /projects inside the Docker volume.
 * Used only for operations that need host filesystem access (e.g., uploading files).
 */
function getHostProjectsPath(distro: string = DEFAULT_DISTRO): string {
    return path.join(DOCKER_DIR, 'projects');
}

export const fsTools: Tool[] = [
    {
        name: 'read_file',
        description: 'Reads the contents of a file inside the Docker sandbox. Path is relative to /projects or can be an absolute path inside the sandbox.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file inside Docker (e.g., "myproject/main.py" or "/projects/myproject/main.py")' }
            },
            required: ['path']
        },
        execute: async (args: Record<string, any>): Promise<string> => {
            try {
                const filePath = args.path.startsWith('/') ? args.path : `/projects/${args.path}`;
                return await executeInDocker(DEFAULT_DISTRO, `cat "${filePath}"`);
            } catch (error: any) {
                return `Error: ${error.message}`;
            }
        }
    },
    {
        name: 'write_file',
        description: 'Writes content to a file inside the Docker sandbox. Creates parent directories automatically. Path is relative to /projects or can be an absolute path.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file inside Docker (e.g., "myproject/main.py")' },
                content: { type: 'string', description: 'File content to write.' }
            },
            required: ['path', 'content']
        },
        execute: async (args: Record<string, any>): Promise<string> => {
            try {
                const filePath = args.path.startsWith('/') ? args.path : `/projects/${args.path}`;
                const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                // Escape content for shell: use heredoc to avoid escaping issues
                const escapedContent = args.content.replace(/'/g, "'\\''");
                const cmd = `mkdir -p "${dir}" && cat > "${filePath}" << 'GCEOF'\n${args.content}\nGCEOF`;
                const result = await executeInDocker(DEFAULT_DISTRO, cmd);
                // Check if the command was successful by looking at the result
                if (result.includes('✅ Success') || result.includes('STDOUT:')) {
                    return `Successfully wrote to ${filePath}`;
                }
                return result;
            } catch (error: any) {
                return `Error: ${error.message}`;
            }
        }
    },
    {
        name: 'list_directory',
        description: 'Lists contents of a directory inside the Docker sandbox. Defaults to /projects if no path given.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path inside Docker (e.g., "myproject" or "/projects"). Defaults to /projects.' }
            },
            required: []
        },
        execute: async (args: Record<string, any>): Promise<string> => {
            try {
                const dirPath = args.path
                    ? (args.path.startsWith('/') ? args.path : `/projects/${args.path}`)
                    : '/projects';
                return await executeInDocker(DEFAULT_DISTRO, `ls -la "${dirPath}"`);
            } catch (error: any) {
                return `Error: ${error.message}`;
            }
        }
    },
    {
        name: 'create_project',
        description: 'Creates a new project subdirectory inside /projects in the Docker sandbox. This is the first step before writing files for a new project.',
        parameters: {
            type: 'object',
            properties: {
                projectName: { type: 'string', description: 'Name of the project directory (e.g. "linux-gui-manager")' }
            },
            required: ['projectName']
        },
        execute: async (args: Record<string, any>): Promise<string> => {
            try {
                if (args.projectName.includes('..')) throw new Error('Invalid project name.');
                return await executeInDocker(DEFAULT_DISTRO, `mkdir -p "/projects/${args.projectName}" && echo "Project created at /projects/${args.projectName}"`);
            } catch (error: any) {
                return `Error creating project: ${error.message}`;
            }
        }
    },
    {
        name: 'zip_project',
        description: 'Zips an entire project directory inside the Docker sandbox for export, omitting node_modules and .git.',
        parameters: {
            type: 'object',
            properties: {
                projectName: { type: 'string', description: 'Name of the project directory to zip' }
            },
            required: ['projectName']
        },
        execute: async (args: Record<string, any>): Promise<string> => {
            try {
                if (args.projectName.includes('..')) throw new Error('Invalid project name.');
                // Install zip if needed, then zip the project
                const cmd = `cd /projects && zip -r "/projects/${args.projectName}.zip" "${args.projectName}" -x "*/node_modules/*" "*/.git/*" "*/__pycache__/*" 2>/dev/null || (apt-get install -y zip >/dev/null 2>&1 && zip -r "/projects/${args.projectName}.zip" "${args.projectName}" -x "*/node_modules/*" "*/.git/*" "*/__pycache__/*")`;
                return await executeInDocker(DEFAULT_DISTRO, cmd, 120000);
            } catch (error: any) {
                return `Error zipping project: ${error.message}`;
            }
        }
    },
    {
        name: 'upload_project_to_user',
        description: 'Uploads a zipped project file from the Docker sandbox to the user. Call zip_project first.',
        parameters: {
            type: 'object',
            properties: {
                projectName: { type: 'string', description: 'Name of the project that was zipped' }
            },
            required: ['projectName']
        },
        execute: async (args: Record<string, any>, context: ToolContext): Promise<string> => {
            try {
                if (!context.event || !context.event.replyWithDocument) {
                    return 'Error: The current communication channel does not support file uploads.';
                }

                if (args.projectName.includes('..')) throw new Error('Invalid project name.');

                // The zip file lives inside the Docker volume at /projects/<name>.zip
                const hostZipPath = path.join(getHostProjectsPath(), `${args.projectName}.zip`);
                const fssync = require('fs');
                if (!fssync.existsSync(hostZipPath)) {
                    return `Error: Zip file not found at ${hostZipPath}. Did you run zip_project first?`;
                }

                await context.event.replyWithDocument(hostZipPath);
                return `Successfully uploaded ${args.projectName}.zip to the user.`;
            } catch (error: any) {
                return `Error uploading project: ${error.message}`;
            }
        }
    }
];
