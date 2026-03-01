import { ChannelEvent } from '../core/types';
import { OAuthStore } from '../core/oauth-store';
import { OAUTH_PROVIDERS, OAuthCredentials, resolveClientId, resolveClientSecret } from '../core/oauth-types';
import { buildOpenCodeZenCredentials } from '../providers/opencode-zen-oauth';
import { buildOpenCodeCredentials } from '../providers/opencode-oauth';
import crypto from 'crypto';
import { env } from '../core/env';

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Manual paste flow for headless/VPS

/**
 * Handles the `/auth <provider>` Telegram command.
 * 
 * Two modes:
 * 1. **OAuth providers** (gemini-cli, antigravity): Full PKCE flow with Google.
 * 2. **API-key providers** (opencode-zen, opencode): User pastes key from web UI.
 */
export class OAuthFlow {
    private static pendingFlows: Map<string, { provider: string; codeVerifier: string }> = new Map();
    private static pendingApiKeys: Map<string, string> = new Map();

    /**
     * Start an auth flow for a provider.
     */
    static async startFlow(event: ChannelEvent, providerName: string): Promise<void> {
        const config = OAUTH_PROVIDERS[providerName];
        if (!config) {
            const available = Object.keys(OAUTH_PROVIDERS).join(', ');
            await event.reply(`❌ Unknown provider '${providerName}'. Available: ${available}`);
            return;
        }

        // ─── API-Key providers (OpenCode) ───
        if (config.apiKeyBased) {
            OAuthFlow.pendingApiKeys.set(event.senderId, providerName);

            // Check if key is already in the environment
            const envKey = config.envVarNames?.map(name => env[name as keyof typeof env]).find(v => v);
            if (envKey) {
                // Auto-save from env var
                const creds = providerName === 'opencode-zen'
                    ? buildOpenCodeZenCredentials(String(envKey))
                    : buildOpenCodeCredentials(String(envKey));

                const store = OAuthStore.getInstance();
                store.saveCredentials(providerName, creds);
                OAuthFlow.pendingApiKeys.delete(event.senderId);

                await event.reply(
                    `✅ **${config.displayName}** authenticated automatically from environment variable!\n\n` +
                    `You can now use \`/provider ${providerName}\` to switch to this provider.`
                );
                return;
            }

            await event.reply(
                `🔑 **API Key Setup — ${config.displayName}**\n\n` +
                `${config.displayName} uses API keys (not OAuth).\n\n` +
                `1. Open this URL in your browser:\n${config.keyGenerationUrl}\n\n` +
                `2. Sign in and generate/copy your API key.\n` +
                `3. Send it back here as: \`/authcode <your-api-key>\`\n\n` +
                `⏰ Waiting for your key (expires in 10 minutes).`
            );

            setTimeout(() => OAuthFlow.pendingApiKeys.delete(event.senderId), 10 * 60 * 1000);
            return;
        }

        // ─── OAuth providers (Google) ───
        const clientId = resolveClientId(providerName);
        if (!clientId) {
            const envVarHint = providerName === 'gemini-cli'
                ? 'GEMINI_CLI_OAUTH_CLIENT_ID'
                : 'ANTIGRAVITY_CLIENT_ID';
            await event.reply(
                `❌ Missing client ID for ${config.displayName}.\n` +
                `Set the \`${envVarHint}\` environment variable and restart.`
            );
            return;
        }

        if (!config.authEndpoint) {
            await event.reply(`❌ Provider '${providerName}' does not have an authorization endpoint configured.`);
            return;
        }

        // Generate PKCE challenge
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto
            .createHash('sha256')
            .update(codeVerifier)
            .digest('base64url');

        // Store the pending flow keyed by senderId
        OAuthFlow.pendingFlows.set(event.senderId, { provider: providerName, codeVerifier });

        // Build authorization URL
        const params = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: REDIRECT_URI,
            scope: config.scopes || 'openid',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: event.senderId,
            access_type: 'offline',
            prompt: 'consent',
        });

        const authUrl = `${config.authEndpoint}?${params.toString()}`;

        await event.reply(
            `🔐 **OAuth Login — ${config.displayName}**\n\n` +
            `1. Open this URL in your browser:\n${authUrl}\n\n` +
            `2. Log in and authorize access.\n` +
            `3. Copy the authorization code you receive.\n` +
            `4. Send it back here as: \`/authcode <code>\`\n\n` +
            `⏰ This flow expires in 10 minutes.`
        );

        // Auto-expire after 10 minutes
        setTimeout(() => {
            OAuthFlow.pendingFlows.delete(event.senderId);
        }, 10 * 60 * 1000);
    }

    /**
     * Handle the `/authcode <code>` response from the user.
     * Works for both OAuth codes and API keys.
     */
    static async handleAuthCode(event: ChannelEvent, code: string): Promise<void> {
        // ─── Check for pending API-key flow ───
        const pendingApiKey = OAuthFlow.pendingApiKeys.get(event.senderId);
        if (pendingApiKey) {
            OAuthFlow.pendingApiKeys.delete(event.senderId);

            const config = OAUTH_PROVIDERS[pendingApiKey];
            const creds = pendingApiKey === 'opencode-zen'
                ? buildOpenCodeZenCredentials(code.trim())
                : buildOpenCodeCredentials(code.trim());

            const store = OAuthStore.getInstance();
            store.saveCredentials(pendingApiKey, creds);

            await event.reply(
                `✅ **${config.displayName}** API key saved!\n\n` +
                `You can now use \`/provider ${pendingApiKey}\` to switch to this provider.`
            );
            return;
        }

        // ─── Check for pending OAuth flow ───
        const pending = OAuthFlow.pendingFlows.get(event.senderId);
        if (!pending) {
            await event.reply('❌ No pending auth flow. Start one with `/auth <provider>`.');
            return;
        }

        const config = OAUTH_PROVIDERS[pending.provider];
        const clientId = resolveClientId(pending.provider);
        const clientSecret = resolveClientSecret(pending.provider);
        OAuthFlow.pendingFlows.delete(event.senderId);

        try {
            // Exchange authorization code for tokens
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
                client_id: clientId,
                code_verifier: pending.codeVerifier,
            });

            // Google requires client_secret for installed/desktop apps
            if (clientSecret) {
                body.append('client_secret', clientSecret);
            }

            const response = await fetch(config.tokenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
            }

            const data = await response.json() as any;

            const credentials: OAuthCredentials = {
                provider: pending.provider,
                access: data.access_token,
                refresh: data.refresh_token,
                expires: Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000,
            };

            // For Google providers, try to fetch the project ID
            if (config.tokenEndpoint.includes('googleapis.com')) {
                try {
                    const { getGeminiProjectId } = await import('../providers/gemini-cli-oauth');
                    credentials.projectId = await getGeminiProjectId(credentials.access);
                } catch { /* non-fatal */ }
            }

            const store = OAuthStore.getInstance();
            store.saveCredentials(pending.provider, credentials);

            await event.reply(
                `✅ **${config.displayName}** authenticated successfully!\n\n` +
                `Token expires: ${new Date(credentials.expires).toISOString()}\n` +
                (credentials.projectId ? `GCP Project: ${credentials.projectId}\n` : '') +
                `You can now use \`/provider ${pending.provider}\` to switch to this provider.`
            );
        } catch (error: any) {
            await event.reply(`❌ OAuth token exchange failed: ${error.message}`);
        }
    }

    /**
     * Check if a user has a pending auth flow (OAuth or API key).
     */
    static hasPendingFlow(senderId: string): boolean {
        return OAuthFlow.pendingFlows.has(senderId) || OAuthFlow.pendingApiKeys.has(senderId);
    }
}
