import { create } from "zustand";

import {
  type Calibration,
  type Marker,
  type MarkerKind,
  type Matrix3,
  type ScreenshotCapture,
  type Viewport,
  type WorldPosition,
  createUlid,
  fitToViewport,
  zoomAtPoint as zoomViewportAt,
} from "@tarkov-map-share/shared";

import type { AppInfo, ScreenshotWatcherStatus } from "../../shared/ipc";
import {
  type CalibrationBundle,
  type CalibrationDraftPoint,
  MODEL_LABELS,
  buildCalibration,
  calibrationQuality,
  parseBundle,
  presetCalibration,
  shiftCalibration,
} from "./calibration";
import { DEFAULT_MAP_ID, assetUrl, findMap, findMapOrNull } from "./maps";

export type InteractionMode = "view" | "marker" | "self" | "calibrate" | "shift";

/** 标定来源：随应用分发的共享包 / 元数据预置（未核对）/ 用户自己标的 / 没有 */
export type CalibrationSource = "none" | "preset" | "shared" | "user";

export type SelfPosition = {
  position: WorldPosition;
  headingDegrees: number;
  /** 应用到界面的时刻（截图文件名只精确到分钟，所以用收到的时间做新鲜度） */
  capturedAt: number;
  fileName: string;
  source: "screenshot" | "manual";
};

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = {
  loot: "战利品",
  danger: "敌情",
  extract: "撤离点",
  quest: "任务点",
  note: "备注",
  spawn: "出生点",
};

export const MARKER_KIND_COLORS: Record<MarkerKind, string> = {
  loot: "#f5a524",
  danger: "#ef5350",
  extract: "#3ecf8e",
  quest: "#a77bff",
  note: "#4c8dff",
  spawn: "#22b8cf",
};

type MapStore = {
  mapId: string;
  mode: InteractionMode;
  markerKind: MarkerKind;
  viewport: Viewport;
  canvasSize: { width: number; height: number };
  fitted: boolean;
  markers: Marker[];
  selectedMarkerId: string | null;
  self: SelfPosition | null;
  latestCapture: ScreenshotCapture | null;
  calibration: Calibration | null;
  calibrationSource: CalibrationSource;
  /** 随应用分发的共享标定包，只在本机没有该图标定时使用 */
  sharedCalibrations: Record<string, Calibration>;
  homography: Matrix3 | null;
  calibrationRms: number | null;
  calibrationNote: string | null;
  draftPoints: CalibrationDraftPoint[];
  watcher: ScreenshotWatcherStatus | null;
  appInfo: AppInfo | null;
  notice: string | null;

  setCanvasSize: (size: { width: number; height: number }) => void;
  selectMap: (mapId: string) => void;
  setMode: (mode: InteractionMode) => void;
  setMarkerKind: (kind: MarkerKind) => void;
  setViewport: (viewport: Viewport) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  zoomBy: (factor: number, anchor?: { sx: number; sy: number }) => void;
  fitView: () => void;
  resetView: () => void;
  setNotice: (notice: string | null) => void;

  addMarker: (kind: MarkerKind, position: WorldPosition) => boolean;
  removeMarker: (markerId: string) => void;
  clearMarkers: () => void;
  selectMarker: (markerId: string | null) => void;
  renameMarker: (markerId: string, label: string) => void;

  applyCapture: (capture: ScreenshotCapture) => void;
  setSelfManual: (position: WorldPosition) => void;
  setWatcher: (status: ScreenshotWatcherStatus) => void;
  setAppInfo: (info: AppInfo) => void;

  setCalibration: (calibration: Calibration | null, source?: CalibrationSource) => void;
  applyPresetCalibration: (mapId: string) => void;
  applyShift: (targetPixel: { px: number; py: number }) => boolean;
  loadSharedBundle: () => Promise<void>;
  exportBundle: () => Promise<{ ok: boolean; message: string }>;
  importBundle: () => Promise<{ ok: boolean; message: string }>;
  addDraftPoint: (point: CalibrationDraftPoint) => void;
  updateDraftPoint: (index: number, patch: Partial<CalibrationDraftPoint>) => void;
  removeDraftPoint: (index: number) => void;
  clearDraft: () => void;
  commitCalibration: () => { ok: boolean; message: string };
  saveCalibration: () => Promise<{ ok: boolean; message: string }>;
  loadCalibration: () => Promise<void>;
};

function emptyCanvasSize(): { width: number; height: number } {
  return { width: 0, height: 0 };
}

export const useMapStore = create<MapStore>((set, get) => ({
  mapId: DEFAULT_MAP_ID,
  mode: "marker",
  markerKind: "danger",
  viewport: { scale: 1, offsetX: 0, offsetY: 0 },
  canvasSize: emptyCanvasSize(),
  fitted: false,
  markers: [],
  selectedMarkerId: null,
  self: null,
  latestCapture: null,
  calibration: null,
  calibrationSource: "none",
  sharedCalibrations: {},
  homography: null,
  calibrationRms: null,
  calibrationNote: null,
  draftPoints: [],
  watcher: null,
  appInfo: null,
  notice: null,

  setCanvasSize: (size) => set({ canvasSize: size }),
  selectMap: (mapId) => {
    if (findMapOrNull(mapId) === null || get().mapId === mapId) return;
    set({
      mapId,
      markers: [],
      selectedMarkerId: null,
      calibration: null,
      calibrationSource: "none",
      homography: null,
      calibrationRms: null,
      calibrationNote: null,
      draftPoints: [],
      // 截图文件名里没有地图信息，所以切换地图后旧的自身位置不再可信
      self: null,
      fitted: false,
      notice: null,
    });
    void get().loadCalibration();
  },
  setMode: (mode) => set({ mode, notice: null }),
  setMarkerKind: (markerKind) => set({ markerKind, mode: "marker" }),
  setViewport: (viewport) => set({ viewport }),
  panBy: (deltaX, deltaY) => {
    const { viewport } = get();
    set({ viewport: { ...viewport, offsetX: viewport.offsetX + deltaX, offsetY: viewport.offsetY + deltaY } });
  },
  zoomBy: (factor, anchor) => {
    const { viewport, canvasSize } = get();
    const point = anchor ?? { sx: canvasSize.width / 2, sy: canvasSize.height / 2 };
    set({ viewport: zoomViewportAt(viewport, point, viewport.scale * factor), fitted: true });
  },
  fitView: () => {
    const { canvasSize, mapId } = get();
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const map = findMap(mapId);
    set({
      viewport: fitToViewport({ width: map.width, height: map.height }, canvasSize),
      fitted: true,
    });
  },
  resetView: () => get().fitView(),
  setNotice: (notice) => set({ notice }),

  addMarker: (kind, position) => {
    const { homography } = get();
    if (homography === null) {
      set({ notice: "还没有标定地图，无法把世界坐标换算成图上的位置" });
      return false;
    }

    const now = Date.now();
    const sameKind = get().markers.filter((marker) => marker.kind === kind).length + 1;
    const marker: Marker = {
      id: `mk_${createUlid(now)}`,
      roomId: "LOCAL1",
      mapId: get().mapId,
      kind,
      position,
      label: `${MARKER_KIND_LABELS[kind]} ${sameKind}`,
      color: MARKER_KIND_COLORS[kind],
      createdBy: "usr_LOCAL00000000000000000000",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    set({ markers: [...get().markers, marker], selectedMarkerId: marker.id, notice: null });
    return true;
  },
  removeMarker: (markerId) =>
    set({
      markers: get().markers.filter((marker) => marker.id !== markerId),
      selectedMarkerId: get().selectedMarkerId === markerId ? null : get().selectedMarkerId,
    }),
  clearMarkers: () => set({ markers: [], selectedMarkerId: null }),
  selectMarker: (selectedMarkerId) => set({ selectedMarkerId }),
  renameMarker: (markerId, label) =>
    set({
      markers: get().markers.map((marker) =>
        marker.id === markerId ? { ...marker, label, updatedAt: Date.now() } : marker,
      ),
    }),

  applyCapture: (capture) => {
    const { homography } = get();
    const hasPosition = capture.position.x !== 0 || capture.position.z !== 0;
    set({
      latestCapture: capture,
      self: {
        position: capture.position,
        headingDegrees: capture.headingDegrees,
        capturedAt: Date.now(),
        fileName: capture.fileName,
        source: "screenshot",
      },
      // 未标定时坐标只能显示在侧栏，画不到图上；这里必须说清楚，否则看起来像"没反应"
      notice:
        homography === null && hasPosition
          ? `已读到坐标 (${capture.position.x.toFixed(1)}, ${capture.position.z.toFixed(1)})，但地图还没标定，暂时画不到图上。点"开始标定"约 1 分钟即可完成。`
          : null,
    });
  },
  setSelfManual: (position) =>
    set({
      self: {
        position,
        headingDegrees: get().self?.headingDegrees ?? 0,
        capturedAt: Date.now(),
        fileName: "手动打点",
        source: "manual",
      },
    }),
  setWatcher: (watcher) => set({ watcher }),
  setAppInfo: (appInfo) => set({ appInfo }),

  setCalibration: (calibration, source = "user") => {
    if (calibration === null) {
      set({
        calibration: null,
        calibrationSource: "none",
        homography: null,
        calibrationRms: null,
        calibrationNote: null,
      });
      return;
    }

    const built = buildCalibration({
      mapId: calibration.mapId,
      image: calibration.image,
      source: calibration.source,
      points: calibration.controlPoints.map((point) => ({ image: point.image, world: point.world })),
      bounds: findMap(calibration.mapId).bounds,
    });

    if (!built.ok) {
      set({ calibration, calibrationSource: source, homography: null, calibrationNote: built.reason });
      return;
    }

    const quality = calibrationQuality(built.rmsError);
    const prefix =
      source === "preset" ? "预置标定（未核对） · " : source === "shared" ? "共享标定包 · " : "";
    const model = MODEL_LABELS[built.model];
    set({
      calibration,
      calibrationSource: source,
      homography: built.homography,
      calibrationRms: built.rmsError,
      calibrationNote:
        `${prefix}${model} · 重投影误差 ${built.rmsError.toFixed(2)} 像素（${quality.label}）` +
        (built.warnings.length > 0 ? `；${built.warnings.join("；")}` : ""),
      draftPoints: calibration.controlPoints.map((point) => ({ image: point.image, world: point.world })),
    });
  },

  applyPresetCalibration: (mapId) => {
    const map = findMapOrNull(mapId);
    if (map === null) return;
    get().setCalibration(
      presetCalibration({
        mapId: map.id,
        image: { src: map.imageUrl, width: map.width, height: map.height },
        bounds: map.bounds,
        source: map.source,
      }),
      "preset",
    );
  },

  applyShift: (targetPixel) => {
    const { calibration, self } = get();
    if (calibration === null) {
      set({ notice: "还没有标定：先标定这张图，或点「试用预置标定」" });
      return false;
    }
    if (self === null) {
      set({ notice: "还没有位置：先回游戏按一次截图键，再回来点图上你实际所在的位置" });
      return false;
    }

    const shifted = shiftCalibration(calibration, { x: self.position.x, z: self.position.z }, targetPixel);
    if (shifted === null) {
      set({ notice: "校正失败：当前标定数据不可用" });
      return false;
    }

    get().setCalibration(shifted, "user");
    set({
      mode: "view",
      notice: "已按你的位置整体平移标定；换个位置再按一次截图就能验证比例对不对。",
    });
    void get().saveCalibration();
    return true;
  },

  loadSharedBundle: async () => {
    try {
      const response = await fetch(assetUrl("calibrations/default.json"));
      if (!response.ok) return;
      const bundle: CalibrationBundle | null = parseBundle(JSON.parse(await response.text()));
      if (bundle === null) return;
      set({ sharedCalibrations: bundle.calibrations });
    } catch {
      // 没有共享标定包是正常情况
    }
  },

  exportBundle: async () => {
    const api = window.desktopApi;
    if (api === undefined) return { ok: false, message: "当前不在桌面端环境中，无法导出" };
    try {
      const result = await api.calibration.exportBundle();
      if (result === null) return { ok: false, message: "已取消导出" };
      return {
        ok: true,
        message: `已导出 ${result.mapCount} 张地图的标定：${result.path}（把这个文件发给朋友导入即可）`,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  importBundle: async () => {
    const api = window.desktopApi;
    if (api === undefined) return { ok: false, message: "当前不在桌面端环境中，无法导入" };
    try {
      const result = await api.calibration.importBundle();
      if (result === null) return { ok: false, message: "已取消导入" };
      await get().loadCalibration();
      return { ok: true, message: `已导入 ${result.mapCount} 张地图的标定` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  addDraftPoint: (point) => set({ draftPoints: [...get().draftPoints, point], notice: null }),
  updateDraftPoint: (index, patch) =>
    set({
      draftPoints: get().draftPoints.map((point, position) =>
        position === index ? { ...point, ...patch } : point,
      ),
    }),
  removeDraftPoint: (index) =>
    set({ draftPoints: get().draftPoints.filter((_point, position) => position !== index) }),
  clearDraft: () => set({ draftPoints: [] }),

  commitCalibration: () => {
    const { draftPoints, mapId } = get();
    const map = findMap(mapId);
    const built = buildCalibration({
      mapId,
      image: { src: map.imageUrl, width: map.width, height: map.height },
      source: map.source,
      points: draftPoints,
      bounds: map.bounds,
    });

    if (!built.ok) return { ok: false, message: built.reason };

    const quality = calibrationQuality(built.rmsError);
    const model = MODEL_LABELS[built.model];
    set({
      calibration: built.calibration,
      calibrationSource: "user",
      homography: built.homography,
      calibrationRms: built.rmsError,
      calibrationNote:
        `${model} · 重投影误差 ${built.rmsError.toFixed(2)} 像素（${quality.label}）` +
        (built.warnings.length > 0 ? `；${built.warnings.join("；")}` : ""),
      mode: "view",
    });
    return {
      ok: true,
      message:
        `标定完成（${model}）：重投影误差 ${built.rmsError.toFixed(2)} 像素` +
        (built.warnings.length > 0 ? `；注意：${built.warnings[0]}` : ""),
    };
  },

  saveCalibration: async () => {
    const { calibration } = get();
    const api = window.desktopApi;
    if (calibration === null) return { ok: false, message: "还没有可保存的标定" };
    if (api === undefined) return { ok: false, message: "当前不在桌面端环境中，无法保存" };

    try {
      await api.calibration.save(calibration.mapId, calibration);
      return { ok: true, message: "标定已保存" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  loadCalibration: async () => {
    const mapId = get().mapId;
    const api = window.desktopApi;

    if (api !== undefined) {
      try {
        const saved = await api.calibration.load(mapId);
        if (saved !== null) {
          get().setCalibration(saved, "user");
          return;
        }
      } catch {
        // 读取失败就回退到预置标定
      }
    }

    // 顺序：本机标定 → 随应用分发的共享标定包 → 什么都没有。
    // 不自动套用"元数据预置值"：它与素材实际覆盖范围不一致（见 docs/MAP_COORDINATES.md 8.2），
    // 静默套用会让用户以为点位是对的；预置值改为标定面板里的「试用预置标定」按钮。
    const shared = get().sharedCalibrations[mapId];
    if (shared !== undefined) {
      get().setCalibration(shared, "shared");
      return;
    }

    get().setCalibration(null);
  },
}));
