// Placeholder for the Redis-compatible client and healthcheck.
// Phase B exposes a typed client and healthcheck only; D phase wires
// AI preview body storage with 24-hour idle TTL.

export interface RedisHealthcheck {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export type RedisClient = {
  ping: () => Promise<RedisHealthcheck>;
};

export const REDIS_PACKAGE_PLACEHOLDER = true as const;
