import type { MarkerKind } from "@tarkov-map-share/shared";

import { MAPS, findMap } from "../maps";
import { MARKER_KIND_COLORS, MARKER_KIND_LABELS, useMapStore } from "../store";

const MARKER_KINDS: MarkerKind[] = ["danger", "loot", "extract", "quest", "note", "spawn"];

export function Toolbar() {
  const mapId = useMapStore((state) => state.mapId);
  const mode = useMapStore((state) => state.mode);
  const markerKind = useMapStore((state) => state.markerKind);
  const viewport = useMapStore((state) => state.viewport);
  const homography = useMapStore((state) => state.homography);

  const setMode = useMapStore((state) => state.setMode);
  const selectMap = useMapStore((state) => state.selectMap);
  const setMarkerKind = useMapStore((state) => state.setMarkerKind);
  const zoomBy = useMapStore((state) => state.zoomBy);
  const resetView = useMapStore((state) => state.resetView);

  const map = findMap(mapId);

  return (
    <header className="toolbar">
      <div className="toolbar__group">
        <select
          className="select"
          value={mapId}
          aria-label="选择地图"
          onChange={(event) => selectMap(event.target.value)}
        >
          {MAPS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className={`badge ${homography !== null ? "badge--ok" : "badge--warn"}`}>
          {homography !== null ? "已标定" : "未标定"}
        </span>
      </div>

      <div className="toolbar__group" role="group" aria-label="操作模式">
        <button
          type="button"
          className="btn"
          aria-pressed={mode === "view"}
          onClick={() => setMode("view")}
        >
          选择
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={mode === "marker"}
          onClick={() => setMode("marker")}
        >
          打点
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={mode === "self"}
          onClick={() => setMode("self")}
        >
          标记我的位置
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={mode === "calibrate"}
          onClick={() => setMode("calibrate")}
        >
          标定
        </button>
      </div>

      <div className="toolbar__group" role="group" aria-label="标记类型">
        {MARKER_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn btn--kind"
            aria-pressed={mode === "marker" && markerKind === kind}
            onClick={() => setMarkerKind(kind)}
          >
            <span className="dot" style={{ background: MARKER_KIND_COLORS[kind] }} />
            {MARKER_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="toolbar__group toolbar__group--end">
        <button type="button" className="btn" onClick={() => zoomBy(0.8)} aria-label="缩小">
          −
        </button>
        <span className="toolbar__zoom">{Math.round(viewport.scale * 100)}%</span>
        <button type="button" className="btn" onClick={() => zoomBy(1.25)} aria-label="放大">
          ＋
        </button>
        <button type="button" className="btn" onClick={resetView}>
          复位
        </button>
      </div>
    </header>
  );
}
