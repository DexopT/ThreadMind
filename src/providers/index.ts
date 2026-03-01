import fs from 'fs';
import path from 'path';
import { Provider } from '../core/types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { OpenCodeZenProvider } from './opencode-zen';
import { GeminiCliProvider } from './gemini-cli';
import { AntigravityOAuthProvider } from './antigravity';
import { OpenCodeProvider } from './opencode';
import { ProxyPalProvider } from './proxypal';
import { OAuthStore } from '../core/oauth-store';
import { refreshOpenCodeZenCredentials } from './opencode-zen-oauth';
import { refreshGeminiCliCredentials } from './gemini-cli-oauth';
import { refreshAntigravityCredentials } from './antigravity-oauth';
import { refreshOpenCodeCredentials } from './opencode-oauth';
import { env } from '../core/env';

const MODEL_PREF_PATH = path.join(process.cwd(), 'data', 'config', 'model-preference.json');

export class ProviderManager {
    private providers: Map<string, Provider> = new Map();
    private activeProviderName: string = 'openai';

    /** True when ProxyPal was detected but the user hasn't picked a default model yet */
    public pendingProxyPalSetup: boolean = false;

    /** Cached ProxyPal model IDs (populated during initProxyPal) */
    public proxyPalModelIds: string[] = [];

    constructor() {
        // Empty, we init after dotenv loads
    }

    init() {
        // Static key providers
        this.register(new OpenAIProvider());
        this.register(new AnthropicProvider());
        this.register(new GoogleProvider());

        // OAuth-backed providers
        this.register(new OpenCodeZenProvider());
        this.register(new GeminiCliProvider());
        this.register(new AntigravityOAuthProvider());
        this.register(new OpenCodeProvider());

        // ProxyPal — local AI proxy gateway (always registered; availability checked async)
        this.register(new ProxyPalProvider());

        // Wire refresh functions into the central OAuthStore
        const oauthStore = OAuthStore.getInstance();
        oauthStore.registerRefresh('opencode-zen', refreshOpenCodeZenCredentials);
        oauthStore.registerRefresh('gemini-cli', refreshGeminiCliCredentials);
        oauthStore.registerRefresh('antigravity', refreshAntigravityCredentials);
        oauthStore.registerRefresh('opencode', refreshOpenCodeCredentials);

        // Auto-detect active provider from static keys
        if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
            this.activeProviderName = 'openai';
        } else if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here') {
            this.activeProviderName = 'anthropic';
        } else if (env.GOOGLE_API_KEY && env.GOOGLE_API_KEY !== 'your_google_api_key_here') {
            this.activeProviderName = 'google';
        }

        // Auto-detect from OAuth store as fallback
        if (this.activeProviderName === 'openai' && (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'your_openai_api_key_here')) {
            for (const oauthProvider of ['opencode-zen', 'gemini-cli', 'antigravity', 'opencode']) {
                if (oauthStore.hasValidCredentials(oauthProvider)) {
                    this.activeProviderName = oauthProvider;
                    console.log(`[ProviderManager] Auto-selected OAuth provider: ${oauthProvider}`);
                    break;
                }
            }
        }

        // Load persisted model preference (overrides auto-detection)
        this.loadPreference();
    }

    /**
     * Async initialization for ProxyPal:
     * 1. Checks if ProxyPal is running locally
     * 2. Fetches all available models from the API
     * 3. Populates the dynamic model→provider mapping
     * 4. Auto-selects proxypal if no other provider is strongly configured
     * 5. Sets pendingProxyPalSetup=true if no default model has been chosen yet
     */
    async initProxyPal(): Promise<void> {
        const available = await ProxyPalProvider.isAvailable();
        if (!available) {
            console.log('[ProviderManager] ProxyPal not detected at', env.PROXYPAL_BASE_URL || 'http://127.0.0.1:8317/v1');
            return;
        }

        console.log('[ProviderManager] ProxyPal detected! Fetching models...');
        const models = await ProxyPalProvider.listModels();
        this.proxyPalModelIds = models.map(m => m.id);

        // Dynamically populate MODEL_TO_PROVIDER for all ProxyPal models
        for (const model of models) {
            ProviderManager.MODEL_TO_PROVIDER[model.id] = 'proxypal';
        }

        console.log(`[ProviderManager] ProxyPal: ${models.length} models registered (${[...new Set(models.map(m => m.owned_by))].join(', ')})`);

        // Auto-select proxypal if no strong preference is saved
        const hasSavedPref = this.loadedPreferenceProvider !== undefined;
        if (!hasSavedPref || this.loadedPreferenceProvider === 'openai') {
            // Check if user has a real OpenAI key
            const hasRealOpenAI = env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'your_openai_api_key_here';
            if (!hasRealOpenAI) {
                this.activeProviderName = 'proxypal';
                this.pendingProxyPalSetup = true;
                console.log('[ProviderManager] ProxyPal auto-selected as active provider (no other provider configured)');
            }
        }

        // If preference was already proxypal, restore the model
        if (this.loadedPreferenceProvider === 'proxypal' && this.modelOverride) {
            ProxyPalProvider.defaultModel = this.modelOverride;
            this.pendingProxyPalSetup = false;
        }
    }

    /** Track what provider was loaded from disk (for initProxyPal decision-making) */
    private loadedPreferenceProvider: string | undefined;

    register(provider: Provider) {
        this.providers.set(provider.name, provider);
    }

    setActive(name: string) {
        if (!this.providers.has(name)) {
            throw new Error(`Provider '${name}' not found. Available: ${this.getAvailableProviders().join(', ')}`);
        }
        this.activeProviderName = name;
        this.modelOverride = undefined;
        this.savePreference();
    }

    getActive(): Provider {
        return this.providers.get(this.activeProviderName)!;
    }

    getAvailableProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    /** Current model override (set by /model <model-name>) */
    public modelOverride: string | undefined;

    /** Map of model names → provider. Populated from static lists + dynamically from ProxyPal. */
    private static MODEL_TO_PROVIDER: Record<string, string> = {
        // OpenCode Zen free models (bare names — API format)
        'kimi-k2.5': 'opencode-zen',
        'minimax-m2.5-free': 'opencode-zen',
        'glm-5-free': 'opencode-zen',
        'big-pickle': 'opencode-zen',
        // OpenCode Zen paid models
        'claude-sonnet-4-20250514': 'opencode-zen',
        'claude-opus-4-5': 'opencode-zen',
        'claude-haiku-4-5': 'opencode-zen',
        'gpt-5.1-codex': 'opencode-zen',
        'gpt-5.1': 'opencode-zen',
        'gpt-5.2': 'opencode-zen',
        'gpt-5.2-codex': 'opencode-zen',
        // Also accept with opencode/ prefix (user might type it from docs)
        'opencode/kimi-k2.5': 'opencode-zen',
        'opencode/minimax-m2.5-free': 'opencode-zen',
        'opencode/glm-5-free': 'opencode-zen',
        'opencode/big-pickle': 'opencode-zen',
        'opencode/claude-sonnet-4-20250514': 'opencode-zen',
        'opencode/claude-opus-4-5': 'opencode-zen',
        // Google
        'gemini-2.5-flash': 'google',
        'gemini-2.5-pro': 'google',
        'gemini-2.0-flash': 'google',
        // OpenAI
        'gpt-4o': 'openai',
        'gpt-4o-mini': 'openai',
        'o1': 'openai',
        'o3-mini': 'openai',
        // Anthropic
        'claude-3.5-haiku': 'anthropic',
        'claude-3-opus': 'anthropic',
    };

    /**
     * Set active provider by model name. If the name matches a model,
     * it auto-selects the provider and sets the model override.
     * Returns the resolved model name for confirmation.
     */
    async setActiveModel(nameOrModel: string): Promise<{ provider: string; model?: string }> {
        // First try as a provider name
        if (this.providers.has(nameOrModel)) {
            this.setActive(nameOrModel);
            return { provider: nameOrModel };
        }

        // Try as a model name (with or without opencode/ prefix)
        const providerName = ProviderManager.MODEL_TO_PROVIDER[nameOrModel]
            || ProviderManager.MODEL_TO_PROVIDER[`opencode/${nameOrModel}`];

        if (providerName && this.providers.has(providerName)) {
            this.activeProviderName = providerName;
            this.modelOverride = nameOrModel;

            // If selecting a ProxyPal model, also update the default
            if (providerName === 'proxypal') {
                ProxyPalProvider.defaultModel = nameOrModel;
                this.pendingProxyPalSetup = false;
            }

            this.savePreference();
            return { provider: providerName, model: nameOrModel };
        }

        // Also check if it's a ProxyPal model that was fetched dynamically on boot
        if (this.proxyPalModelIds.includes(nameOrModel)) {
            this.activeProviderName = 'proxypal';
            this.modelOverride = nameOrModel;
            ProxyPalProvider.defaultModel = nameOrModel;
            this.pendingProxyPalSetup = false;
            this.savePreference();
            return { provider: 'proxypal', model: nameOrModel };
        }

        // Late-boot ProxyPal check (in case proxy started after the bot)
        if (this.providers.has('proxypal')) {
            try {
                const proxyIds = await ProxyPalProvider.listModelIds();
                if (proxyIds.includes(nameOrModel)) {
                    // Cache it for next time
                    this.proxyPalModelIds = proxyIds;
                    for (const id of proxyIds) ProviderManager.MODEL_TO_PROVIDER[id] = 'proxypal';

                    this.activeProviderName = 'proxypal';
                    this.modelOverride = nameOrModel;
                    ProxyPalProvider.defaultModel = nameOrModel;
                    this.pendingProxyPalSetup = false;
                    this.savePreference();
                    return { provider: 'proxypal', model: nameOrModel };
                }
            } catch (e) {
                // Ignore failure if proxy is still offline
            }
        }

        throw new Error(
            `'${nameOrModel}' is not a known provider or model.\n` +
            `Providers: ${this.getAvailableProviders().join(', ')}\n` +
            `Try /model to see all available models.`
        );
    }

    /** Persist the active provider and model override to disk */
    private savePreference() {
        try {
            const dir = path.dirname(MODEL_PREF_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(MODEL_PREF_PATH, JSON.stringify({
                provider: this.activeProviderName,
                model: this.modelOverride || null,
            }, null, 2), 'utf-8');
        } catch (e) {
            console.error('[ProviderManager] Failed to save model preference:', e);
        }
    }

    /** Load the persisted model preference on startup */
    private loadPreference() {
        try {
            if (!fs.existsSync(MODEL_PREF_PATH)) return;
            const raw = JSON.parse(fs.readFileSync(MODEL_PREF_PATH, 'utf-8'));
            if (raw.provider && this.providers.has(raw.provider)) {
                this.activeProviderName = raw.provider;
                this.modelOverride = raw.model || undefined;
                this.loadedPreferenceProvider = raw.provider;
                console.log(`[ProviderManager] Restored preference: provider=${raw.provider}${raw.model ? `, model=${raw.model}` : ''}`);
            }
        } catch (e) {
            console.error('[ProviderManager] Failed to load model preference:', e);
        }
    }
}

export const providerManager = new ProviderManager();


