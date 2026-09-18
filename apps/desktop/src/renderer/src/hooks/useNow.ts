import { useEffect, useState } from "react";

/** 每秒刷新一次的当前时间，用于展示"N 秒前"这类新鲜度文案 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
