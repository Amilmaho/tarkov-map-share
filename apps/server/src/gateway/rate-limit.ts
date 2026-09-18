/**
 * 固定窗口限流。
 *
 * 规则与 docs/WEBSOCKET_PROTOCOL.md 第 7 节一致：
 * - `player.update` 超限时静默丢弃（不报错，避免刷屏）
 * - 其余消息超限时返回 `RATE_LIMITED`
 * - 连接级总量连续超限 3 次则断开连接
 */

export type RateLimitRule = {
  limit: number;
  windowMs: number;
};

export const RATE_LIMITS: Record<string, RateLimitRule> = {
  "room.create": { limit: 5, windowMs: 60_000 },
  "room.join": { limit: 10, windowMs: 60_000 },
  "room.leave": { limit: 10, windowMs: 60_000 },
  "map.change": { limit: 10, windowMs: 10_000 },
  "player.update": { limit: 15, windowMs: 1_000 },
  "marker.create": { limit: 10, windowMs: 10_000 },
  "marker.update": { limit: 20, windowMs: 10_000 },
  "marker.delete": { limit: 20, windowMs: 10_000 },
  "route.create": { limit: 20, windowMs: 10_000 },
  "route.update": { limit: 20, windowMs: 10_000 },
  "route.delete": { limit: 20, windowMs: 10_000 },
  "snapshot.request": { limit: 20, windowMs: 10_000 },
  ping: { limit: 10, windowMs: 10_000 },
};

/** 连接级总消息量：60 条/秒 */
export const CONNECTION_RATE_LIMIT: RateLimitRule = { limit: 60, windowMs: 1_000 };
export const CONNECTION_LIMIT_KEY = "__connection__";
export const MAX_CONSECUTIVE_VIOLATIONS = 3;

/** 超限时静默丢弃而不是报错的消息类型 */
export const SILENT_DROP_TYPES: ReadonlySet<string> = new Set(["player.update"]);

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export class RateLimiter {
  readonly #windows = new Map<string, { count: number; resetAt: number }>();
  readonly #rules: Record<string, RateLimitRule>;

  constructor(rules: Record<string, RateLimitRule> = RATE_LIMITS) {
    this.#rules = rules;
  }

  /** 记一次访问；未配置规则的消息类型直接放行 */
  check(key: string, now: number): RateLimitDecision {
    const rule = this.#rules[key];
    if (rule === undefined) return { allowed: true };

    const window = this.#windows.get(key);
    if (window === undefined || now >= window.resetAt) {
      this.#windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return { allowed: true };
    }

    if (window.count >= rule.limit) {
      return { allowed: false, retryAfterMs: Math.max(0, window.resetAt - now) };
    }

    window.count += 1;
    return { allowed: true };
  }
}
