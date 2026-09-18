import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Calibration, CalibrationSchema, MapIdSchema } from "@tarkov-map-share/shared";

const CALIBRATION_DIR = "calibrations";

export function calibrationFilePath(userDataPath: string, mapId: string): string {
  // 先校验地图 ID，避免用户输入被当作路径片段使用
  const safeMapId = MapIdSchema.parse(mapId);
  return join(userDataPath, CALIBRATION_DIR, `${safeMapId}.json`);
}

export async function loadCalibration(userDataPath: string, mapId: string): Promise<Calibration | null> {
  try {
    const text = await readFile(calibrationFilePath(userDataPath, mapId), "utf8");
    const parsed = CalibrationSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    // 文件不存在或格式损坏都按"未标定"处理
    return null;
  }
}

export async function saveCalibration(userDataPath: string, calibration: Calibration): Promise<Calibration> {
  const parsed = CalibrationSchema.parse(calibration);
  await mkdir(join(userDataPath, CALIBRATION_DIR), { recursive: true });
  await writeFile(
    calibrationFilePath(userDataPath, parsed.mapId),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );
  return parsed;
}
