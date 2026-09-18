/**
 * 校准数据 → 单应矩阵。
 *
 * `maps/<mapId>/calibration.json` 的结构由 `model/map.ts` 的 `CalibrationSchema` 定义，
 * 字段说明见 docs/MAP_COORDINATES.md 第 3、5 节。
 */

import { type Calibration, CalibrationSchema } from "../model/map";
import { type Matrix3, reprojectionError, solveHomography } from "./homography";

/** 重投影误差超过该值（像素）时给出警告 */
export const REPROJECTION_WARN_PIXELS = 3;

export type CalibrationBuild = {
  homography: Matrix3;
  /** 控制点重投影误差，单位像素（均方根） */
  rmsError: number;
  warnings: string[];
};

/**
 * 校验校准数据并求解单应矩阵。
 *
 * @throws 数据不符合 Schema、控制点退化时抛错
 */
export function buildHomographyFromCalibration(input: unknown): CalibrationBuild {
  const calibration: Calibration = CalibrationSchema.parse(input);
  const homography = solveHomography(calibration.controlPoints);
  const rmsError = reprojectionError(homography, calibration.controlPoints);

  const warnings: string[] = [];
  if (rmsError > REPROJECTION_WARN_PIXELS) {
    warnings.push(
      `校准重投影误差为 ${rmsError.toFixed(2)} 像素，超过 ${REPROJECTION_WARN_PIXELS} 像素，建议重新选点`,
    );
  }
  if (calibration.rotation !== 0) {
    warnings.push("校准数据声明了 rotation，请确认控制点中未重复体现同一旋转");
  }

  return { homography, rmsError, warnings };
}
