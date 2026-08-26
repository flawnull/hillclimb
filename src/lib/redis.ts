/**
 * VAL BORBERA HILLCLIMB — Redis Client with In-Memory Mock Fallback
 * Throws in production when credentials are missing; mocks in development.
 */

import { Redis } from "@upstash/redis";

// In-Memory fallback store for development
export class MockRedis {
  private zsets = new Map<string, Map<string, number>>();
  private hashes = new Map<string, Record<string, string>>();
  private strings = new Map<string, string>();

  async zadd(key: string, memberScore: { score: number; member: string }): Promise<number> {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    const z = this.zsets.get(key)!;
    z.set(memberScore.member, memberScore.score);
    return 1;
  }

  async zscore(key: string, member: string): Promise<number | null> {
    if (!this.zsets.has(key)) return null;
    const z = this.zsets.get(key)!;
    const score = z.get(member);
    return score !== undefined ? score : null;
  }

  async zcard(key: string): Promise<number> {
    if (!this.zsets.has(key)) return 0;
    return this.zsets.get(key)!.size;
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    if (!this.zsets.has(key)) return 0;
    const z = this.zsets.get(key)!;
    const sorted = Array.from(z.entries()).sort((a, b) => a[1] - b[1]);
    const len = sorted.length;
    const normStart = start < 0 ? Math.max(0, len + start) : start;
    const normStop = stop < 0 ? len + stop : Math.min(len - 1, stop);

    if (normStart > normStop || normStart >= len) return 0;

    let removed = 0;
    for (let i = normStart; i <= normStop && i < len; i++) {
      z.delete(sorted[i][0]);
      removed++;
    }
    return removed;
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    opts?: { withScores?: boolean }
  ): Promise<string[] | { member: string; score: number }[]> {
    if (!this.zsets.has(key)) return [];
    const z = this.zsets.get(key)!;
    const sorted = Array.from(z.entries()).sort((a, b) => a[1] - b[1]);
    const end = stop === -1 ? sorted.length : stop + 1;
    const sliced = sorted.slice(start, end);

    if (opts?.withScores) {
      return sliced.map(([member, score]) => ({ member, score }));
    }
    return sliced.map(([member]) => member);
  }

  async hset(key: string, data: Record<string, unknown>): Promise<number> {
    const serialized: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      serialized[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    this.hashes.set(key, serialized);
    return 1;
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    return this.hashes.get(key) || null;
  }

  async set(key: string, value: string): Promise<string> {
    this.strings.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) || null;
  }

  async del(key: string): Promise<number> {
    const deleted = (this.zsets.delete(key) ? 1 : 0) + (this.hashes.delete(key) ? 1 : 0) + (this.strings.delete(key) ? 1 : 0);
    return deleted > 0 ? 1 : 0;
  }
}

const mockRedisInstance = new MockRedis();

export function getRedis(): Redis | MockRedis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (process.env.NODE_ENV === "production") {
    if (!url || !token || url.includes("your-upstash") || token.includes("your-upstash")) {
      throw new Error(
        "FATAL: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be properly configured in production environment."
      );
    }
    return new Redis({ url, token });
  }

  if (url && token && !url.includes("your-upstash") && !token.includes("your-upstash")) {
    return new Redis({ url, token });
  }

  return mockRedisInstance;
}

