import open from 'open';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../core/types';
import { env } from '../core/env';

const DOCKER_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');
export const DEFAULT_DISTRO = 'debian';

/** Ensure the base Docker directory exists */
function initDockerDir() {
    if (!fs.existsSync(DOCKER_DIR)) {
        fs.mkdirSync(DOCKER_DIR, { recursive: true });
    }
}

/** Check if the Docker binary exists on the system, regardless of if the engine is running */
function checkDockerBinaryExists(): { exists: boolean, executablePath?: string } {
    if (process.platform === 'win32') {
        const potentialPaths = [
            'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
            'C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe'
        ];
        for (const p of potentialPaths) {
            if (fs.existsSync(p)) return { exists: true, executablePath: p };
        }
        // Try to see if it's in PATH
        try {
            execSync('where docker', { stdio: 'ignore' });
            return { exists: true };
        } catch {
            return { exists: false };
        }
    } else {
        // macOS / Linux
        try {
            execSync('which docker', { stdio: 'ignore' });
            return { exists: true };
        } catch {
            return { exists: false };
        }
    }
}

/** Check if docker engine is actually responding (i.e., daemon is running) */
async function isDockerDaemonRunning(): Promise<boolean> {
    try {
        execSync('docker info', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** Attempts to physically start the Docker Engine UI/Daemon in the background */
async function startDockerEngine(executablePath?: string, onProgress?: (msg: string) => void): Promise<boolean> {
    if (process.platform === 'win32' && executablePath) {
        onProgress?.(`🚀 Docker Engine is offline. Auto-starting Docker Desktop...`);

        // Spawn detached so it doesn't block the Node event loop
        const child = spawn(executablePath, [], { detached: true, stdio: 'ignore' });
        child.unref(); // Lets Node exit even if Docker is still running

        // Poll for up to 60 seconds
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (await isDockerDaemonRunning()) {
                onProgress?.(`✅ Docker Engine successfully booted!`);
                return true;
            }
        }
        onProgress?.(`❌ Timed out waiting for Docker Engine to start.`);
        return false;
    } else if (process.platform === 'darwin') {
        onProgress?.(`🚀 Docker Engine is offline. Auto-starting Docker Desktop for Mac...`);
        try {
            execSync('open -a Docker', { stdio: 'ignore' });
            for (let i = 0; i < 30; i++) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                if (await isDockerDaemonRunning()) return true;
            }
        } catch (e) {
            return false;
        }
    } else {
        // Linux systemd
        onProgress?.(`🚀 Docker Engine is offline. Attempting to start via systemctl...`);
        try {
            execSync('sudo systemctl start docker', { stdio: 'ignore' });
            return await isDockerDaemonRunning();
        } catch (e) {
            return false;
        }
    }
    return false;
}

/** Core check called by tool endpoints to ensure Docker is healthy, starting it if necessary */
async function ensureDockerReady(onProgress?: (msg: string) => void): Promise<boolean> {
    if (await isDockerDaemonRunning()) return true;

    // Daemon is offline, check if binary is even on the system
    const binaryCheck = checkDockerBinaryExists();

    if (!binaryCheck.exists) {
        onProgress?.(`❌ Docker is not installed on this system!`);
        onProgress?.(`🌐 Opening Docker installation page in your browser...`);

        // Redirect user to download page
        try {
            const platformUrl = process.platform === 'win32' ? 'https://docs.docker.com/desktop/install/windows-install/'
                : process.platform === 'darwin' ? 'https://docs.docker.com/desktop/install/mac-install/'
                    : 'https://docs.docker.com/desktop/install/linux-install/';
            await open(platformUrl);
        } catch (e) { }

        // Give them a fatal error warning so it relays back to Telegram
        throw new Error("Docker is not found! Sandboxing features cannot be used on this system. Please install Docker from the page just opened in your browser and try again.");
    }

    // Binary exists, try to boot it
    return await startDockerEngine(binaryCheck.executablePath, onProgress);
}

/** Get the container name for a specific distro */
function getContainerName(distro: string): string {
    return `threadmind_${distro}`;
}

/** Check if a container exists and is running */
function isContainerRunning(containerName: string): boolean {
    try {
        const output = execSync(`docker ps -q -f name=${containerName}`).toString().trim();
        return output.length > 0;
    } catch (e) {
        return false;
    }
}

/** Ensure the default distro (Debian) is installed and running. Also ensures /projects and /git dirs exist. */
export async function ensureDefaultDistro(onProgress?: (msg: string) => void): Promise<void> {
    const isReady = await ensureDockerReady(onProgress);
    if (!isReady) {
        console.warn("[Docker] ⚠️ Docker Engine is not installed or not running. Sandbox features will be unavailable.");
        return;
    }

    initDockerDir();
    const defaultContainer = getContainerName(DEFAULT_DISTRO);

    if (!isContainerRunning(defaultContainer)) {
        console.log(`[Docker] 📦 Default container '${defaultContainer}' not running. Auto-starting...`);
        await setupDistro(DEFAULT_DISTRO, onProgress || ((msg) => console.log(`[Docker] ${msg}`)));
    }
}

/** Downloads (pulls) and starts a distro container if it doesn't exist */
export async function setupDistro(distro: string, onProgress?: (msg: string) => void): Promise<string> {
    const supportedDistros = ['ubuntu', 'debian', 'alpine', 'fedora'];

    if (!supportedDistros.includes(distro)) {
        throw new Error(`Unsupported distro '${distro}'. Supported: ${supportedDistros.join(', ')}`);
    }

    const isReady = await ensureDockerReady(onProgress);
    if (!isReady) {
        throw new Error("Docker Engine is not installed or running on the host system. Please install Docker Desktop and start it.");
    }

    initDockerDir();

    const projectsDir = path.join(DOCKER_DIR, 'projects');
    const gitDir = path.join(DOCKER_DIR, 'git');
    if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
    if (!fs.existsSync(gitDir)) fs.mkdirSync(gitDir, { recursive: true });

    const containerName = getContainerName(distro);

    if (isContainerRunning(containerName)) {
        return `Container '${containerName}' is already set up and running.`;
    }

    onProgress?.(`Starting ${distro} container...`);

    // Remove old stopped container if it exists
    try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
    } catch (e) { }

    // Convert Windows paths to work with git bash / WSL if needed, but modern Docker Desktop handles C:\ fine
    // -d: detached, -t: allocate tty (keeps it alive), -i: interactive
    const dockerArgs = [
        'run', '-d', '--name', containerName,
        '-v', `${projectsDir}:/projects`,
        '-v', `${gitDir}:/git`,
        '-w', '/projects',
        `--memory=${env.DOCKER_MAX_RAM}`,
        `--memory-swap=${env.DOCKER_MAX_SWAP}`,
        `--cpus=${env.DOCKER_MAX_CPUS}`
    ];

    // Choose image based on distro
    let image = distro;
    if (distro === 'ubuntu') image = 'ubuntu:24.04';
    if (distro === 'debian') image = 'debian:bookworm';

    dockerArgs.push(image);
    // Keep container running indefinitely
    dockerArgs.push('tail', '-f', '/dev/null');

    await new Promise<void>((resolve, reject) => {
        const proc = spawn('docker', dockerArgs);
        let errOutput = '';
        proc.stderr.on('data', d => errOutput += d.toString());
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Failed to start container (exit ${code}): ${errOutput}`));
        });
    });

    // Fix apt sources for debian if needed, just a quick update to ensure it works
    try {
        if (distro === 'debian' || distro === 'ubuntu') {
            execSync(`docker exec ${containerName} apt-get update`, { stdio: 'ignore' });
        }
    } catch (e) {
        console.warn(`Failed initial apt update in ${containerName}`);
    }

    onProgress?.(`✅ Setup complete for ${distro}.`);
    return `Successfully set up and started ${distro} container \`${containerName}\` with /projects and /git volumes linked.`;
}

/** Reset (delete) a distro */
export async function resetDistro(distro: string): Promise<string> {
    const containerName = getContainerName(distro);
    try {
        execSync(`docker rm -f ${containerName}`);
        return `Successfully deleted '${containerName}' container environment.`;
    } catch (e: any) {
        return `Container '${containerName}' is not running or could not be removed: ${e.message}`;
    }
}

/** Backup a distro rootfs as a docker image tarball */
export async function backupDistro(distro: string): Promise<string> {
    const containerName = getContainerName(distro);
    if (!isContainerRunning(containerName)) {
        throw new Error(`Container '${containerName}' is not running. Nothing to backup.`);
    }

    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `${distro}-${timestamp}.tar`;
    const backupPath = path.join(BACKUP_DIR, backupName);
    const temporaryImageName = `threadmind_backup_${distro}_${timestamp}`;

    return new Promise((resolve, reject) => {
        try {
            // 1. Commit container to an image
            execSync(`docker commit ${containerName} ${temporaryImageName}`);

            // 2. Save image to tarball
            const proc = spawn('docker', ['save', '-o', backupPath, temporaryImageName]);

            proc.on('close', (code) => {
                // Delete temporary image
                try { execSync(`docker rmi ${temporaryImageName}`, { stdio: 'ignore' }) } catch (e) { }

                if (code === 0) {
                    const stat = fs.statSync(backupPath);
                    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
                    resolve(`✅ Backup created: \`${backupName}\` (${sizeMB} MB)\nLocation: \`${backupPath}\``);
                } else {
                    reject(new Error(`Docker save failed with exit code ${code}`));
                }
            });
        } catch (e: any) {
            reject(new Error(`Backup failed: ${e.message}`));
        }
    });
}

/** Restore a distro from the most recent backup (or a specified backup file) */
export async function restoreDistro(distro: string, backupFile?: string): Promise<string> {
    if (!fs.existsSync(BACKUP_DIR)) {
        throw new Error(`No backups directory found at ${BACKUP_DIR}`);
    }

    // Find the backup to restore
    let targetBackup: string;
    if (backupFile) {
        targetBackup = path.join(BACKUP_DIR, backupFile);
    } else {
        // Find most recent backup for this distro
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(`${distro}-`) && f.endsWith('.tar'))
            .sort()
            .reverse();

        if (files.length === 0) {
            throw new Error(`No backups found for distro '${distro}'. Run /docker backup ${distro} first.`);
        }
        targetBackup = path.join(BACKUP_DIR, files[0]);
    }

    if (!fs.existsSync(targetBackup)) {
        throw new Error(`Backup file not found: ${targetBackup}`);
    }

    const containerName = getContainerName(distro);

    // Stop and remove current container if it exists
    try { execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' }) } catch (e) { }

    return new Promise((resolve, reject) => {
        try {
            // Load the image
            const loadOutput = execSync(`docker load -i "${targetBackup}"`).toString();
            // Extract image name from load output (e.g. Loaded image: threadmind_backup_debian_...)
            const match = loadOutput.match(/Loaded image: (.*)/);
            if (!match) {
                throw new Error("Could not determine image name from docker load output");
            }
            const imageName = match[1].trim();

            initDockerDir();
            const projectsDir = path.join(DOCKER_DIR, 'projects');
            const gitDir = path.join(DOCKER_DIR, 'git');

            // Run the restored image
            execSync(`docker run -d --name ${containerName} -v "${projectsDir}:/projects" -v "${gitDir}:/git" -w /projects ${imageName} tail -f /dev/null`);

            resolve(`✅ Restored \`${distro}\` from \`${path.basename(targetBackup)}\``);
        } catch (e: any) {
            reject(new Error(`Restore failed: ${e.message}`));
        }
    });
}

/** Execute a command inside a Docker environment */
export async function executeInDocker(distro: string, command: string, timeoutMs: number = 60000): Promise<string> {
    const containerName = getContainerName(distro);
    if (!isContainerRunning(containerName)) {
        throw new Error(`Distro '${distro}' is not running. Use /docker ${distro} first.`);
    }

    return new Promise((resolve) => {
        const sessionId = Date.now().toString();
        const tmpLog = `/projects/.docker_${sessionId}.log`;
        const exitFile = `/projects/.docker_${sessionId}.exit`;

        const hostTmpLog = path.join(DOCKER_DIR, 'projects', `.docker_${sessionId}.log`);
        const hostExitFile = path.join(DOCKER_DIR, 'projects', `.docker_${sessionId}.exit`);

        // Wrap the command to write output and signal completion
        const wrappedCommand = `{ ${command}\n} > ${tmpLog} 2>&1; echo $? > ${exitFile};`;

        // -i: interactive
        const dockerArgs = [
            'exec', '-i',
            containerName,
            '/bin/sh', '-c', wrappedCommand
        ];

        const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        proc.stdout.resume(); // Prevent buffer full
        proc.stderr.resume();

        let isDone = false;

        const cleanup = () => {
            if (isDone) return { output: '<empty>', exitCode: 0 };
            isDone = true;
            clearTimeout(timer);
            try { proc.kill('SIGKILL'); } catch (e) { }

            let output = '<empty>';
            let exitCode = 0;
            try {
                if (fs.existsSync(hostTmpLog)) {
                    output = fs.readFileSync(hostTmpLog, 'utf8');
                    fs.unlinkSync(hostTmpLog);
                }
                if (fs.existsSync(hostExitFile)) {
                    exitCode = parseInt(fs.readFileSync(hostExitFile, 'utf8').trim() || '0', 10);
                    fs.unlinkSync(hostExitFile);
                }
            } catch (e) { }

            return { output: output.trim(), exitCode };
        };

        const timer = setTimeout(() => {
            if (!isDone) {
                const { output } = cleanup();
                resolve(`[TIMEOUT] Process killed after ${timeoutMs}ms.\n\nSTDOUT/STDERR:\n${output}`);
            }
        }, timeoutMs);

        proc.on('exit', (code) => {
            // Let the file system catch up just in case
            setTimeout(() => {
                if (!isDone) {
                    const { output, exitCode } = cleanup();
                    // Docker exec returns the code of the command if it exits synchronously
                    const finalCode = exitCode !== 0 ? exitCode : (code || 0);
                    const statusStr = finalCode === 0 ? '✅ Success' : `❌ Exited with code ${finalCode}`;
                    const combined = `[${statusStr}]\n\nSTDOUT/STDERR:\n${output}`;
                    resolve(combined.length > 5000 ? combined.substring(0, 5000) + '\n...[Truncated]' : combined);
                }
            }, 200);
        });
    });
}

/** The tool that exposes Docker execution to the LLM agent */
export const runDockerCommandTool: Tool = {
    name: 'run_docker_command',
    description: 'Execute a bash/shell command inside the default Docker Linux sandbox (debian). This is the PRIMARY way to run commands — all code execution, file operations, git, compiling, package installs, and project work happens here. The default working directory is /projects. Create a subdirectory inside /projects for each new project. Git clones go to /git unless specified otherwise. Only use the host shell if the user explicitly asks for host execution. Distro defaults to debian.',
    permissions: ['admin'],
    parameters: {
        type: 'object',
        properties: {
            distro: { type: 'string', description: 'The distro to use. Defaults to "debian" if omitted.' },
            command: { type: 'string', description: 'The shell command to execute inside the sandbox' }
        },
        required: ['command']
    },
    execute: async (args, context) => {
        try {
            const distro = args.distro || DEFAULT_DISTRO;
            const containerName = getContainerName(distro);

            // Auto-setup if missing
            if (!isContainerRunning(containerName)) {
                await context.sendMessage?.(`⏳ Preparing isolated \`${distro}\` Docker environment for the first time... This might take a minute.`);
                await setupDistro(distro, (msg) => console.log(msg));
            }

            return await executeInDocker(distro, args.command);
        } catch (e: any) {
            return `Failed to execute in Docker: ${e.message}`;
        }
    }
};

/** Tool to list installed and available Docker distros */
export const listDockerDistrosTool: Tool = {
    name: 'list_docker_distros',
    description: 'List all Docker Linux sandbox environments — shows which containers are running and available. Use this when the user asks about sandbox access, available distros, or Linux environments.',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    },
    execute: async () => {
        const supportedDistros = ['ubuntu', 'debian', 'alpine', 'fedora'];
        const running: string[] = [];
        const available: string[] = [];

        for (const distro of supportedDistros) {
            const containerName = getContainerName(distro);
            if (isContainerRunning(containerName)) {
                running.push(distro);
            } else {
                available.push(distro);
            }
        }

        const dockerInstalled = await isDockerDaemonRunning();

        const lines: string[] = [
            `Docker Engine: ${dockerInstalled ? '✅ installed & running' : '❌ not running'}`,
            '',
            `Running sandboxes (${running.length}):`,
            ...(running.length > 0 ? running.map(d => `  ✅ ${d}`) : ['  (none)']),
            '',
            `Available to start (${available.length}):`,
            ...(available.length > 0 ? available.map(d => `  📦 ${d}`) : ['  (all running)']),
        ];

        return lines.join('\n');
    }
};
