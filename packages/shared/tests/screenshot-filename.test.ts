import { describe, expect, it } from "vitest";

import {
  isScreenshotFilename,
  parseScreenshotFilename,
  quaternionToEuler,
} from "../src/capture/screenshot-filename";

/** 真实样本：Windows 主机、手动按键截图 */
const REAL_SAMPLE =
  "2026-09-18[20-06]_-323.69, 2.44, -225.63_0.02332, 0.54903, -0.01533, 0.83534_15.72 (0).png";

describe("parseScreenshotFilename", () => {
  it("解析真实样本的全部字段", () => {
    const result = parseScreenshotFilename(REAL_SAMPLE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.warnings).toEqual([]);
    expect(result.capture.capturedAt).toEqual({
      year: 2026,
      month: 9,
      day: 18,
      hour: 20,
      minute: 6,
      second: null,
    });
    expect(result.capture.position).toEqual({ x: -323.69, y: 2.44, z: -225.63 });
    expect(result.capture.rotation.x).toBeCloseTo(0.02332, 5);
    expect(result.capture.rotation.y).toBeCloseTo(0.54903, 5);
    expect(result.capture.rotation.z).toBeCloseTo(-0.01533, 5);
    expect(result.capture.rotation.w).toBeCloseTo(0.83534, 5);
    expect(result.capture.unclassifiedValue).toBeCloseTo(15.72, 2);
    expect(result.capture.sequence).toBe(0);
    expect(result.capture.fileName).toBe(REAL_SAMPLE);
  });

  it("从四元数换算出朝向、俯仰与翻滚", () => {
    const result = parseScreenshotFilename(REAL_SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 实测：y 分量近似等于 sin(偏航角/2)，w 分量近似等于 cos(偏航角/2)
    expect(result.capture.headingDegrees).toBeCloseTo(66.63, 1);
    expect(result.capture.pitchDegrees).toBeCloseTo(3.2, 1);
    expect(result.capture.rollDegrees).toBeCloseTo(0, 1);
  });

  it("朝向角落在 [0, 360) 区间", () => {
    const cases = [0, 45, 90, 180, 270, 315];

    for (const heading of cases) {
      const half = (heading / 2) * (Math.PI / 180);
      const euler = quaternionToEuler({
        x: 0,
        y: Math.sin(half),
        z: 0,
        w: Math.cos(half),
      });

      expect(euler.headingDegrees).toBeCloseTo(heading, 4);
      expect(euler.headingDegrees).toBeGreaterThanOrEqual(0);
      expect(euler.headingDegrees).toBeLessThan(360);
    }
  });

  it("负偏航会归一化到 360 度以内", () => {
    const half = (-45 * Math.PI) / 360;
    const euler = quaternionToEuler({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });

    expect(euler.headingDegrees).toBeCloseTo(315, 4);
  });

  it("容忍秒、序号、扩展名缺省与多余空格", () => {
    const variants = [
      "2026-09-18[20-06-33]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (1).png",
      "2026-09-18[20-06]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72",
      "2026-09-18[20-06]_-323.69,2.44,-225.63_0,0,0,1_15.72(0).png",
      "2026-09-18[20-06]_-323, 2, -225_0, 0, 0, 1_15.72 (2).jpg",
    ];

    for (const variant of variants) {
      const result = parseScreenshotFilename(variant);
      expect(result.ok, variant).toBe(true);
    }

    const withSeconds = parseScreenshotFilename(variants[0]!);
    expect(withSeconds.ok).toBe(true);
    if (!withSeconds.ok) return;
    expect(withSeconds.capture.capturedAt.second).toBe(33);
    expect(withSeconds.capture.sequence).toBe(1);

    const minimal = parseScreenshotFilename(variants[1]!);
    expect(minimal.ok).toBe(true);
    if (!minimal.ok) return;
    expect(minimal.capture.sequence).toBe(0);
  });

  it("拒绝不符合格式的文件名", () => {
    const invalid = [
      "",
      "screenshot.png",
      "2026-09-18_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
      "2026-09-18[20-06]_-323.69, 2.44_-0.02, 0.54, -0.01, 0.83_15.72 (0).png",
      "2026-09-18[20-06]_abc, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
      "Copy of 2026-09-18[20-06]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
    ];

    for (const name of invalid) {
      const result = parseScreenshotFilename(name);
      expect(result.ok, name).toBe(false);
      if (result.ok) return;
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("拒绝时间字段越界的文件名", () => {
    const invalid = [
      "2026-13-18[20-06]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
      "2026-09-18[25-06]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
      "2026-09-18[20-66]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
      "2026-09-18[20-06-66]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
    ];

    for (const name of invalid) {
      expect(parseScreenshotFilename(name).ok, name).toBe(false);
    }
  });

  it("四元数模长异常时仍然解析成功但给出警告", () => {
    const result = parseScreenshotFilename(
      "2026-09-18[20-06]_-323.69, 2.44, -225.63_0, 0.9, 0, 0.9_15.72 (0).png",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("旋转四元数模长");
  });

  it("坐标越界时给出警告", () => {
    const result = parseScreenshotFilename(
      "2026-09-18[20-06]_99999, 2.44, -225.63_0, 0, 0, 1_15.72 (0).png",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings[0]).toContain("超出合理范围");
  });
});

describe("isScreenshotFilename", () => {
  it("可以快速区分截图名与普通文件名", () => {
    expect(isScreenshotFilename(REAL_SAMPLE)).toBe(true);
    expect(isScreenshotFilename("2026-09-18[20-06]_-323.69, 2.44, -225.63_0, 0, 0, 1_15.72 (3).png")).toBe(true);
    expect(isScreenshotFilename("notes.txt")).toBe(false);
    expect(isScreenshotFilename("2026-09-18.png")).toBe(false);
  });
});
