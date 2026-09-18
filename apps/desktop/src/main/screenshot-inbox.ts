/**
 * 截图文件名收件箱：去重 + 连拍节流。
 *
 * 纯逻辑（不碰文件系统），因此可以直接单元测试。
 * 目录监听与定时器在 screenshot-watcher.ts 里。
 */

import {
  type ScreenshotCapture,
  isScreenshotFilename,
  parseScreenshotFilename,
} from "@tarkov-map-share/shared";

export const DEFAULT_THROTTLE_MS = 2_000;
export const DEFAULT_MAX_TRACKED_FILES = 500;

export type InboxResult =
  | { action: "emitted"; capture: ScreenshotCapture }
  | { action: "deferred"; capture: ScreenshotCapture }
  | { action: "ignored"; reason: "duplicate" | "not-screenshot" | "invalid-name" };

export type ScreenshotInboxOptions = {
  /** 连拍合并窗口，默认 2 秒 */
  throttleMs?: number;
  now?: () => number;
  maxTrackedFiles?: number;
};

export class ScreenshotInbox {
  readonly #throttleMs: number;
  readonly #now: () => number;
  readonly #maxTrackedFiles: number;
  /** 用数组维护插入顺序，避免 Set 无限增长 */
  #seen: string[] = [];
  #seenIndex = new Set<string>();
  #lastEmitAt: number | null = null;
  #pending: ScreenshotCapture | null = null;

  constructor(options: ScreenshotInboxOptions = {}) {
    this.#throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#maxTrackedFiles = options.maxTrackedFiles ?? DEFAULT_MAX_TRACKED_FILES;
  }

  get pendingCapture(): ScreenshotCapture | null {
    return this.#pending;
  }

  get trackedCount(): number {
    return this.#seenIndex.size;
  }

  /** 该文件是否已经被处理过（用于轮询时快速跳过） */
  has(fileName: string): boolean {
    return this.#seenIndex.has(fileName);
  }

  /** 启动时调用：把已存在的文件名标记为已处理，避免历史截图被当成本次上报 */
  prime(fileNames: Iterable<string>): number {
    let count = 0;
    for (const name of fileNames) {
      if (this.#remember(name)) count += 1;
    }
    return count;
  }

  push(fileName: string): InboxResult {
    if (this.#seenIndex.has(fileName)) return { action: "ignored", reason: "duplicate" };
    if (!isScreenshotFilename(fileName)) return { action: "ignored", reason: "not-screenshot" };

    const parsed = parseScreenshotFilename(fileName);
    if (!parsed.ok) {
      this.#remember(fileName);
      return { action: "ignored", reason: "invalid-name" };
    }

    this.#remember(fileName);
    const capture = parsed.capture;
    const now = this.#now();

    if (this.#lastEmitAt !== null && now - this.#lastEmitAt < this.#throttleMs) {
      // 连拍：只保留最后一次，等窗口结束再发
      this.#pending = capture;
      return { action: "deferred", capture };
    }

    this.#lastEmitAt = now;
    this.#pending = null;
    return { action: "emitted", capture };
  }

  /**
   * 取出被节流暂存的采集。
   *
   * @param force 忽略节流窗口（例如用户手动点击"立即同步"）
   */
  takePending(force = false): ScreenshotCapture | null {
    if (this.#pending === null) return null;
    const now = this.#now();
    if (!force && this.#lastEmitAt !== null && now - this.#lastEmitAt < this.#throttleMs) {
      return null;
    }

    const capture = this.#pending;
    this.#pending = null;
    this.#lastEmitAt = now;
    return capture;
  }

  #remember(fileName: string): boolean {
    if (this.#seenIndex.has(fileName)) return false;
    this.#seenIndex.add(fileName);
    this.#seen.push(fileName);

    while (this.#seen.length > this.#maxTrackedFiles) {
      const oldest = this.#seen.shift();
      if (oldest !== undefined) this.#seenIndex.delete(oldest);
    }
    return true;
  }
}
