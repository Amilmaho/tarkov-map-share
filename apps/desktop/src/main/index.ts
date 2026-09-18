import { join } from "node:path";

import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";

import type { Calibration } from "@tarkov-map-share/shared";

import type { AppInfo } from "../shared/ipc";
import { loadCalibration, saveCalibration } from "./calibration-store";
import { createScreenshotWatcher, defaultScreenshotDirectory } from "./screenshot-watcher";

let mainWindow: BrowserWindow | null = null;

const watcher = createScreenshotWatcher({
  onCapture: (capture) => {
    mainWindow?.webContents.send("screenshots:capture", capture);
  },
});

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: "#0d0f13",
    title: "塔科夫地图共享",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // 安全基线：渲染进程拿不到 Node，只能通过白名单 IPC 通信
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 外部链接一律交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl !== undefined && devServerUrl !== "") {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:info", (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      userDataPath: app.getPath("userData"),
    };
  });

  ipcMain.handle("screenshots:status", () => watcher.status());
  ipcMain.handle("screenshots:latest", () => watcher.latest());

  ipcMain.handle("screenshots:set-directory", async (_event, directory: unknown) => {
    if (directory !== null && typeof directory !== "string") {
      throw new Error("目录参数必须是字符串或 null");
    }
    return await watcher.setDirectory(directory);
  });

  ipcMain.handle("screenshots:pick-directory", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择塔科夫截图目录",
      defaultPath: watcher.status().directory ?? defaultScreenshotDirectory(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const selected = result.filePaths[0];
    if (selected === undefined) return null;
    await watcher.setDirectory(selected);
    return selected;
  });

  ipcMain.handle("calibration:load", async (_event, mapId: unknown) => {
    if (typeof mapId !== "string") throw new Error("mapId 必须是字符串");
    return await loadCalibration(app.getPath("userData"), mapId);
  });

  ipcMain.handle("calibration:save", async (_event, mapId: unknown, calibration: unknown) => {
    if (typeof mapId !== "string") throw new Error("mapId 必须是字符串");
    return await saveCalibration(app.getPath("userData"), calibration as Calibration);
  });
}

void app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();
  await watcher.scan();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void watcher.close();
});
