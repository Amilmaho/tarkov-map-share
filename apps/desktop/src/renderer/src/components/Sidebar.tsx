import { useState } from "react";

import { formatFreshness, formatPosition } from "../format";
import { useNow } from "../hooks/useNow";
import { MARKER_KIND_COLORS, MARKER_KIND_LABELS, useMapStore } from "../store";
import { CalibrationPanel } from "./CalibrationPanel";
import { RoomPanel } from "./RoomPanel";

export function Sidebar() {
  const now = useNow();
  const self = useMapStore((state) => state.self);
  const markers = useMapStore((state) => state.markers);
  const selectedMarkerId = useMapStore((state) => state.selectedMarkerId);
  const watcher = useMapStore((state) => state.watcher);
  const appInfo = useMapStore((state) => state.appInfo);
  const homography = useMapStore((state) => state.homography);
  const [editingLabel, setEditingLabel] = useState("");

  const freshness = formatFreshness(self?.capturedAt ?? null, now);
  const selected = markers.find((marker) => marker.id === selectedMarkerId) ?? null;

  const refreshWatcher = async (): Promise<void> => {
    const api = window.desktopApi;
    if (api === undefined) return;
    useMapStore.getState().setWatcher(await api.screenshots.status());
  };

  const pickDirectory = async (): Promise<void> => {
    const api = window.desktopApi;
    if (api === undefined) return;
    await api.screenshots.pickDirectory();
    await refreshWatcher();
  };

  const useLatestCapture = async (): Promise<void> => {
    const api = window.desktopApi;
    if (api === undefined) return;
    const latest = await api.screenshots.latest();
    useMapStore.getState().setWatcher(await api.screenshots.status());
    if (latest !== null) useMapStore.getState().applyCapture(latest);
  };

  return (
    <aside className="sidebar">
      <RoomPanel />

      <section className="panel">
        <header className="panel__head">
          <h2>我的位置</h2>
          <span className={`badge badge--${freshness.level}`}>{freshness.label}</span>
        </header>

        {self !== null ? (
          <>
            <p className="position">{formatPosition(self.position.x, self.position.z)}</p>
            <p className="panel__note">
              朝向 {Math.round(self.headingDegrees)}° · 来源{" "}
              {self.source === "screenshot" ? "游戏截图" : "手动打点"}
            </p>
          </>
        ) : (
          <p className="panel__hint">
            还没有位置。进游戏后按一次截图键即可自动上报；也可以标定后点"标记我的位置"在地图上点一下。
          </p>
        )}

        <div className="panel__actions">
          <button
            type="button"
            className="btn"
            disabled={homography === null}
            onClick={() => useMapStore.getState().setMode("self")}
          >
            手动标位置
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void useLatestCapture()}>
            读取最新截图
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel__head">
          <h2>截图目录</h2>
          <span className={`badge ${watcher?.watching === true ? "badge--ok" : "badge--warn"}`}>
            {watcher?.watching === true ? "监听中" : "未监听"}
          </span>
        </header>

        <p className="path" title={watcher?.directory ?? ""}>
          {watcher?.directory ?? "（未设置）"}
        </p>
        <p className="panel__note">
          已识别 {watcher?.processedCount ?? 0} 张
          {watcher !== null && watcher.directoryExists === false ? " · 目录不存在" : ""}
        </p>
        {watcher?.lastError != null ? <p className="panel__message panel__message--bad">{watcher.lastError}</p> : null}

        <div className="panel__actions">
          <button type="button" className="btn" onClick={() => void pickDirectory()}>
            选择目录
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void refreshWatcher()}>
            刷新状态
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel__head">
          <h2>标记 {markers.length}</h2>
          {markers.length > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={() => useMapStore.getState().clearMarkers()}>
              清空
            </button>
          ) : null}
        </header>

        {markers.length === 0 ? (
          <p className="panel__hint">还没有标记。选择"打点"模式后在地图上点一下即可（需要先标定）。</p>
        ) : (
          <ul className="marker-list">
            {markers.map((marker) => (
              <li key={marker.id} className={marker.id === selectedMarkerId ? "marker-list__row is-selected" : "marker-list__row"}>
                <button
                  type="button"
                  className="marker-list__main"
                  onClick={() => {
                    useMapStore.getState().selectMarker(marker.id);
                    setEditingLabel(marker.label);
                  }}
                >
                  <span className="dot" style={{ background: marker.color ?? MARKER_KIND_COLORS[marker.kind] }} />
                  <span>{marker.label}</span>
                  <span className="text-muted">{MARKER_KIND_LABELS[marker.kind]}</span>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => useMapStore.getState().removeMarker(marker.id)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected !== null ? (
          <div className="panel__actions">
            <input
              className="input"
              value={editingLabel === "" ? selected.label : editingLabel}
              onChange={(event) => setEditingLabel(event.target.value)}
              aria-label="标记名称"
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                const label = editingLabel.trim();
                if (label !== "") useMapStore.getState().renameMarker(selected.id, label);
                setEditingLabel("");
              }}
            >
              重命名
            </button>
          </div>
        ) : null}
      </section>

      <CalibrationPanel />

      <footer className="sidebar__foot">
        {appInfo !== null ? `v${appInfo.version} · ${appInfo.platform}` : "（未连接桌面端）"}
      </footer>
    </aside>
  );
}
