import type { OAuthCredentials } from '../core/oauth-types';
import { env } from '../core/env';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Refresh an existing Gemini CLI OAuth token using the refresh_token grant.
 */
export async function refreshGeminiCliCredentials(
    credentials: OAuthCredentials
): Promise<OAuthCredentials> {
    const refreshToken = credentials.refresh?.trim();
    if (!refreshToken) throw new Error('Gemini CLI refresh token missing. Please re-authenticate via /auth gemini-cli.');

    const clientId = env.GEMINI_CLI_OAUTH_CLIENT_ID ?? '';
    if (!clientId) throw new Error('GEMINI_CLI_OAUTH_CLIENT_ID env var is not set.');

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
    });

    // Some installations also require a client secret
    if (env.GEMINI_CLI_OAUTH_CLIENT_SECRET) {
        body.set('client_secret', env.GEMINI_CLI_OAUTH_CLIENT_SECRET);
    }

    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini CLI token refresh failed (${response.status}): ${errorText}. Please re-authenticate via /auth gemini-cli.`);
    }

    const payload = await response.json() as any;

    return {
        ...credentials,
        access: payload.access_token,
        refresh: payload.refresh_token || refreshToken,
        expires: Date.now() + (payload.expires_in || 3600) * 1000 - 5 * 60 * 1000, // 5 min safety margin
    };
}

/**
 * Helper to pull the Google Cloud project ID after we have an access token.
 * Gemini CLI needs this embedded into the API key for requests.
 */
export async function getGeminiProjectId(accessToken: string): Promise<string> {
    try {
        const resp = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) return '';
        const json = await resp.json() as any;
        return json.projects?.[0]?.projectId ?? '';
    } catch {
        return '';
    }
}
