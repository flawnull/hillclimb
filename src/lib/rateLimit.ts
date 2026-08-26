/**
 * VAL BORBERA HILLCLIMB — Rate Limiting Utility
 * Provides edge rate limiting with @upstash/ratelimit when Redis credentials exist,
 * and an in-memory sliding window fallback for local development.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getRedis } from "./redis";

// In-memory sliding window for development fallback
class MemoryRateLimiter {
  private hits = new Map<string, number[]>();

  public limit(key: string, maxRequests: number, windowMs: number): { success: boolean } {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= maxRequests) {
      this.hits.set(key, timestamps);
      return { success: false };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { success: true };
  }
}

const memoryLimiter = new MemoryRateLimiter();

// Cache Ratelimit instances per config
const ratelimitInstances = new Map<string, Ratelimit>();

export async function checkRateLimit(
  identifier: string,
  maxRequests: number = 10,
  windowSeconds: number = 60
): Promise<{ success: boolean }> {
  try {
    const redis = getRedis();

    if (redis instanceof Redis) {
      const cacheKey = `${maxRequests}_${windowSeconds}`;
      let limiter = ratelimitInstances.get(cacheKey);

      if (!limiter) {
        limiter = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
          prefix: `ratelimit_${cacheKey}`,
        });
        ratelimitInstances.set(cacheKey, limiter);
      }

      const res = await limiter.limit(identifier);
      return { success: res.success };
    }
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      throw err;
    }
  }

  // Fallback in development / testing
  return memoryLimiter.limit(identifier, maxRequests, windowSeconds * 1000);
}
