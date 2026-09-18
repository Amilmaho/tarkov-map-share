/**
 * 《逃离塔科夫》内置截图（游戏内截图键）的文件名解析。
 *
 * 文件名格式（已在真实样本上验证）：
 *
 * ```text
 * 2026-09-18[20-06]_-323.69, 2.44, -225.63_0.02332, 0.54903, -0.01533, 0.83534_15.72 (0).png
 * └─ 日期 ─┘└ 时间 ┘└────── 位置 x, y, z ──────┘└──────── 旋转四元数 x, y, z, w ────────┘└ 待定 ┘└序号┘
 * ```
 *
 * 各字段含义：
 *
 * - **位置** `(x, y, z)`：游戏世界坐标，单位米，`y` 为高度（不参与地图定位）。
 * - **旋转** `(x, y, z, w)`：单位四元数；模长恒为 1，其中 `y` 为主分量时表示偏航。
 * - **待定值**：语义未确认，候选为「游戏内时间（小时，十进制）」或「开镜时的视场角」。
 *   在确认之前不参与任何业务计算。
 * - **序号** `(n)`：同一分钟内的第 n 张截图（时间戳只精确到分钟）。
 *
 * 只解析**文件名**，不读取图片内容。
 */

import type { WorldPosition } from "../model/common";

/** 旋转四元数，与 Unity 一致，`w` 在最后 */
export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type ScreenshotTimestamp = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 部分版本的截图文件名不含秒，此时为 null */
  second: number | null;
};

export type ScreenshotCapture = {
  /** 原始文件名 */
  fileName: string;
  /** 文件名中的本地时间（不含时区信息，由调用方结合文件修改时间判断） */
  capturedAt: ScreenshotTimestamp;
  /** 玩家位置（世界坐标） */
  position: WorldPosition;
  /** 相机 / 玩家旋转四元数 */
  rotation: Quaternion;
  /** 朝向角：0 = 正北（+Z），顺时针为正，范围 [0, 360) */
  headingDegrees: number;
  /** 俯仰角，单位度，正值为抬头 */
  pitchDegrees: number;
  /** 翻滚角，单位度，正常情况下接近 0 */
  rollDegrees: number;
  /** 文件名末尾的待定数值，语义确认前不要使用 */
  unclassifiedValue: number;
  /** 同一分钟内的截图序号 */
  sequence: number;
};

export type ScreenshotParseResult =
  | {
      ok: true;
      capture: ScreenshotCapture;
      /** 格式可用但数值可疑时的提示，例如四元数模长偏离 1 */
      warnings: string[];
    }
  | { ok: false; reason: string };

const NUMBER_PATTERN = "-?\\d+(?:\\.\\d+)?";

/**
 * 截图文件名匹配规则。
 *
 * 宽松处：秒、序号、扩展名均可缺省，数字与分隔符之间允许多余空格。
 * 严格处：字段数量与顺序不可变，任何一个数字解析失败即视为不匹配。
 */
export const SCREENSHOT_FILENAME_PATTERN = new RegExp(
  [
    "^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})",
    "\\[(?<hour>\\d{2})-(?<minute>\\d{2})(?:-(?<second>\\d{2}))?\\]",
    `_(?<x>${NUMBER_PATTERN}) *, *(?<y>${NUMBER_PATTERN}) *, *(?<z>${NUMBER_PATTERN})`,
    `_(?<qx>${NUMBER_PATTERN}) *, *(?<qy>${NUMBER_PATTERN}) *, *(?<qz>${NUMBER_PATTERN}) *, *(?<qw>${NUMBER_PATTERN})`,
    `_(?<extra>${NUMBER_PATTERN})`,
    "(?:\\s*\\((?<sequence>\\d+)\\))?",
    "(?:\\.[A-Za-z0-9]{2,5})?$",
  ].join(""),
);

/** 供文件监听器做廉价预筛，避免对每个新文件都跑完整解析 */
export function isScreenshotFilename(fileName: string): boolean {
  return SCREENSHOT_FILENAME_PATTERN.test(fileName);
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * 四元数转欧拉角（Unity 约定：`+Y` 向上，偏航 0° 指向 `+Z`，正偏航转向 `+X`）。
 *
 * 与本项目 `docs/MAP_COORDINATES.md` 的约定一致：
 * `headingDegrees = 0` 表示正北，顺时针为正。
 */
export function quaternionToEuler(rotation: Quaternion): {
  headingDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
} {
  const { x, y, z, w } = rotation;

  const heading = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
  const pitchSin = Math.max(-1, Math.min(1, 2 * (w * x - y * z)));
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));

  return {
    headingDegrees: normalizeDegrees(toDegrees(heading)),
    pitchDegrees: toDegrees(Math.asin(pitchSin)),
    rollDegrees: toDegrees(roll),
  };
}

function quaternionLength(rotation: Quaternion): number {
  return Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
}

/**
 * 解析单张截图文件名。
 *
 * 调用方（桌面端文件监听器）应先用 `isScreenshotFilename` 预筛，
 * 再对新增文件调用本函数；解析失败时降级到「地图点选」通道，不要阻断上报。
 */
export function parseScreenshotFilename(fileName: string): ScreenshotParseResult {
  const match = SCREENSHOT_FILENAME_PATTERN.exec(fileName.trim());
  if (match?.groups === undefined) {
    return { ok: false, reason: "文件名不符合塔科夫截图命名格式" };
  }

  const groups = match.groups;
  const year = toNumber(groups.year);
  const month = toNumber(groups.month);
  const day = toNumber(groups.day);
  const hour = toNumber(groups.hour);
  const minute = toNumber(groups.minute);
  const second = toNumber(groups.second);
  const x = toNumber(groups.x);
  const y = toNumber(groups.y);
  const z = toNumber(groups.z);
  const qx = toNumber(groups.qx);
  const qy = toNumber(groups.qy);
  const qz = toNumber(groups.qz);
  const qw = toNumber(groups.qw);
  const extra = toNumber(groups.extra);

  if (
    year === null ||
    month === null ||
    day === null ||
    hour === null ||
    minute === null ||
    x === null ||
    y === null ||
    z === null ||
    qx === null ||
    qy === null ||
    qz === null ||
    qw === null ||
    extra === null
  ) {
    return { ok: false, reason: "文件名中的数字无法解析" };
  }

  if (
    !inRange(month, 1, 12) ||
    !inRange(day, 1, 31) ||
    !inRange(hour, 0, 23) ||
    !inRange(minute, 0, 59) ||
    (second !== null && !inRange(second, 0, 59))
  ) {
    return { ok: false, reason: "文件名中的时间字段超出有效范围" };
  }

  const rotation: Quaternion = { x: qx, y: qy, z: qz, w: qw };
  const position: WorldPosition = { x, y, z };
  const warnings: string[] = [];

  const rotationLength = quaternionLength(rotation);
  if (Math.abs(rotationLength - 1) > 0.05) {
    warnings.push(`旋转四元数模长为 ${rotationLength.toFixed(4)}，期望 1`);
  }

  if (!inRange(x, -10000, 10000) || !inRange(z, -10000, 10000) || !inRange(y, -1000, 1000)) {
    warnings.push(`位置 ${x}, ${y}, ${z} 超出合理范围，请确认坐标系是否变化`);
  }

  const euler = quaternionToEuler(rotation);
  const sequence = toNumber(groups.sequence);

  return {
    ok: true,
    warnings,
    capture: {
      fileName,
      capturedAt: { year, month, day, hour, minute, second },
      position,
      rotation,
      headingDegrees: euler.headingDegrees,
      pitchDegrees: euler.pitchDegrees,
      rollDegrees: euler.rollDegrees,
      unclassifiedValue: extra,
      sequence: sequence ?? 0,
    },
  };
}
