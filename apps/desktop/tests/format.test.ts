import { describe, expect, it } from "vitest";

import { formatFreshness, formatPosition } from "../src/renderer/src/format";

describe("formatFreshness", () => {
  it("按 10 秒 / 1 分钟分档", () => {
    const now = 1_000_000;

    expect(formatFreshness(now - 3_000, now)).toEqual({ level: "fresh", label: "3 秒前" });
    expect(formatFreshness(now - 30_000, now)).toEqual({ level: "stale", label: "30 秒前" });
    expect(formatFreshness(now - 5 * 60_000, now)).toEqual({ level: "expired", label: "5 分钟前" });
    expect(formatFreshness(now - 3 * 3_600_000, now)).toEqual({ level: "expired", label: "3 小时前" });
  });

  it("没有位置时返回未知", () => {
    expect(formatFreshness(null, 1_000_000)).toEqual({ level: "unknown", label: "位置未知" });
  });

  it("时间倒挂时按 0 秒处理", () => {
    expect(formatFreshness(2_000, 1_000).level).toBe("fresh");
  });
});

describe("formatPosition", () => {
  it("保留一位小数", () => {
    expect(formatPosition(-323.69, -225.63)).toBe("(-323.7, -225.6)");
  });
});
