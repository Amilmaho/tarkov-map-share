/**
 * 标定草稿 → 校准数据 + 单应矩阵。
 *
 * 纯函数，方便单测；真正的求解复用 packages/shared 里已经验证过的实现。
 */

import {
  type Calibration,
  CalibrationSchema,
  type Matrix3,
  type MappingModel,
  buildTransformFromCalibration,
  reprojectionError,
  worldToImage,
} from "@tarkov-map-share/shared";

/** 标定包：把自己的标定发给别人，导进去就能用 */
export type CalibrationBundle = {
  version: 1;
  exportedAt: number;
  calibrations: Record<string, Calibration>;
};

export const BUNDLE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析标定包，逐张校验；坏掉的条目直接跳过而不是整体失败。
 *
 * 返回 null 表示根本不是标定包（版本不符或结构不对）。
 */
export function parseBundle(input: unknown): CalibrationBundle | null {
  if (!isRecord(input)) return null;
  if (input.version !== BUNDLE_VERSION) return null;

  const raw = input.calibrations;
  if (!isRecord(raw)) return null;

  const calibrations: Record<string, Calibration> = {};
  for (const [mapId, value] of Object.entries(raw)) {
    const parsed = CalibrationSchema.safeParse(value);
    if (parsed.success && parsed.data.mapId === mapId) calibrations[mapId] = parsed.data;
  }

  const exportedAt = typeof input.exportedAt === "number" ? input.exportedAt : Date.now();
  return { version: BUNDLE_VERSION, exportedAt, calibrations };
}

/**
 * 单点平移校正：把整份标定平移，使 worldPoint 落在 targetPixel 上。
 *
 * 用来快速修正"方向比例都对、只是整体偏移"的地图——预置标定往往就是这个毛病。
 * 平移不改变缩放与旋转，所以如果比例本身错了，这个方法救不回来。
 */
export function shiftCalibration(
  calibration: Calibration,
  worldPoint: { x: number; z: number },
  targetPixel: { px: number; py: number },
): Calibration | null {
  try {
    const { homography } = buildTransformFromCalibration(calibration);
    const current = worldToImage(homography, worldPoint);
    const offsetX = targetPixel.px - current.px;
    const offsetY = targetPixel.py - current.py;

    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null;

    return {
      ...calibration,
      controlPoints: calibration.controlPoints.map((point) => ({
        ...point,
        image: { px: point.image.px + offsetX, py: point.image.py + offsetY },
      })),
    };
  } catch {
    return null;
  }
}

export type CalibrationDraftPoint = {
  image: { px: number; py: number };
  /** 世界坐标，允许先点位置后填数字 */
  world: { x: number; z: number } | null;
};

/**
 * 最少 2 个控制点：2 点解相似变换（等比缩放 + 旋转 + 平移），
 * 3 点解仿射，4 点以上解单应。点越多越准，也越能发现选点错误。
 */
export const MIN_CALIBRATION_POINTS = 2;

export const MODEL_LABELS: Record<MappingModel, string> = {
  similarity: "相似变换（2 点）",
  affine: "仿射变换（3 点）",
  homography: "单应变换（4 点以上）",
};

export type CalibrationBuildResult =
  | {
      ok: true;
      calibration: Calibration;
      homography: Matrix3;
      model: MappingModel;
      rmsError: number;
      warnings: string[];
    }
  | { ok: false; reason: string };

export type WorldBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * 检查控制点的世界坐标是否落在地图范围内。
 *
 * 这是最划算的一道防错：坐标填错图（比如把森林的坐标填到海关）、或者少打一个负号，
 * 都会立刻表现为"位置画到地图外面"，与其事后猜，不如当场提示。
 */
export function checkPointsWithinBounds(
  points: readonly CalibrationDraftPoint[],
  bounds: WorldBounds,
): string[] {
  const warnings: string[] = [];

  points.forEach((point, index) => {
    if (point.world === null) return;
    const { x, z } = point.world;
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
      warnings.push(
        `控制点 ${index + 1} 的坐标 (${x.toFixed(1)}, ${z.toFixed(1)}) 超出本地图范围` +
          `（X ${bounds.minX}~${bounds.maxX}，Z ${bounds.minZ}~${bounds.maxZ}）`,
      );
    }
  });

  return warnings;
}

export function buildCalibration(input: {
  mapId: string;
  image: { src: string; width: number; height: number };
  source: { name: string; license: string; url?: string | undefined };
  points: readonly CalibrationDraftPoint[];
  bounds?: WorldBounds;
}): CalibrationBuildResult {
  const filled = input.points.filter((point) => point.world !== null);
  if (filled.length < MIN_CALIBRATION_POINTS) {
    return {
      ok: false,
      reason: `至少需要 ${MIN_CALIBRATION_POINTS} 个控制点，当前只有 ${filled.length} 个填了世界坐标`,
    };
  }

  const calibration: Calibration = {
    mapId: input.mapId,
    image: input.image,
    rotation: 0,
    controlPoints: filled.map((point, index) => ({
      world: point.world ?? { x: 0, z: 0 },
      image: point.image,
      label: `控制点 ${index + 1}`,
    })),
    source: input.source,
  };

  try {
    const build = buildTransformFromCalibration(calibration);
    const warnings = [...build.warnings];
    if (input.bounds !== undefined) {
      warnings.push(...checkPointsWithinBounds(filled, input.bounds));
    }
    return {
      ok: true,
      calibration,
      homography: build.homography,
      model: build.model,
      rmsError: build.rmsError,
      warnings,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** 校验点的重投影误差，用于告诉用户"准不准" */
export function calibrationQuality(rmsError: number): { level: "good" | "warn" | "bad"; label: string } {
  if (rmsError <= 1) return { level: "good", label: "良好" };
  if (rmsError <= 3) return { level: "warn", label: "可用" };
  return { level: "bad", label: "偏差较大" };
}

/**
 * 由地图元数据直接生成预置标定：把世界包围盒的四个角对应到图片四角。
 *
 * 成立的前提是地图素材本身就是按世界包围盒裁剪的（tarkov.dev 的矢量图就是这样），
 * 而且已经按 coordinateRotation 旋正过。因此这仍然只是"预置值"，需要按一次截图核对。
 */
export function presetCalibration(input: {
  mapId: string;
  image: { src: string; width: number; height: number };
  bounds: WorldBounds;
  source: { name: string; license: string; url?: string | undefined };
}): Calibration {
  const { minX, maxX, minZ, maxZ } = input.bounds;
  const { width, height } = input.image;

  return {
    mapId: input.mapId,
    image: input.image,
    rotation: 0,
    controlPoints: [
      { world: { x: minX, z: minZ }, image: { px: 0, py: 0 }, label: "角 1" },
      { world: { x: maxX, z: minZ }, image: { px: width, py: 0 }, label: "角 2" },
      { world: { x: maxX, z: maxZ }, image: { px: width, py: height }, label: "角 3" },
      { world: { x: minX, z: maxZ }, image: { px: 0, py: height }, label: "角 4" },
    ],
    source: input.source,
  };
}

/**
 * 把标定整体旋转 180°。
 *
 * 矩形绕中心旋转 180° 仍然落在原位，所以这个操作既能修正"方向反了"的预置标定，
 * 也能修正 90° 旋转方向取错导致的 180° 差异。
 */
export function rotateCalibration180(calibration: Calibration): Calibration {
  const { width, height } = calibration.image;
  return {
    ...calibration,
    controlPoints: calibration.controlPoints.map((point) => ({
      ...point,
      image: { px: width - point.image.px, py: height - point.image.py },
    })),
  };
}

export { reprojectionError };
