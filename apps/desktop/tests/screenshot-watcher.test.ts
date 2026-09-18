import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ScreenshotCapture } from "@tarkov-map-share/shared";

import { type ScreenshotWatcher, createScreenshotWatcher } from "../src/main/screenshot-watcher";

const SAMPLE_A =
  "2026-09-18[20-06]_-323.69, 2.44, -225.63_0.02332, 0.54903, -0.01533, 0.83534_15.72 (0).png";
const SAMPLE_B = "2026-09-18[20-09]_120.5, 1.20, -60.25_0, 0.70711, 0, 0.70711_15.72 (1).png";

let directory: string;
let watcher: ScreenshotWatcher | null = null;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "tms-screenshots-"));
});

afterEach(async () => {
  await watcher?.close();
  watcher = null;
  await rm(directory, { recursive: true, force: true });
});

function startWatcher(scanIntervalMs = 60_000): ScreenshotCapture[] {
  const captures: ScreenshotCapture[] = [];
  watcher = createScreenshotWatcher({
    directory,
    scanIntervalMs,
    throttleMs: 0,
    onCapture: (capture) => captures.push(capture),
  });
  return captures;
}

describe("createScreenshotWatcher", () => {
  it("首次扫描只登记历史截图，不上报", async () => {
    await writeFile(join(directory, SAMPLE_A), "png");
    const captures = startWatcher();

    await watcher?.scan();

    expect(captures).toHaveLength(0);
    expect(watcher?.status().processedCount).toBe(0);
  });

  it("新增截图会被解析并上报", async () => {
    const captures = startWatcher();
    await watcher?.scan();

    await writeFile(join(directory, SAMPLE_A), "png");
    await watcher?.scan();

    expect(captures).toHaveLength(1);
    expect(captures[0]?.position).toEqual({ x: -323.69, y: 2.44, z: -225.63 });
    expect(captures[0]?.headingDegrees).toBeCloseTo(66.63, 1);
    expect(watcher?.latest()?.fileName).toBe(SAMPLE_A);
    expect(watcher?.status().processedCount).toBe(1);
  });

  it("按修改时间顺序处理同一批新文件", async () => {
    const captures = startWatcher();
    await watcher?.scan();

    await writeFile(join(directory, SAMPLE_A), "png");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(join(directory, SAMPLE_B), "png");
    await watcher?.scan();

    expect(captures.map((capture) => capture.fileName)).toEqual([SAMPLE_A, SAMPLE_B]);
  });

  it("定时扫描会自动发现新截图", async () => {
    const captures = startWatcher(50);
    await watcher?.scan();

    await writeFile(join(directory, SAMPLE_A), "png");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(captures).toHaveLength(1);
  });

  it("目录不存在时状态标记为未监听并给出原因", async () => {
    const missing = join(directory, "not-here");
    const captures: ScreenshotCapture[] = [];
    watcher = createScreenshotWatcher({
      directory: missing,
      scanIntervalMs: 60_000,
      onCapture: (capture) => captures.push(capture),
    });

    await watcher.scan();

    const status = watcher.status();
    expect(status.directoryExists).toBe(false);
    expect(status.watching).toBe(false);
    expect(status.lastError).toContain("目录不存在");
    expect(captures).toHaveLength(0);
  });

  it("切换目录后重新进入登记模式", async () => {
    const captures = startWatcher();
    await watcher?.scan();

    const second = await mkdtemp(join(tmpdir(), "tms-screenshots-2-"));
    try {
      await writeFile(join(second, SAMPLE_B), "png");
      await watcher?.setDirectory(second);

      expect(captures).toHaveLength(0);
      expect(watcher?.status().directory).toBe(second);
      expect(watcher?.status().watching).toBe(true);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  });
});
