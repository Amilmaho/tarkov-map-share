import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Calibration, CalibrationSchema, MapIdSchema } from "@tarkov-map-share/shared";

const CALIBRATION_DIR = "calibrations";

/** 标定包格式版本 */
export const BUNDLE_VERSION = 1;

export type CalibrationBundleFile = {
  version: number;
  exportedAt: number;
  calibrations: Record<string, Calibration>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

/** 列出本机已有的全部标定，键是地图 ID */
export async function listCalibrations(userDataPath: string): Promise<Record<string, Calibration>> {
  let names: string[];
  try {
    names = await readdir(join(userDataPath, CALIBRATION_DIR));
  } catch {
    return {};
  }

  const result: Record<string, Calibration> = {};
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const mapId = name.slice(0, -".json".length);
    const calibration = await loadCalibration(userDataPath, mapId);
    if (calibration !== null) result[mapId] = calibration;
  }
  return result;
}

/** 把本机标定导出成一个标定包文件，返回地图数量 */
export async function exportBundle(userDataPath: string, filePath: string): Promise<number> {
  const calibrations = await listCalibrations(userDataPath);
  const bundle: CalibrationBundleFile = {
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    calibrations,
  };
  await writeFile(filePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  return Object.keys(calibrations).length;
}

/** 从标定包导入，逐张校验，返回成功导入的地图 ID */
export async function importBundle(userDataPath: string, filePath: string): Promise<string[]> {
  const text = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(text);

  if (!isRecord(parsed) || parsed.version !== BUNDLE_VERSION || !isRecord(parsed.calibrations)) {
    throw new Error("不是有效的标定包（版本或结构不符）");
  }

  const saved: string[] = [];
  for (const [mapId, value] of Object.entries(parsed.calibrations)) {
    const result = CalibrationSchema.safeParse(value);
    if (!result.success || result.data.mapId !== mapId) continue;
    await saveCalibration(userDataPath, result.data);
    saved.push(mapId);
  }
  return saved;
}
