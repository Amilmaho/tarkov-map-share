/**
 * 主进程 ↔ 渲染进程的 IPC 契约（类型层）。
 *
 * 渲染进程只能通过 `window.desktopApi` 访问这些能力，
 * 具体实现在 src/preload/index.ts，方法名与这里一一对应。
 */

import type { Calibration, ScreenshotCapture } from "@tarkov-map-share/shared";

export type AppInfo = {
  version: string;
  /** process.platform 的值，例如 `darwin` / `win32`（用 string 以免渲染进程依赖 Node 类型） */
  platform: string;
  /** 用户数据目录，标定文件与配置保存在这里 */
  userDataPath: string;
};

export type ScreenshotWatcherStatus = {
  /** 当前监听的截图目录，未设置时为 null */
  directory: string | null;
  /** 目录是否存在 */
  directoryExists: boolean;
  watching: boolean;
  /** 最近一次错误信息 */
  lastError: string | null;
  /** 已处理的截图数量 */
  processedCount: number;
};

export type CalibrationSaveInput = Calibration;

export type DesktopApi = {
  appInfo: () => Promise<AppInfo>;
  screenshots: {
    status: () => Promise<ScreenshotWatcherStatus>;
    /** 传 null 恢复默认目录 */
    setDirectory: (directory: string | null) => Promise<ScreenshotWatcherStatus>;
    pickDirectory: () => Promise<string | null>;
    latest: () => Promise<ScreenshotCapture | null>;
    /** 返回取消订阅函数 */
    onCapture: (callback: (capture: ScreenshotCapture) => void) => () => void;
  };
  calibration: {
    load: (mapId: string) => Promise<Calibration | null>;
    save: (mapId: string, calibration: CalibrationSaveInput) => Promise<void>;
  };
};
