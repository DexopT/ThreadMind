import type { OAuthCredentials } from '../core/oauth-types';

/**
 * OpenCode (generic / non-Zen) also uses API keys — NOT OAuth tokens.
 * Same flow as OpenCode Zen: obtain key from https://opencode.ai/auth.
 */
export function buildOpenCodeCredentials(rawKey: string): OAuthCredentials {
    return {
        provider: 'opencode',
        access: rawKey,
        refresh: '',
        expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    };
}

/**
 * "Refresh" for OpenCode — just returns the same key since it doesn't expire.
 */
export async function refreshOpenCodeCredentials(
    credentials: OAuthCredentials
): Promise<OAuthCredentials> {
    if (!credentials.access) {
        throw new Error(
            'OpenCode API key missing. Visit https://opencode.ai/auth to generate one, ' +
            'then set OPENCODE_API_KEY in your environment.'
        );
    }

    return {
        ...credentials,
        expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    };
}
