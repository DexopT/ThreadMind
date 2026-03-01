import type { OAuthCredentials } from '../core/oauth-types';

/**
 * OpenCode Zen uses API keys, NOT OAuth tokens.
 * The key is obtained from https://opencode.ai/auth web UI.
 * There is no token exchange or refresh — the key is long-lived.
 *
 * This helper wraps a raw API key into OAuthCredentials shape
 * for compatibility with the rest of the credential store.
 */
export function buildOpenCodeZenCredentials(rawKey: string): OAuthCredentials {
    return {
        provider: 'opencode-zen',
        access: rawKey,
        refresh: '',                  // not used — API-key flow
        expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
    };
}

/**
 * "Refresh" for OpenCode Zen — just returns the same key since it doesn't expire.
 * If the key is actually invalid, the API will return 401 and the user needs
 * to regenerate it at https://opencode.ai/auth.
 */
export async function refreshOpenCodeZenCredentials(
    credentials: OAuthCredentials
): Promise<OAuthCredentials> {
    // API keys don't expire, so just return the same credentials
    // with an extended expiry.
    if (!credentials.access) {
        throw new Error(
            'OpenCode Zen API key missing. Visit https://opencode.ai/auth to generate one, ' +
            'then set OPENCODE_ZEN_API_KEY or OPENCODE_API_KEY in your environment.'
        );
    }

    return {
        ...credentials,
        expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    };
}
