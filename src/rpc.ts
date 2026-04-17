import { Connection } from "@solana/web3.js";
import { CONFIG } from "./config.js";

export class RpcManager {
  private connections: Connection[];
  private currentIndex = 0;
  private failCounts: number[];

  constructor() {
    this.connections = CONFIG.RPC_URLS.map(
      (url) => new Connection(url, "confirmed"),
    );
    this.failCounts = new Array(CONFIG.RPC_URLS.length).fill(0);
    console.log(`[RPC] Loaded ${CONFIG.RPC_URLS.length} endpoints:`);
    for (const url of CONFIG.RPC_URLS) {
      console.log(`  - ${url}`);
    }
  }

  // Get current connection
  get connection(): Connection {
    return this.connections[this.currentIndex]!;
  }

  get currentUrl(): string {
    return CONFIG.RPC_URLS[this.currentIndex]!;
  }

  // Mark current RPC as failed, rotate to next
  rotate(): void {
    this.failCounts[this.currentIndex]!++;
    const prev = this.currentUrl;
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
    console.log(`[RPC] Rotating: ${prev} -> ${this.currentUrl}`);
  }

  // Execute a function with automatic fallback
  async withFallback<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.connections.length; attempt++) {
      try {
        const result = await fn(this.connection);
        // Reset fail count on success
        this.failCounts[this.currentIndex] = 0;
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRateLimit =
          lastError.message.includes("429") ||
          lastError.message.includes("rate") ||
          lastError.message.includes("Too many requests");

        if (isRateLimit || lastError.message.includes("timeout")) {
          console.log(
            `[RPC] ${this.currentUrl} failed: ${lastError.message.slice(0, 80)}`,
          );
          this.rotate();
        } else {
          // Non-RPC error, don't rotate
          throw lastError;
        }
      }
    }

    throw new Error(
      `All ${this.connections.length} RPC endpoints failed. Last error: ${lastError?.message}`,
    );
  }
}
