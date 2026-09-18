import { describe, expect, it } from "vitest";

import {
  CONNECTION_LIMIT_KEY,
  CONNECTION_RATE_LIMIT,
  RATE_LIMITS,
  RateLimiter,
  SILENT_DROP_TYPES,
} from "../src/gateway/rate-limit";

describe("RateLimiter", () => {
  const rules = { ...RATE_LIMITS, [CONNECTION_LIMIT_KEY]: CONNECTION_RATE_LIMIT };

  it("窗口内超过上限后被拒绝，并给出重试时间", () => {
    const limiter = new RateLimiter(rules);
    const rule = RATE_LIMITS["marker.create"];
    if (rule === undefined) throw new Error("缺少 marker.create 限流规则");

    for (let index = 0; index < rule.limit; index += 1) {
      expect(limiter.check("marker.create", 1_000).allowed).toBe(true);
    }

    const denied = limiter.check("marker.create", 1_000);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) return;
    expect(denied.retryAfterMs).toBe(rule.windowMs);
  });

  it("窗口结束后重新计数", () => {
    const limiter = new RateLimiter(rules);
    const rule = RATE_LIMITS["marker.create"];
    if (rule === undefined) throw new Error("缺少 marker.create 限流规则");

    for (let index = 0; index < rule.limit + 1; index += 1) limiter.check("marker.create", 1_000);
    expect(limiter.check("marker.create", 1_000 + rule.windowMs).allowed).toBe(true);
  });

  it("不同消息类型之间互不影响", () => {
    const limiter = new RateLimiter(rules);
    const rule = RATE_LIMITS["marker.create"];
    if (rule === undefined) throw new Error("缺少 marker.create 限流规则");

    for (let index = 0; index < rule.limit + 1; index += 1) limiter.check("marker.create", 1_000);
    expect(limiter.check("route.create", 1_000).allowed).toBe(true);
  });

  it("没有配置规则的类型直接放行", () => {
    const limiter = new RateLimiter(rules);
    for (let index = 0; index < 1_000; index += 1) {
      expect(limiter.check("unknown.type", 1_000).allowed).toBe(true);
    }
  });

  it("连接级总量限制为 60 条/秒", () => {
    const limiter = new RateLimiter(rules);

    for (let index = 0; index < CONNECTION_RATE_LIMIT.limit; index += 1) {
      expect(limiter.check(CONNECTION_LIMIT_KEY, 1_000).allowed).toBe(true);
    }
    expect(limiter.check(CONNECTION_LIMIT_KEY, 1_000).allowed).toBe(false);
  });

  it("player.update 超限时静默丢弃", () => {
    expect(SILENT_DROP_TYPES.has("player.update")).toBe(true);
    expect(SILENT_DROP_TYPES.has("marker.create")).toBe(false);
  });

  it("限流参数与协议文档一致", () => {
    expect(RATE_LIMITS["player.update"]).toEqual({ limit: 15, windowMs: 1_000 });
    expect(RATE_LIMITS["marker.create"]).toEqual({ limit: 10, windowMs: 10_000 });
    expect(CONNECTION_RATE_LIMIT).toEqual({ limit: 60, windowMs: 1_000 });
  });
});
