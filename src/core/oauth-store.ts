import fs from 'fs';
import path from 'path';
import { OAuthCredentials, OAUTH_PROVIDERS } from './oauth-types';
import { encrypt, decrypt } from './crypto';

const STORE_PATH = path.join(process.cwd(), 'data', 'auth', 'oauth-credentials.json');

// Ensure directory exists
const storeDir = path.dirname(STORE_PATH);
if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
}

type RefreshFunction = (creds: OAuthCredentials) => Promise<OAuthCredentials>;

/**
 * Central credential store with file-backed persistence.
 * Handles both OAuth token providers and API-key providers.
 */
export class OAuthStore {
    private static instance: OAuthStore;
    private credentials: Record<string, OAuthCredentials> = {};
    private refreshLocks: Set<string> = new Set();
    private refreshFunctions: Map<string, RefreshFunction> = new Map();

    private constructor() {
        this.load();
        this.registerBuiltinRefreshFunctions();
    }

    static getInstance(): OAuthStore {
        if (!OAuthStore.instance) {
            OAuthStore.instance = new OAuthStore();
        }
        return OAuthStore.instance;
    }

    /** Register all built-in refresh functions */
    private registerBuiltinRefreshFunctions() {
        // Gemini CLI — Google OAuth refresh
        this.refreshFunctions.set('gemini-cli', async (creds) => {
            const { refreshGeminiCliCredentials } = await import('../providers/gemini-cli-oauth');
            return refreshGeminiCliCredentials(creds);
        });

        // Antigravity — Google OAuth refresh (separate client ID)
        this.refreshFunctions.set('antigravity', async (creds) => {
            const { refreshAntigravityCredentials } = await import('../providers/antigravity-oauth');
            return refreshAntigravityCredentials(creds);
        });

        // OpenCode Zen — API key, no real refresh
        this.refreshFunctions.set('opencode-zen', async (creds) => {
            const { refreshOpenCodeZenCredentials } = await import('../providers/opencode-zen-oauth');
            return refreshOpenCodeZenCredentials(creds);
        });

        // OpenCode — API key, no real refresh
        this.refreshFunctions.set('opencode', async (creds) => {
            const { refreshOpenCodeCredentials } = await import('../providers/opencode-oauth');
            return refreshOpenCodeCredentials(creds);
        });
    }

    /** Register a custom refresh function for a provider */
    registerRefresh(provider: string, fn: RefreshFunction) {
        this.refreshFunctions.set(provider, fn);
    }

    /** Load credentials from disk */
    private load() {
        try {
            if (fs.existsSync(STORE_PATH)) {
                const raw = fs.readFileSync(STORE_PATH, 'utf-8');
                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) { /* Might be encrypted, not JSON */ }

                if (parsed && typeof parsed === 'object' && Object.values(parsed).some((v: any) => typeof v === 'object' && 'access' in v)) {
                    // This looks like the old plaintext format.
                    console.log("[OAuthStore] Migrating plaintext credentials to encrypted format...");
                    this.credentials = parsed;
                    // Immediately save to overwrite with encrypted format
                    this.save();
                } else {
                    // Should be encrypted format
                    try {
                        const decrypted = decrypt(raw);
                        this.credentials = JSON.parse(decrypted);
                    } catch (decErr) {
                        console.error('[OAuthStore] Failed to decrypt credentials. They might be corrupted or ENCRYPTION_KEY changed.', decErr);
                        this.credentials = {};
                    }
                }
            }
        } catch (e) {
            console.error('[OAuthStore] Failed to load credentials:', e);
            this.credentials = {};
        }
    }

    /** Persist credentials to disk securely */
    private save() {
        const rawJson = JSON.stringify(this.credentials);
        const encrypted = encrypt(rawJson);
        fs.writeFileSync(STORE_PATH, encrypted, 'utf-8');
    }

    /** Get stored credentials for a provider */
    getCredentials(provider: string): OAuthCredentials | null {
        return this.credentials[provider] || null;
    }

    /** Save new credentials for a provider */
    saveCredentials(provider: string, creds: OAuthCredentials) {
        this.credentials[provider] = creds;
        this.save();
    }

    /** Remove credentials for a provider */
    removeCredentials(provider: string) {
        delete this.credentials[provider];
        this.save();
    }

    /** Check if a provider has valid (non-expired) credentials */
    hasValidCredentials(provider: string): boolean {
        const creds = this.getCredentials(provider);
        if (!creds) return false;
        return Date.now() < (creds.expires - 60000);
    }

    /**
     * Get a valid API key / access token for a provider, refreshing if expired.
     */
    async getApiKey(provider: string): Promise<string> {
        const creds = this.getCredentials(provider);
        if (!creds) {
            throw new Error(`No credentials stored for '${provider}'. Run /auth ${provider} to authenticate.`);
        }

        // If token/key is still valid, return it
        if (Date.now() < (creds.expires - 60000)) {
            return this.buildApiKey(provider, creds);
        }

        // Token expired — refresh with lock
        return this.refreshWithLock(provider, creds);
    }

    /**
     * Build the API key string.
     * For Google providers: JSON with token + projectId (if available).
     * For API-key providers: raw key string.
     */
    private buildApiKey(provider: string, credentials: OAuthCredentials): string {
        const isGoogleProvider = provider === 'gemini-cli' || provider === 'antigravity';

        if (isGoogleProvider && credentials.projectId) {
            return JSON.stringify({
                token: credentials.access,
                projectId: credentials.projectId,
            });
        }

        return credentials.access;
    }

    /**
     * Mutex-style refresh to prevent multiple concurrent refreshes.
     */
    private async refreshWithLock(provider: string, creds: OAuthCredentials): Promise<string> {
        // Simple spin-wait if another refresh is in progress
        if (this.refreshLocks.has(provider)) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const updated = this.getCredentials(provider);
            if (updated && Date.now() < (updated.expires - 60000)) {
                return this.buildApiKey(provider, updated);
            }
            throw new Error(`Credential refresh for '${provider}' timed out. Try again.`);
        }

        this.refreshLocks.add(provider);
        try {
            const refreshFn = this.refreshFunctions.get(provider);
            if (!refreshFn) {
                throw new Error(`No refresh function registered for provider '${provider}'.`);
            }

            console.log(`[OAuthStore] Refreshing credentials for '${provider}'...`);
            const newCreds = await refreshFn(creds);
            this.saveCredentials(provider, newCreds);
            console.log(`[OAuthStore] Credentials refreshed for '${provider}'. Expires at ${new Date(newCreds.expires).toISOString()}.`);

            return this.buildApiKey(provider, newCreds);
        } finally {
            this.refreshLocks.delete(provider);
        }
    }
}
