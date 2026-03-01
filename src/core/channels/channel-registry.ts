// src/core/channels/channel-registry.ts
// Channel Registry — manages all channel adapters

import { ChannelAdapter } from './types';

export class ChannelRegistry {
    private adapters = new Map<string, ChannelAdapter>();

    register(adapter: ChannelAdapter): this {
        this.adapters.set(adapter.channelType, adapter);
        return this;
    }

    get(channelType: string): ChannelAdapter {
        const adapter = this.adapters.get(channelType);
        if (!adapter) throw new Error(`Channel adapter "${channelType}" not registered`);
        return adapter;
    }

    async startAll(): Promise<void> {
        await Promise.all([...this.adapters.values()].map(a => a.start()));
    }

    async stopAll(): Promise<void> {
        await Promise.all([...this.adapters.values()].map(a => a.stop()));
    }
}

export const channelRegistry = new ChannelRegistry();
