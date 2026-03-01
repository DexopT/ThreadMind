// src/core/llm/provider-registry.ts
// Provider-Agnostic LLM Layer — Registry

import { LLMProvider } from './types';

export class LLMProviderRegistry {
    private providers = new Map<string, LLMProvider>();
    private defaultProviderName: string = '';

    register(provider: LLMProvider): this {
        this.providers.set(provider.name, provider);
        if (!this.defaultProviderName) this.defaultProviderName = provider.name;
        return this;
    }

    setDefault(providerName: string): this {
        if (!this.providers.has(providerName)) {
            throw new Error(`Provider "${providerName}" is not registered`);
        }
        this.defaultProviderName = providerName;
        return this;
    }

    get(providerName?: string): LLMProvider {
        const name = providerName ?? this.defaultProviderName;
        const provider = this.providers.get(name);
        if (!provider) throw new Error(`LLM provider "${name}" not found`);
        return provider;
    }

    async getHealthy(preferredName?: string): Promise<LLMProvider> {
        // Try preferred first, then fallback to any healthy provider
        const candidates = preferredName
            ? [preferredName, ...Array.from(this.providers.keys()).filter(k => k !== preferredName)]
            : Array.from(this.providers.keys());

        for (const name of candidates) {
            const provider = this.providers.get(name)!;
            if (await provider.isAvailable()) return provider;
        }
        throw new Error('No healthy LLM providers available');
    }

    listAll(): string[] {
        return Array.from(this.providers.keys());
    }
}

// Singleton - import this everywhere
export const providerRegistry = new LLMProviderRegistry();
