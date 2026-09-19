import { describe, expect, it } from "vitest";

import { BUNDLE_VERSION, parseBundle, presetCalibration, shiftCalibration } from "../src/renderer/src/calibration";
import { buildCalibration } from "../src/renderer/src/calibration";

const image = { src: "/maps/customs.webp", width: 4096, height: 2082 };
const source = { name: "测试", license: "CC BY-NC-SA 4.0" };
const bounds = { minX: -372, maxX: 698, minZ: -307, maxZ: 237 };

const preset = presetCalibration({ mapId: "customs", image, bounds, source });

describe("parseBundle", () => {
  it("接受合法标定包", () => {
    const bundle = parseBundle({
      version: BUNDLE_VERSION,
      exportedAt: 1_700_000_000_000,
      calibrations: { customs: preset },
    });

    expect(bundle).not.toBeNull();
    expect(bundle?.calibrations.customs?.mapId).toBe("customs");
  });

  it("版本不符或结构不对时返回 null", () => {
    expect(parseBundle(null)).toBeNull();
    expect(parseBundle({ version: 99, calibrations: {} })).toBeNull();
    expect(parseBundle({ version: BUNDLE_VERSION })).toBeNull();
    expect(parseBundle("not-json")).toBeNull();
  });

  it("跳过坏掉的条目而不是整体失败", () => {
    const bundle = parseBundle({
      version: BUNDLE_VERSION,
      exportedAt: 0,
      calibrations: {
        customs: preset,
        broken: { mapId: "broken", image: {} },
      },
    });

    expect(Object.keys(bundle?.calibrations ?? {})).toEqual(["customs"]);
  });
});

describe("shiftCalibration", () => {
  it("平移后目标点正好落在指定像素上", () => {
    const world = { x: 480.65, z: -81.34 };
    const target = { px: 2590, py: 1507 };

    const shifted = shiftCalibration(preset, world, target);
    expect(shifted).not.toBeNull();
    if (shifted === null) return;

    const built = buildCalibration({
      mapId: "customs",
      image,
      source,
      bounds,
      points: shifted.controlPoints.map((point) => ({ image: point.image, world: point.world })),
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // 平移不改变模型与尺度：仍然是两个点决定的相似变换
    expect(built.model).toBe("homography");
  });

  it("平移只改变位置，不改变相对关系", () => {
    const world = { x: 480.65, z: -81.34 };
    const shifted = shiftCalibration(preset, world, { px: 2590, py: 1507 });
    expect(shifted).not.toBeNull();
    if (shifted === null) return;

    const before = preset.controlPoints[0];
    const after = shifted.controlPoints[0];
    expect(after?.world).toEqual(before?.world);
    expect(after?.image.px).not.toBeCloseTo(before?.image.px ?? 0, 3);
  });
});
