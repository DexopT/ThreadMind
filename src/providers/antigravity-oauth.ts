import type { OAuthCredentials } from '../core/oauth-types';
import { env } from '../core/env';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Refresh an existing Antigravity OAuth token using the refresh_token grant.
 * Antigravity re-uses Google's OAuth endpoints but with its own client ID.
 */
export async function refreshAntigravityCredentials(
    credentials: OAuthCredentials
): Promise<OAuthCredentials> {
    const refreshToken = credentials.refresh?.trim();
    if (!refreshToken) throw new Error('Antigravity refresh token missing. Please re-authenticate via /auth antigravity.');

    const clientId = env.ANTIGRAVITY_CLIENT_ID ?? '';
    if (!clientId) throw new Error('ANTIGRAVITY_CLIENT_ID env var is not set.');

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
    });

    if (env.ANTIGRAVITY_CLIENT_SECRET) {
        body.set('client_secret', env.ANTIGRAVITY_CLIENT_SECRET);
    }

    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Antigravity token refresh failed (${response.status}): ${errorText}. Please re-authenticate via /auth antigravity.`);
    }

    const payload = await response.json() as any;

    return {
        ...credentials,
        access: payload.access_token,
        refresh: payload.refresh_token || refreshToken,
        expires: Date.now() + (payload.expires_in || 3600) * 1000 - 5 * 60 * 1000,
    };
}
