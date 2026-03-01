import { spawn, ChildProcess } from 'child_process';
import { Tool, ToolContext } from '../core/types';
import fs from 'fs/promises';
import path from 'path';
import { createInterface, Interface as ReadlineInterface } from 'readline';

// ─── JSON-RPC 2.0 Helpers ────────────────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, any>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

// ─── MCP Server Connection ───────────────────────────────────────────────────

class MCPServerConnection {
    private process: ChildProcess | null = null;
    private readline: ReadlineInterface | null = null;
    private requestId = 0;
    private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map();
    private _ready = false;

    constructor(
        private serverName: string,
        private command: string,
        private args: string[] = [],
        private envVars: Record<string, string> = {}
    ) {}

    /** Spawn the MCP server process and perform the JSON-RPC initialize handshake */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`MCP server '${this.serverName}' timed out during startup (10s).`));
                this.disconnect();
            }, 10_000);

            try {
                this.process = spawn(this.command, this.args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, ...this.envVars }
                });

                this.process.on('error', (err) => {
                    clearTimeout(timeout);
                    console.error(`[MCP:${this.serverName}] Process error:`, err.message);
                    reject(err);
                });

                this.process.on('exit', (code) => {
                    console.warn(`[MCP:${this.serverName}] Process exited with code ${code}`);
                    this._ready = false;
                });

                this.process.stderr?.on('data', (chunk: Buffer) => {
                    const msg = chunk.toString().trim();
                    if (msg) console.error(`[MCP:${this.serverName}:stderr] ${msg}`);
                });

                // Set up line-by-line JSON-RPC reader on stdout
                this.readline = createInterface({ input: this.process.stdout! });
                this.readline.on('line', (line: string) => {
                    this.handleLine(line);
                });

                // Perform initialize handshake
                this.sendRequest('initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'ThreadMind', version: '1.0.0' }
                }).then((result) => {
                    clearTimeout(timeout);
                    // Send initialized notification
                    this.sendNotification('notifications/initialized');
                    this._ready = true;
                    console.log(`[MCP:${this.serverName}] Connected. Server: ${result?.serverInfo?.name || 'unknown'}`);
                    resolve();
                }).catch((err) => {
                    clearTimeout(timeout);
                    reject(err);
                });

            } catch (err: any) {
                clearTimeout(timeout);
                reject(err);
            }
        });
    }

    get isReady(): boolean {
        return this._ready;
    }

    /** List available tools from the MCP server */
    async listTools(): Promise<any[]> {
        const result = await this.sendRequest('tools/list', {});
        return result?.tools || [];
    }

    /** Call a specific tool on the MCP server */
    async callTool(toolName: string, args: Record<string, any>): Promise<string> {
        const result = await this.sendRequest('tools/call', { name: toolName, arguments: args });

        if (result?.content) {
            // MCP content is an array of content blocks
            return result.content
                .map((block: any) => {
                    if (block.type === 'text') return block.text;
                    if (block.type === 'image') return `[Image: ${block.mimeType}]`;
                    return JSON.stringify(block);
                })
                .join('\n');
        }

        return JSON.stringify(result);
    }

    /** Disconnect and kill the server process */
    disconnect(): void {
        this._ready = false;
        this.readline?.close();
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
            // Force kill after 3s if graceful shutdown fails
            setTimeout(() => {
                if (this.process && !this.process.killed) {
                    this.process.kill('SIGKILL');
                }
            }, 3000);
        }
        this.process = null;
        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error('MCP server disconnected.'));
        }
        this.pendingRequests.clear();
    }

    // ─── Internal Helpers ────────────────────────────────────────────────────

    private sendRequest(method: string, params?: Record<string, any>): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            const request: JsonRpcRequest = { jsonrpc: '2.0', id, method };
            if (params) request.params = params;

            this.pendingRequests.set(id, { resolve, reject });

            const payload = JSON.stringify(request) + '\n';
            this.process?.stdin?.write(payload, (err) => {
                if (err) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Failed to write to MCP server: ${err.message}`));
                }
            });

            // 30s timeout per request
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`MCP request '${method}' timed out (30s).`));
                }
            }, 30_000);
        });
    }

    private sendNotification(method: string, params?: Record<string, any>): void {
        const notification: any = { jsonrpc: '2.0', method };
        if (params) notification.params = params;
        this.process?.stdin?.write(JSON.stringify(notification) + '\n');
    }

    private handleLine(line: string): void {
        if (!line.trim()) return;
        try {
            const msg: JsonRpcResponse = JSON.parse(line);
            if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                const { resolve, reject } = this.pendingRequests.get(msg.id)!;
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                    reject(new Error(`MCP Error [${msg.error.code}]: ${msg.error.message}`));
                } else {
                    resolve(msg.result);
                }
            }
            // Notifications from server (no id) are logged but not acted on
        } catch {
            // Ignore non-JSON lines (some servers emit debug logs to stdout)
        }
    }
}

// ─── Public Loader ───────────────────────────────────────────────────────────

/** Active MCP connections, keyed by server name */
const activeConnections: Map<string, MCPServerConnection> = new Map();

/** Graceful shutdown hook */
process.on('beforeExit', () => {
    for (const conn of activeConnections.values()) {
        conn.disconnect();
    }
});

export const loadMCPServers = async (): Promise<Tool[]> => {
    const configPath = path.join(process.cwd(), 'mcp-servers.json');
    const mcpTools: Tool[] = [];

    let config: any;
    try {
        const configData = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(configData);
    } catch (e: any) {
        if (e.code !== 'ENOENT') {
            console.error(`[MCP] Error reading config: ${e.message}`);
        }
        return mcpTools; // No config file — nothing to load
    }

    const servers = config.mcpServers || config.servers || {};

    for (const [serverName, serverCfg] of Object.entries(servers as Record<string, any>)) {
        const conn = new MCPServerConnection(
            serverName,
            serverCfg.command,
            serverCfg.args || [],
            serverCfg.env || {}
        );

        try {
            await conn.connect();
            activeConnections.set(serverName, conn);

            // Discover tools from the server
            const remoteTools = await conn.listTools();
            console.log(`[MCP:${serverName}] Discovered ${remoteTools.length} tool(s).`);

            for (const remoteTool of remoteTools) {
                const qualifiedName = `mcp_${serverName.replace(/-/g, '_')}_${remoteTool.name}`;

                mcpTools.push({
                    name: qualifiedName,
                    description: `[MCP:${serverName}] ${remoteTool.description || remoteTool.name}`,
                    parameters: remoteTool.inputSchema || { type: 'object', properties: {} },
                    execute: async (args: Record<string, any>, context: ToolContext): Promise<string> => {
                        const connection = activeConnections.get(serverName);
                        if (!connection || !connection.isReady) {
                            return `Error: MCP server '${serverName}' is not connected. It may have crashed or been shut down.`;
                        }
                        try {
                            return await connection.callTool(remoteTool.name, args);
                        } catch (err: any) {
                            return `MCP tool execution error [${qualifiedName}]: ${err.message}`;
                        }
                    }
                });
            }
        } catch (err: any) {
            console.error(`[MCP:${serverName}] Failed to connect: ${err.message}`);
            // Server failed — skip its tools but don't crash the whole loader
        }
    }

    return mcpTools;
};
