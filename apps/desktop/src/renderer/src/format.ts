export type FreshnessLevel = "fresh" | "stale" | "expired" | "unknown";

export type Freshness = {
  level: FreshnessLevel;
  label: string;
};

/** 与设计一致：10 秒内算实时，1 分钟内算可参考，更久算过期 */
export const FRESH_MS = 10_000;
export const STALE_MS = 60_000;

export function formatFreshness(capturedAt: number | null, now: number): Freshness {
  if (capturedAt === null) return { level: "unknown", label: "位置未知" };

  const age = Math.max(0, now - capturedAt);
  if (age < FRESH_MS) return { level: "fresh", label: `${Math.round(age / 1000)} 秒前` };
  if (age < STALE_MS) return { level: "stale", label: `${Math.round(age / 1000)} 秒前` };

  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return { level: "expired", label: `${minutes} 分钟前` };
  return { level: "expired", label: `${Math.floor(minutes / 60)} 小时前` };
}

export function formatCoordinate(value: number): string {
  return value.toFixed(1);
}

export function formatPosition(x: number, z: number): string {
  return `(${formatCoordinate(x)}, ${formatCoordinate(z)})`;
}
