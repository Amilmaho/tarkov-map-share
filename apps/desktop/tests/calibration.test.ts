import { describe, expect, it } from "vitest";

import { buildCalibration, calibrationQuality } from "../src/renderer/src/calibration";

const image = { src: "/maps/customs.webp", width: 1600, height: 1600 };
const source = { name: "测试用合成标定", license: "内部测试数据" };

/** 合成映射：world (x, z) → 像素 (px, py)，北朝上 */
function toPixel(x: number, z: number): { px: number; py: number } {
  return { px: (x + 500) * 2, py: (400 - z) * 2 };
}

const corners = [
  { x: -500, z: 400 },
  { x: 300, z: 400 },
  { x: 300, z: -400 },
  { x: -500, z: -400 },
];

describe("buildCalibration", () => {
  it("少于 4 个控制点时拒绝", () => {
    const result = buildCalibration({
      mapId: "customs",
      image,
      source,
      points: corners.slice(0, 3).map((point) => ({ image: toPixel(point.x, point.z), world: point })),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("至少需要 4 个控制点");
  });

  it("只统计填了世界坐标的点", () => {
    const result = buildCalibration({
      mapId: "customs",
      image,
      source,
      points: [
        ...corners.map((point) => ({ image: toPixel(point.x, point.z), world: point })),
        { image: { px: 800, py: 800 }, world: null },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calibration.controlPoints).toHaveLength(4);
  });

  it("4 个正确控制点可以解出接近零误差的单应矩阵", () => {
    const result = buildCalibration({
      mapId: "customs",
      image,
      source,
      points: corners.map((point) => ({ image: toPixel(point.x, point.z), world: point })),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rmsError).toBeLessThan(0.01);
    expect(result.calibration.mapId).toBe("customs");
    expect(result.calibration.image.width).toBe(1600);
  });

  it("控制点共线时给出可读的错误原因", () => {
    const result = buildCalibration({
      mapId: "customs",
      image,
      source,
      points: [0, 1, 2, 3].map((step) => ({
        image: { px: step * 100, py: step * 100 },
        world: { x: step * 50, z: step * 50 },
      })),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("退化");
  });
});

describe("calibrationQuality", () => {
  it("按误差分档", () => {
    expect(calibrationQuality(0.5).level).toBe("good");
    expect(calibrationQuality(2).level).toBe("warn");
    expect(calibrationQuality(9).level).toBe("bad");
  });
});
