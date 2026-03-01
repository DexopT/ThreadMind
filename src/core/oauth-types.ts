import { env } from './env';
/**
 * OAuth Credentials — unified shape for both OAuth tokens and API keys.
 */
export interface OAuthCredentials {
    /** The access token or API key string */
    access: string;
    /** The refresh token string (empty for API-key providers) */
    refresh?: string;
    /** Expiration timestamp in absolute milliseconds (Date.now() + expiresIn * 1000) */
    expires: number;
    /** Provider identifier (e.g. 'opencode-zen', 'gemini-cli', 'antigravity', 'opencode') */
    provider: string;
    /** Optional: Google Cloud project ID (for Gemini CLI / Antigravity) */
    projectId?: string;
}

/**
 * Configuration for a provider endpoint.
 * Providers can be either full-OAuth (with auth + token endpoints)
 * or API-key based (just a web UI link for key generation).
 */
export interface OAuthProviderConfig {
    /** Unique provider key */
    provider: string;
    /** Display name */
    displayName: string;
    /** Token endpoint URL for token exchange & refresh (empty for API-key providers) */
    tokenEndpoint: string;
    /** OAuth client ID (read from env for one-click auth) */
    clientId: string;
    /** OAuth scopes (space separated) */
    scopes?: string;
    /** Authorization endpoint for initial login (empty for API-key providers) */
    authEndpoint?: string;
    /** Whether this provider uses a static API key instead of OAuth */
    apiKeyBased?: boolean;
    /** For API-key providers: URL where user obtains the key */
    keyGenerationUrl?: string;
    /** Env var names to read the API key from */
    envVarNames?: string[];
}

/**
 * Registry of known provider configurations.
 *
 * - Gemini CLI & Antigravity use Google OAuth (PKCE + refresh tokens).
 *   Client IDs come from env vars for zero-config one-click auth.
 * - OpenCode Zen & OpenCode use static API keys from https://opencode.ai/auth.
 */
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
    'gemini-cli': {
        provider: 'gemini-cli',
        displayName: 'Gemini CLI',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        clientId: '', // Read from GEMINI_CLI_OAUTH_CLIENT_ID env var at runtime
        scopes: [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
        ].join(' '),
        authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    },
    'antigravity': {
        provider: 'antigravity',
        displayName: 'Antigravity',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        clientId: '', // Read from ANTIGRAVITY_CLIENT_ID env var at runtime
        scopes: [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
        ].join(' '),
        authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    },
    'opencode-zen': {
        provider: 'opencode-zen',
        displayName: 'OpenCode Zen',
        tokenEndpoint: '',          // No token endpoint — API-key based
        clientId: '',
        apiKeyBased: true,
        keyGenerationUrl: 'https://opencode.ai/auth',
        envVarNames: ['OPENCODE_ZEN_API_KEY', 'OPENCODE_API_KEY'],
    },
    'opencode': {
        provider: 'opencode',
        displayName: 'OpenCode',
        tokenEndpoint: '',          // No token endpoint — API-key based
        clientId: '',
        apiKeyBased: true,
        keyGenerationUrl: 'https://opencode.ai/auth',
        envVarNames: ['OPENCODE_API_KEY'],
    },
};

/**
 * Resolve the runtime client ID for a provider from env vars.
 * This enables zero-config auth — no hardcoded secrets in source.
 */
export function resolveClientId(providerKey: string): string {
    switch (providerKey) {
        case 'gemini-cli':
            return env.GEMINI_CLI_OAUTH_CLIENT_ID ?? '';
        case 'antigravity':
            return env.ANTIGRAVITY_CLIENT_ID ?? '';
        default:
            return OAUTH_PROVIDERS[providerKey]?.clientId ?? '';
    }
}

/**
 * Resolve the runtime client secret for a provider from env vars.
 */
export function resolveClientSecret(providerKey: string): string {
    switch (providerKey) {
        case 'gemini-cli':
            return env.GEMINI_CLI_OAUTH_CLIENT_SECRET ?? '';
        case 'antigravity':
            return env.ANTIGRAVITY_CLIENT_SECRET ?? '';
        default:
            return '';
    }
}
