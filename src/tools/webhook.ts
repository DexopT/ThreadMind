import express from 'express';
import { Tool, ToolContext } from '../core/types';

const app = express();
app.use(express.json());

let webhookContext: ToolContext | null = null;
let server: any = null;
let registeredPaths = new Set<string>();

export const webhookTools: Tool[] = [
    {
        name: 'create_webhook',
        description: 'Exposes an HTTP POST endpoint that triggers the agent.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'API path (e.g. /github/webhook)' }
            },
            required: ['path']
        },
        execute: async (args: Record<string, any>, context: ToolContext): Promise<string> => {
            webhookContext = context;
            const routePath = args.path.startsWith('/') ? args.path : `/${args.path}`;

            if (registeredPaths.has(routePath)) {
                return `Webhook route ${routePath} already exists.`;
            }

            if (!server) {
                server = app.listen(3000, () => {
                    console.log('Webhook server listening on port 3000');
                });
            }

            app.post(routePath, async (req, res) => {
                if (webhookContext?.sendMessage) {
                    await webhookContext.sendMessage(`[Webhook received on ${routePath}]\nPayload: ${JSON.stringify(req.body)}`);
                }
                res.status(200).send({ status: 'received' });
            });

            registeredPaths.add(routePath);
            return `Exposed POST endpoint at http://localhost:3000${routePath}`;
        }
    }
];
