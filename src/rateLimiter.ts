export class RateLimiter {
  private readonly capacity: number;
  private tokens: number;
  private readonly queue: Array<() => void>;
  private readonly intervalMs: number;
  private readonly timer: NodeJS.Timeout;

  constructor(tokensPerSecond: number, burstCapacity: number = tokensPerSecond) {
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
    (this.timer as any).unref?.();
  }

  async acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens -= 1;
      return;
    }
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  private drain(): void {
    while (this.tokens > 0 && this.queue.length > 0) {
      this.tokens -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}


