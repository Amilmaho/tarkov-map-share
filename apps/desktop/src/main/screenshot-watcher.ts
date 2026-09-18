/**
 * 截图目录监听。
 *
 * 实现选择：**定时扫描目录**而不是 fs.watch / chokidar。
 * 原因：Windows 上文档目录常被 OneDrive 接管，文件系统事件在这些同步目录上并不可靠；
 * 而目录扫描只有几百个条目，代价可以忽略，且行为在所有平台上完全一致。
 *
 * 默认目录：`<用户目录>/Documents/Escape from Tarkov/Screenshots`（Windows 与 macOS 通用）。
 */

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { type ScreenshotCapture, isScreenshotFilename } from "@tarkov-map-share/shared";

import type { ScreenshotWatcherStatus } from "../shared/ipc";
import { ScreenshotInbox } from "./screenshot-inbox";

export function defaultScreenshotDirectory(): string {
  return join(homedir(), "Documents", "Escape from Tarkov", "Screenshots");
}

export const DEFAULT_SCAN_INTERVAL_MS = 1_000;
const FLUSH_INTERVAL_MS = 250;

export type ScreenshotWatcherOptions = {
  /** 初始监听目录；不传则使用默认目录 */
  directory?: string;
  scanIntervalMs?: number;
  throttleMs?: number;
  onCapture: (capture: ScreenshotCapture) => void;
};

export type ScreenshotWatcher = {
  status: () => ScreenshotWatcherStatus;
  /** 传 null 恢复默认目录；只更新状态，不抛错 */
  setDirectory: (directory: string | null) => Promise<ScreenshotWatcherStatus>;
  latest: () => ScreenshotCapture | null;
  /** 立即扫描一次（测试与"重新读取"用） */
  scan: () => Promise<void>;
  close: () => Promise<void>;
};

export function createScreenshotWatcher(options: ScreenshotWatcherOptions): ScreenshotWatcher {
  const scanIntervalMs = options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
  const inbox = new ScreenshotInbox({
    ...(options.throttleMs === undefined ? {} : { throttleMs: options.throttleMs }),
  });

  let directory: string | null = options.directory ?? defaultScreenshotDirectory();
  let priming = true;
  let latest: ScreenshotCapture | null = null;
  let processedCount = 0;
  let lastError: string | null = null;
  let closed = false;

  const publish = (capture: ScreenshotCapture): void => {
    latest = capture;
    processedCount += 1;
    options.onCapture(capture);
  };

  const status = (): ScreenshotWatcherStatus => ({
    directory,
    directoryExists: directory !== null && existsSync(directory),
    watching: !closed && directory !== null && existsSync(directory),
    lastError,
    processedCount,
  });

  const scan = async (): Promise<void> => {
    if (closed || directory === null) return;

    const currentDirectory = directory;
    if (!existsSync(currentDirectory)) {
      lastError = `目录不存在：${currentDirectory}`;
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(currentDirectory);
    } catch (error) {
      lastError = `读取目录失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    lastError = null;

    const fresh = entries.filter((name) => !inbox.has(name) && isScreenshotFilename(name));
    if (fresh.length === 0) {
      if (priming) priming = false;
      return;
    }

    const withTime: { name: string; mtimeMs: number }[] = [];
    for (const name of fresh) {
      try {
        const info = await stat(join(currentDirectory, name));
        withTime.push({ name, mtimeMs: info.mtimeMs });
      } catch {
        // 文件可能刚好被删除或改名，忽略即可，下一轮会重新判断
      }
    }
    withTime.sort((a, b) => a.mtimeMs - b.mtimeMs);

    if (priming) {
      // 首次扫描只登记文件名，不上报历史截图
      inbox.prime(withTime.map((entry) => entry.name));
      priming = false;
      return;
    }

    for (const entry of withTime) {
      const result = inbox.push(basename(entry.name));
      if (result.action === "emitted") publish(result.capture);
    }
  };

  const scanTimer = setInterval(() => void scan(), scanIntervalMs);
  const flushTimer = setInterval(() => {
    const pending = inbox.takePending();
    if (pending !== null) publish(pending);
  }, FLUSH_INTERVAL_MS);
  scanTimer.unref();
  flushTimer.unref();

  return {
    status,
    latest: () => latest,
    scan,
    setDirectory: async (next: string | null) => {
      directory = next ?? defaultScreenshotDirectory();
      // 换目录后重新进入"只登记不上报"模式，避免把旧截图当成新截图
      priming = true;
      await scan();
      return status();
    },
    close: async () => {
      closed = true;
      clearInterval(scanTimer);
      clearInterval(flushTimer);
    },
  };
}
