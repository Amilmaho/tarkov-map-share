import { describe, expect, it } from "vitest";

import { parseScreenshotFilename } from "../src/capture/screenshot-filename";
import { buildHomographyFromCalibration } from "../src/map/calibration";
import {
  type Matrix3,
  imageToWorld,
  invertMatrix3,
  multiplyMatrix3,
  reprojectionError,
  solveHomography,
  worldToImage,
} from "../src/map/homography";
import {
  MAX_SCALE,
  MIN_SCALE,
  createViewport,
  fitToViewport,
  imageToScreen,
  screenToImage,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
} from "../src/map/viewport";

/** 测试用的“真实”单应矩阵：包含旋转、缩放与透视 */
const TRUE_HOMOGRAPHY: Matrix3 = [1.82, 0.31, 1024, -0.12, 1.77, 512, 0.00021, -0.00013, 1];

const WORLD_POINTS = [
  { x: -320, z: 240 },
  { x: 280, z: 200 },
  { x: 250, z: -230 },
  { x: -290, z: -210 },
];

function projectionOf(matrix: Matrix3, world: { x: number; z: number }) {
  return worldToImage(matrix, world);
}

function makeControlPoints(matrix: Matrix3, worldPoints: { x: number; z: number }[]) {
  return worldPoints.map((world) => ({ world, image: projectionOf(matrix, world) }));
}

describe("solveHomography", () => {
  it("4 个控制点自洽，重投影误差接近 0", () => {
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS);
    const solved = solveHomography(controlPoints);

    expect(reprojectionError(solved, controlPoints)).toBeLessThan(0.01);
  });

  it("控制点质心远离原点时依然精确（回归：归一化漏减 Z 中心）", () => {
    // 这批点的 z 质心是 700，而不是 0——只减一个轴的中心会让结果整体错位
    const offsetWorld = [
      { x: -320, z: 940 },
      { x: 280, z: 900 },
      { x: 250, z: 470 },
      { x: -290, z: 490 },
    ];
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, offsetWorld);
    const solved = solveHomography(controlPoints);

    expect(reprojectionError(solved, controlPoints)).toBeLessThan(0.01);
  });

  it("世界坐标与像素坐标的质心都偏移时也能精确求解", () => {
    const mergedWorld = [
      { x: 620, z: 1180 },
      { x: 1210, z: 1140 },
      { x: 1190, z: 720 },
      { x: 650, z: 740 },
    ];
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, mergedWorld);
    const solved = solveHomography(controlPoints);

    expect(reprojectionError(solved, controlPoints)).toBeLessThan(0.01);
  });

  it("额外验证点误差不超过 2 像素", () => {
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS);
    const solved = solveHomography(controlPoints);
    const verificationWorld = { x: 40, z: 15 };
    const expected = projectionOf(TRUE_HOMOGRAPHY, verificationWorld);
    const actual = worldToImage(solved, verificationWorld);

    expect(Math.abs(actual.px - expected.px)).toBeLessThan(2);
    expect(Math.abs(actual.py - expected.py)).toBeLessThan(2);
  });

  it("世界坐标 → 像素 → 世界坐标往返误差不超过 0.5 米", () => {
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS);
    const solved = solveHomography(controlPoints);

    for (let index = 0; index < 200; index += 1) {
      const world = { x: (index % 20) * 30 - 300, z: Math.floor(index / 20) * 40 - 200 };
      const image = worldToImage(solved, world);
      const back = imageToWorld(solved, image);

      expect(Math.hypot(back.x - world.x, back.z - world.z)).toBeLessThan(0.5);
    }
  });

  it("控制点共线时抛出可读错误", () => {
    const collinear = [0, 1, 2, 3].map((step) => ({
      world: { x: step * 100, z: step * 100 },
      image: { px: step * 200 + 10, py: step * 200 + 20 },
    }));

    expect(() => solveHomography(collinear)).toThrow(/退化/);
  });

  it("控制点重复时抛错", () => {
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS);
    const duplicated = [controlPoints[0]!, controlPoints[0]!, controlPoints[1]!, controlPoints[2]!];

    expect(() => solveHomography(duplicated)).toThrow(/退化/);
  });

  it("控制点不足 4 个或包含非有限数时抛错", () => {
    expect(() => solveHomography(makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS.slice(0, 3)))).toThrow(
      /至少需要 4 个控制点/,
    );

    const broken = makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS);
    broken[0] = { world: { x: Number.NaN, z: 0 }, image: { px: 1, py: 1 } };
    expect(() => solveHomography(broken)).toThrow(/有限数/);
  });

  it("矩阵乘法与求逆互为逆运算", () => {
    const inverse = invertMatrix3(TRUE_HOMOGRAPHY);
    const identity = multiplyMatrix3(TRUE_HOMOGRAPHY, inverse);

    expect(identity[0]).toBeCloseTo(1, 9);
    expect(identity[4]).toBeCloseTo(1, 9);
    expect(identity[8]).toBeCloseTo(1, 9);
    expect(identity[1]).toBeCloseTo(0, 9);
    expect(identity[3]).toBeCloseTo(0, 9);
  });
});

describe("viewport", () => {
  it("屏幕坐标与图像坐标互为逆变换", () => {
    const viewport = createViewport({ scale: 1.7, offsetX: -320, offsetY: 96 });
    const image = { px: 1830.5, py: 940.25 };
    const back = screenToImage(viewport, imageToScreen(viewport, image));

    expect(back.px).toBeCloseTo(image.px, 9);
    expect(back.py).toBeCloseTo(image.py, 9);
  });

  it("屏幕坐标 → 世界坐标 → 屏幕坐标往返误差可忽略", () => {
    const homography = TRUE_HOMOGRAPHY;
    const viewport = createViewport({ scale: 2.4, offsetX: -800, offsetY: -420 });
    const screen = { sx: 640, sy: 360 };
    const world = screenToWorld(viewport, homography, screen);
    const back = worldToScreen(viewport, homography, world);

    expect(back.sx).toBeCloseTo(screen.sx, 6);
    expect(back.sy).toBeCloseTo(screen.sy, 6);
  });

  it("以鼠标为锚点缩放时，锚点下的地图内容不移动", () => {
    const viewport = createViewport({ scale: 1.2, offsetX: 40, offsetY: -30 });
    const anchor = { sx: 517, sy: 288 };
    const before = screenToImage(viewport, anchor);

    const zoomedIn = zoomAtPoint(viewport, anchor, 2.6);
    const afterZoomIn = screenToImage(zoomedIn, anchor);
    expect(afterZoomIn.px).toBeCloseTo(before.px, 9);
    expect(afterZoomIn.py).toBeCloseTo(before.py, 9);

    const zoomedOut = zoomAtPoint(zoomedIn, anchor, 0.4);
    const afterZoomOut = screenToImage(zoomedOut, anchor);
    expect(afterZoomOut.px).toBeCloseTo(before.px, 9);
    expect(afterZoomOut.py).toBeCloseTo(before.py, 9);
  });

  it("缩放倍数被限制在 [0.2, 8]", () => {
    const viewport = createViewport({ scale: 1 });
    expect(zoomAtPoint(viewport, { sx: 0, sy: 0 }, 99).scale).toBe(MAX_SCALE);
    expect(zoomAtPoint(viewport, { sx: 0, sy: 0 }, 0.001).scale).toBe(MIN_SCALE);
    expect(() => createViewport({ scale: Number.POSITIVE_INFINITY })).toThrow(/有限数/);
  });

  it("fitToViewport 让地图居中", () => {
    const viewport = fitToViewport({ width: 4096, height: 4096 }, { width: 1024, height: 768 });

    expect(viewport.scale).toBeCloseTo(768 / 4096, 6);
    expect(viewport.offsetX).toBeCloseTo((1024 - 4096 * viewport.scale) / 2, 6);
    expect(viewport.offsetY).toBeCloseTo(0, 6);
  });
});

describe("截图位置落到地图上", () => {
  it("真实截图坐标能换算成地图内的像素", () => {
    // 合成校准：1024 × 1024 的图覆盖 x ∈ [-500, 300]、z ∈ [-400, 400]，北朝上
    const toPixel = (x: number, z: number) => ({
      px: ((x + 500) / 800) * 1024,
      py: ((400 - z) / 800) * 1024,
    });

    const calibration = {
      mapId: "customs",
      image: { src: "assets/maps/customs.png", width: 1024, height: 1024 },
      rotation: 0,
      controlPoints: [
        { world: { x: -500, z: 400 }, image: toPixel(-500, 400) },
        { world: { x: 300, z: 400 }, image: toPixel(300, 400) },
        { world: { x: 300, z: -400 }, image: toPixel(300, -400) },
        { world: { x: -500, z: -400 }, image: toPixel(-500, -400) },
      ],
      source: { name: "测试用合成校准", license: "内部测试数据" },
    };

    const parsed = parseScreenshotFilename(
      "2026-09-18[20-06]_-323.69, 2.44, -225.63_0.02332, 0.54903, -0.01533, 0.83534_15.72 (0).png",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { homography } = buildHomographyFromCalibration(calibration);
    const image = worldToImage(homography, parsed.capture.position);
    const expected = toPixel(parsed.capture.position.x, parsed.capture.position.z);

    expect(image.px).toBeCloseTo(expected.px, 1);
    expect(image.py).toBeCloseTo(expected.py, 1);
    expect(image.px).toBeGreaterThanOrEqual(0);
    expect(image.px).toBeLessThanOrEqual(1024);
    expect(image.py).toBeGreaterThanOrEqual(0);
    expect(image.py).toBeLessThanOrEqual(1024);
  });
});

describe("buildHomographyFromCalibration", () => {
  it("合法校准数据无警告", () => {
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS);
    const build = buildHomographyFromCalibration({
      mapId: "customs",
      image: { src: "assets/maps/customs.png", width: 2048, height: 2048 },
      rotation: 0,
      controlPoints,
      source: { name: "合成校准", license: "内部测试数据" },
    });

    expect(build.rmsError).toBeLessThan(0.01);
    expect(build.warnings).toEqual([]);
  });

  it("控制点偏差过大时给出警告", () => {
    const controlPoints = makeControlPoints(TRUE_HOMOGRAPHY, [
      ...WORLD_POINTS,
      { x: -60, z: 20 },
    ]);
    controlPoints[4] = {
      world: controlPoints[4]!.world,
      image: { px: controlPoints[4]!.image.px + 60, py: controlPoints[4]!.image.py - 45 },
    };

    const build = buildHomographyFromCalibration({
      mapId: "customs",
      image: { src: "assets/maps/customs.png", width: 2048, height: 2048 },
      rotation: 0,
      controlPoints,
      source: { name: "含噪校准", license: "内部测试数据" },
    });

    expect(build.rmsError).toBeGreaterThan(3);
    expect(build.warnings.some((warning) => warning.includes("重投影误差"))).toBe(true);
  });

  it("声明了 rotation 时提醒确认是否重复体现旋转", () => {
    const build = buildHomographyFromCalibration({
      mapId: "customs",
      image: { src: "assets/maps/customs.png", width: 2048, height: 2048 },
      rotation: 90,
      controlPoints: makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS),
      source: { name: "合成校准", license: "内部测试数据" },
    });

    expect(build.warnings.some((warning) => warning.includes("rotation"))).toBe(true);
  });

  it("控制点少于 4 个时校验失败", () => {
    expect(() =>
      buildHomographyFromCalibration({
        mapId: "customs",
        image: { src: "assets/maps/customs.png", width: 2048, height: 2048 },
        controlPoints: makeControlPoints(TRUE_HOMOGRAPHY, WORLD_POINTS.slice(0, 3)),
        source: { name: "合成校准", license: "内部测试数据" },
      }),
    ).toThrow();
  });
});
