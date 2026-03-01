import { ToolContext } from '../core/types';

export class HeartbeatSystem {
    private interval: NodeJS.Timeout | null = null;
    private checkFn: (context: ToolContext) => Promise<void>;

    constructor(checkFn: (context: ToolContext) => Promise<void>) {
        this.checkFn = checkFn;
    }

    start(context: ToolContext, intervalMs: number = 60000) {
        if (this.interval) return;
        this.interval = setInterval(async () => {
            try {
                await this.checkFn(context);
            } catch (error) {
                console.error('Heartbeat check failed:', error);
            }
        }, intervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
