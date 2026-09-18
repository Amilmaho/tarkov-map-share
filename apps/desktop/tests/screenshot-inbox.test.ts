import { describe, expect, it } from "vitest";

import { ScreenshotInbox } from "../src/main/screenshot-inbox";

const SAMPLE_A =
  "2026-09-18[20-06]_-323.69, 2.44, -225.63_0.02332, 0.54903, -0.01533, 0.83534_15.72 (0).png";
const SAMPLE_B = "2026-09-18[20-09]_120.5, 1.20, -60.25_0, 0.70711, 0, 0.70711_15.72 (1).png";
const SAMPLE_C = "2026-09-18[20-12]_1.0, 1.0, 1.0_0, 0, 0, 1_9.9 (2).png";

function createInbox(now: () => number) {
  return new ScreenshotInbox({ now, throttleMs: 2_000 });
}

describe("ScreenshotInbox", () => {
  it("prime 之后不会把历史截图当成本次上报", () => {
    const inbox = createInbox(() => 10_000);

    expect(inbox.prime([SAMPLE_A, SAMPLE_B])).toBe(2);
    expect(inbox.push(SAMPLE_A)).toEqual({ action: "ignored", reason: "duplicate" });
    expect(inbox.push(SAMPLE_B)).toEqual({ action: "ignored", reason: "duplicate" });
  });

  it("同一个文件只处理一次", () => {
    const inbox = createInbox(() => 10_000);

    expect(inbox.push(SAMPLE_A).action).toBe("emitted");
    expect(inbox.push(SAMPLE_A)).toEqual({ action: "ignored", reason: "duplicate" });
  });

  it("忽略非截图文件与格式错误的文件名", () => {
    const inbox = createInbox(() => 10_000);

    expect(inbox.push("notes.txt")).toEqual({ action: "ignored", reason: "not-screenshot" });
    // 正则能匹配，但月份越界：属于"格式合法、内容非法"
    expect(inbox.push("2026-13-18[20-06]_1, 2, 3_0, 0, 0, 1_9 (0).png")).toEqual({
      action: "ignored",
      reason: "invalid-name",
    });
  });

  it("解析出位置与朝向", () => {
    const inbox = createInbox(() => 10_000);
    const result = inbox.push(SAMPLE_A);

    expect(result.action).toBe("emitted");
    if (result.action !== "emitted") return;
    expect(result.capture.position).toEqual({ x: -323.69, y: 2.44, z: -225.63 });
    expect(result.capture.headingDegrees).toBeCloseTo(66.63, 1);
  });

  it("连拍时先发第一张，窗口结束后补发最后一张", () => {
    let now = 10_000;
    const inbox = createInbox(() => now);

    expect(inbox.push(SAMPLE_A).action).toBe("emitted");

    now = 10_500;
    expect(inbox.push(SAMPLE_B).action).toBe("deferred");
    expect(inbox.pendingCapture?.fileName).toBe(SAMPLE_B);

    now = 11_000;
    expect(inbox.takePending()).toBeNull();

    now = 12_100;
    expect(inbox.takePending()?.fileName).toBe(SAMPLE_B);
    expect(inbox.takePending()).toBeNull();
  });

  it("窗口结束后的新截图直接上报", () => {
    let now = 10_000;
    const inbox = createInbox(() => now);
    inbox.push(SAMPLE_A);

    now = 13_000;
    expect(inbox.push(SAMPLE_B).action).toBe("emitted");
  });

  it("强制取件可以忽略节流窗口", () => {
    let now = 10_000;
    const inbox = createInbox(() => now);
    inbox.push(SAMPLE_A);

    now = 10_200;
    inbox.push(SAMPLE_B);
    expect(inbox.takePending()).toBeNull();
    expect(inbox.takePending(true)?.fileName).toBe(SAMPLE_B);
  });

  it("已处理文件名超过上限后淘汰最旧的记录", () => {
    const inbox = new ScreenshotInbox({ now: () => 10_000, throttleMs: 0, maxTrackedFiles: 2 });

    inbox.push(SAMPLE_A);
    inbox.push(SAMPLE_B);
    inbox.push(SAMPLE_C);

    expect(inbox.trackedCount).toBe(2);
    expect(inbox.has(SAMPLE_A)).toBe(false);
    expect(inbox.has(SAMPLE_C)).toBe(true);
  });
});
