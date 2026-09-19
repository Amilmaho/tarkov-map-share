/**
 * 标定草稿 → 校准数据 + 单应矩阵。
 *
 * 纯函数，方便单测；真正的求解复用 packages/shared 里已经验证过的实现。
 */

import {
  type Calibration,
  type Matrix3,
  buildHomographyFromCalibration,
  reprojectionError,
} from "@tarkov-map-share/shared";

export type CalibrationDraftPoint = {
  image: { px: number; py: number };
  /** 世界坐标，允许先点位置后填数字 */
  world: { x: number; z: number } | null;
};

export const MIN_CALIBRATION_POINTS = 4;

export type CalibrationBuildResult =
  | { ok: true; calibration: Calibration; homography: Matrix3; rmsError: number; warnings: string[] }
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
    const build = buildHomographyFromCalibration(calibration);
    const warnings = [...build.warnings];
    if (input.bounds !== undefined) {
      warnings.push(...checkPointsWithinBounds(filled, input.bounds));
    }
    return {
      ok: true,
      calibration,
      homography: build.homography,
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

export { reprojectionError };
