import { useState } from "react";

import { findMap } from "../maps";
import { useMapStore } from "../store";

type Message = { ok: boolean; text: string };

export function CalibrationPanel() {
  const mode = useMapStore((state) => state.mode);
  const draftPoints = useMapStore((state) => state.draftPoints);
  const calibration = useMapStore((state) => state.calibration);
  const note = useMapStore((state) => state.calibrationNote);
  const latestCapture = useMapStore((state) => state.latestCapture);
  const mapId = useMapStore((state) => state.mapId);
  const [message, setMessage] = useState<Message | null>(null);
  const map = findMap(mapId);

  const startCalibration = (): void => {
    useMapStore.getState().clearDraft();
    useMapStore.getState().setMode("calibrate");
    setMessage(null);
  };

  const fillFromCapture = (index: number): void => {
    if (latestCapture === null) {
      setMessage({ ok: false, text: "还没有截图：先在游戏里按一次截图键，再回来点这里" });
      return;
    }
    useMapStore.getState().updateDraftPoint(index, {
      world: { x: latestCapture.position.x, z: latestCapture.position.z },
    });
    setMessage({ ok: true, text: `已填入最新截图的坐标（${latestCapture.fileName.slice(0, 19)}…）` });
  };

  const commit = async (): Promise<void> => {
    const result = useMapStore.getState().commitCalibration();
    if (!result.ok) {
      setMessage({ ok: false, text: result.message });
      return;
    }

    const saved = await useMapStore.getState().saveCalibration();
    setMessage({ ok: saved.ok, text: `${result.message}；${saved.message}` });
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>地图标定</h2>
        <span className={`badge ${calibration !== null ? "badge--ok" : "badge--warn"}`}>
          {calibration !== null ? `${calibration.controlPoints.length} 个控制点` : "未标定"}
        </span>
      </header>

      {note !== null ? <p className="panel__note">{note}</p> : null}

      {mode !== "calibrate" ? (
        <>
          <p className="panel__hint">
            标定一次即可长期使用：找 4 个认得出的地标，站在上面按截图键，回到这里点选位置并填入坐标。
          </p>
          <div className="panel__actions">
            <button type="button" className="btn btn--primary" onClick={startCalibration}>
              {calibration === null ? "开始标定" : "重新标定"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                useMapStore.getState().setCalibration(null);
                setMessage({ ok: true, text: "已清除标定，地图恢复为未标定状态" });
              }}
            >
              清除标定
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="panel__hint">
            步骤：在图上点一下地标 → 填它的世界坐标（X 与 Z）。至少 4 个点，分布越开越准。
            <br />
            本地图的世界坐标范围：X {map.bounds.minX}~{map.bounds.maxX}，Z {map.bounds.minZ}~
            {map.bounds.maxZ}（超出范围会提示）
          </p>

          <ol className="points">
            {draftPoints.map((point, index) => {
              const world = point.world;
              return (
                <li className="points__row" key={`${index}-${world?.x ?? "n"}-${world?.z ?? "n"}`}>
                  <div className="points__title">
                    <span>控制点 {index + 1}</span>
                    <span className="text-muted">
                      像素 {point.image.px.toFixed(0)}, {point.image.py.toFixed(0)}
                    </span>
                  </div>
                  <form
                    className="points__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      const rawX = String(data.get("x") ?? "").trim();
                      const rawZ = String(data.get("z") ?? "").trim();
                      const x = Number(rawX);
                      const z = Number(rawZ);
                      if (rawX === "" || rawZ === "" || !Number.isFinite(x) || !Number.isFinite(z)) {
                        setMessage({ ok: false, text: "X 与 Z 都要填数字" });
                        return;
                      }
                      useMapStore.getState().updateDraftPoint(index, { world: { x, z } });
                      setMessage({ ok: true, text: `控制点 ${index + 1} 已填入 (${x}, ${z})` });
                    }}
                  >
                    <label>
                      X
                      <input name="x" type="number" step="0.1" defaultValue={world?.x ?? ""} />
                    </label>
                    <label>
                      Z
                      <input name="z" type="number" step="0.1" defaultValue={world?.z ?? ""} />
                    </label>
                    <button type="submit" className="btn">
                      填入
                    </button>
                    <button type="button" className="btn" onClick={() => fillFromCapture(index)}>
                      用截图
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => useMapStore.getState().removeDraftPoint(index)}
                    >
                      删除
                    </button>
                  </form>
                </li>
              );
            })}
          </ol>

          {draftPoints.length === 0 ? (
            <p className="panel__hint">还没有控制点：上面的"标定"按钮已经是开启状态，直接在地图上点地标即可。</p>
          ) : null}

          <div className="panel__actions">
            <button type="button" className="btn btn--primary" onClick={() => void commit()}>
              计算并保存
            </button>
            <button type="button" className="btn" onClick={() => useMapStore.getState().clearDraft()}>
              清空控制点
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => useMapStore.getState().setMode("view")}>
              结束标定
            </button>
          </div>
        </>
      )}

      {message !== null ? (
        <p className={message.ok ? "panel__message" : "panel__message panel__message--bad"}>{message.text}</p>
      ) : null}
    </section>
  );
}
