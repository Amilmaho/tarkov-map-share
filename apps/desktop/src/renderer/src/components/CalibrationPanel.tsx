import { useState } from "react";

import { rotateCalibration180 } from "../calibration";
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
  const calibrationSource = useMapStore((state) => state.calibrationSource);
  const self = useMapStore((state) => state.self);
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

  const flip180 = (): void => {
    const store = useMapStore.getState();
    const current = store.calibration;
    if (current === null) return;
    store.setCalibration(rotateCalibration180(current), store.calibrationSource);
    setMessage({
      ok: true,
      text: "已翻转 180°：按一次截图核对，确认无误后点「计算并保存」把它固定下来",
    });
  };

  const tryPreset = (): void => {
    useMapStore.getState().applyPresetCalibration(mapId);
    setMessage({
      ok: true,
      text: "已套用预置标定：按一次截图核对。预置值由地图元数据推算，可能会整体偏移或方向相反。",
    });
  };

  const startShift = (): void => {
    if (self === null) {
      setMessage({ ok: false, text: "还没有位置：先回游戏按一次截图键，再回来点图上你实际所在的位置" });
      return;
    }
    useMapStore.getState().setMode("shift");
    setMessage({ ok: true, text: "现在在图上点一下你实际所在的位置（对照你那张标注图）" });
  };

  const exportBundle = async (): Promise<void> => {
    const result = await useMapStore.getState().exportBundle();
    setMessage({ ok: result.ok, text: result.message });
  };

  const importBundle = async (): Promise<void> => {
    const result = await useMapStore.getState().importBundle();
    setMessage({ ok: result.ok, text: result.message });
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

      {calibrationSource === "preset" ? (
        <div className="panel__notice">
          <p className="panel__hint">
            这是根据 tarkov.dev 地图元数据<strong>预置</strong>的标定，<strong>没有经过核对</strong>——
            实测它可能整体偏移或方向相反。按一次截图看点位；如果方向相反，点「翻转 180°」，
            确认无误后点「计算并保存」存到本机。
          </p>
          <div className="panel__actions">
            <button type="button" className="btn" onClick={flip180}>
              翻转 180°
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                useMapStore.getState().setCalibration(null);
                setMessage({ ok: true, text: "已取消预置标定" });
              }}
            >
              取消预置
            </button>
          </div>
        </div>
      ) : null}

      {mode !== "calibrate" ? (
        <>
          <p className="panel__hint">
            标定一次即可长期使用：找 4 个认得出的地标，在图上点选位置并填入它的世界坐标
            （站在地标上按一次截图键，回来点"用截图"就能自动填）。坐标要分散，别挤在一角。
          </p>
          <div className="panel__actions">
            <button type="button" className="btn btn--primary" onClick={startCalibration}>
              {calibration === null ? "开始标定" : "重新标定"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={calibration === null || self === null}
              onClick={startShift}
            >
              用我的位置校正
            </button>
            {calibration === null ? (
              <button type="button" className="btn" onClick={tryPreset}>
                试用预置标定
              </button>
            ) : null}
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
            <strong>点 2 个就能算</strong>（相似变换），3 个更稳，4 个以上最准（能吸收拉伸和透视）。
            两点要尽量离得远。
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

      <div className="panel__bundle">
        <p className="panel__hint">
          全部图标完后点「导出标定包」，把文件发给朋友——他们在同一位置点「导入」就能直接用，
          不用自己标。放到应用目录的 <code>calibrations/default.json</code> 还能随版本一起分发。
        </p>
        <div className="panel__actions">
          <button type="button" className="btn" onClick={() => void exportBundle()}>
            导出标定包
          </button>
          <button type="button" className="btn" onClick={() => void importBundle()}>
            导入标定包
          </button>
        </div>
      </div>
    </section>
  );
}
