export interface RateLimiterOptions {
    windowMs: number;
    maxRequests: number;
}

interface UserState {
    count: number;
    lastReset: number;
    isBlocked: boolean;
}

export class RateLimiter {
    private users: Map<string, UserState> = new Map();
    private options: RateLimiterOptions;

    constructor(options: RateLimiterOptions) {
        this.options = options;

        // Cleanup interval every windowMs * 2
        setInterval(() => this.cleanup(), this.options.windowMs * 2);
    }

    /**
     * Checks if a user is allowed to perform an action.
     * @param userId The ID of the user
     * @returns True if allowed, False if rate limited
     */
    public consume(userId: string): boolean {
        const now = Date.now();
        let state = this.users.get(userId);

        if (!state) {
            state = { count: 0, lastReset: now, isBlocked: false };
            this.users.set(userId, state);
        }

        // Reset if window has passed
        if (now - state.lastReset > this.options.windowMs) {
            state.count = 0;
            state.lastReset = now;
            state.isBlocked = false;
        }

        if (state.isBlocked) {
            return false;
        }

        state.count++;

        if (state.count > this.options.maxRequests) {
            state.isBlocked = true;
            return false;
        }

        return true;
    }

    public isBlocked(userId: string): boolean {
        const state = this.users.get(userId);
        if (!state) return false;

        const now = Date.now();
        if (now - state.lastReset > this.options.windowMs) {
            state.count = 0;
            state.lastReset = now;
            state.isBlocked = false;
        }
        return state.isBlocked;
    }

    private cleanup() {
        const now = Date.now();
        for (const [userId, state] of this.users.entries()) {
            if (now - state.lastReset > this.options.windowMs * 2) {
                this.users.delete(userId);
            }
        }
    }
}
