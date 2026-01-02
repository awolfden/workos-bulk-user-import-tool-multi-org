export class RateLimiter {
    capacity;
    tokens;
    queue;
    intervalMs;
    timer;
    constructor(tokensPerSecond, burstCapacity = tokensPerSecond) {
        const tps = Math.max(1, Math.floor(tokensPerSecond));
        this.capacity = Math.max(1, Math.floor(burstCapacity));
        this.tokens = this.capacity;
        this.queue = [];
        this.intervalMs = Math.max(1, Math.floor(1000 / tps)); // e.g., 20ms for 50 rps
        this.timer = setInterval(() => {
            // Refill one token per tick up to capacity
            if (this.tokens < this.capacity) {
                this.tokens += 1;
            }
            this.drain();
        }, this.intervalMs);
        // Do not keep the event loop alive just for the limiter
        this.timer.unref?.();
    }
    async acquire() {
        if (this.tokens > 0) {
            this.tokens -= 1;
            return;
        }
        await new Promise(resolve => {
            this.queue.push(resolve);
        });
    }
    drain() {
        while (this.tokens > 0 && this.queue.length > 0) {
            this.tokens -= 1;
            const next = this.queue.shift();
            if (next)
                next();
        }
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
        }
    }
}
