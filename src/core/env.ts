import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1, "Telegram Bot Token is required"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    OPENCODE_API_KEY: z.string().optional(),
    OPENCODE_BASE_URL: z.string().url().optional(),
    OPENCODE_ZEN_BASE_URL: z.string().url().optional(),
    GEMINI_CLI_OAUTH_CLIENT_ID: z.string().optional(),
    GEMINI_CLI_OAUTH_CLIENT_SECRET: z.string().optional(),
    ANTIGRAVITY_CLIENT_ID: z.string().optional(),
    ANTIGRAVITY_CLIENT_SECRET: z.string().optional(),
    PROXYPAL_API_KEY: z.string().optional(),
    PROXYPAL_BASE_URL: z.string().url().optional(),
    SERPAPI_API_KEY: z.string().optional(),
    PORT: z.coerce.number().optional().default(3000),
    NODE_ENV: z.union([z.literal('development'), z.literal('production'), z.literal('test')]).default('development'),
    ENCRYPTION_KEY: z.string().length(32).optional(),
    ADMIN_USER_ID: z.string().optional(),
    DOCKER_MAX_RAM: z.string().default('2g'),
    DOCKER_MAX_SWAP: z.string().default('4g'),
    DOCKER_MAX_CPUS: z.string().default('1.0'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
    console.error("❌ Invalid environment variables:", _env.error.format());
    process.exit(1);
}

export const env = _env.data;

export let isPrivileged = process.argv.includes('/privileged');

export function setPrivileged(value: boolean) {
    isPrivileged = value;
}
