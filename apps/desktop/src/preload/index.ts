import { contextBridge, ipcRenderer } from "electron";

import type { Calibration, ScreenshotCapture } from "@tarkov-map-share/shared";

import type { DesktopApi } from "../shared/ipc";

/**
 * 暴露给渲染进程的白名单 API。
 *
 * 每个方法都只做一件事：转发到主进程的 IPC 通道。
 * 渲染进程拿不到 ipcRenderer 本身，也无法构造任意通道名。
 */
const api: DesktopApi = {
  appInfo: () => ipcRenderer.invoke("app:info"),
  screenshots: {
    status: () => ipcRenderer.invoke("screenshots:status"),
    latest: () => ipcRenderer.invoke("screenshots:latest"),
    setDirectory: (directory) => ipcRenderer.invoke("screenshots:set-directory", directory),
    pickDirectory: () => ipcRenderer.invoke("screenshots:pick-directory"),
    onCapture: (callback: (capture: ScreenshotCapture) => void) => {
      const listener = (_event: unknown, capture: ScreenshotCapture): void => {
        callback(capture);
      };
      ipcRenderer.on("screenshots:capture", listener);
      return () => {
        ipcRenderer.removeListener("screenshots:capture", listener);
      };
    },
  },
  calibration: {
    load: (mapId: string) => ipcRenderer.invoke("calibration:load", mapId),
    save: (mapId: string, calibration: Calibration) =>
      ipcRenderer.invoke("calibration:save", mapId, calibration),
    list: () => ipcRenderer.invoke("calibration:list"),
    exportBundle: () => ipcRenderer.invoke("calibration:export"),
    importBundle: () => ipcRenderer.invoke("calibration:import"),
  },
  host: {
    start: () => ipcRenderer.invoke("host:start"),
    stop: () => ipcRenderer.invoke("host:stop"),
    state: () => ipcRenderer.invoke("host:state"),
  },
};

contextBridge.exposeInMainWorld("desktopApi", api);
