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

export function buildCalibration(input: {
  mapId: string;
  image: { src: string; width: number; height: number };
  source: { name: string; license: string; url?: string | undefined };
  points: readonly CalibrationDraftPoint[];
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
    return {
      ok: true,
      calibration,
      homography: build.homography,
      rmsError: build.rmsError,
      warnings: build.warnings,
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
