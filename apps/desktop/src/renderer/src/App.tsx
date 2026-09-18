import { useEffect } from "react";

import { MapCanvas } from "./components/MapCanvas";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { useMapStore } from "./store";

export function App() {
  const notice = useMapStore((state) => state.notice);
  const setNotice = useMapStore((state) => state.setNotice);

  useEffect(() => {
    const api = window.desktopApi;
    if (api === undefined) return;

    let cancelled = false;
    void (async () => {
      const [info, status, latest] = await Promise.all([
        api.appInfo(),
        api.screenshots.status(),
        api.screenshots.latest(),
      ]);
      if (cancelled) return;

      useMapStore.getState().setAppInfo(info);
      useMapStore.getState().setWatcher(status);
      if (latest !== null) useMapStore.getState().applyCapture(latest);
      await useMapStore.getState().loadCalibration();
    })();

    const unsubscribe = api.screenshots.onCapture((capture) => {
      useMapStore.getState().applyCapture(capture);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="app__body">
        <MapCanvas />
        <Sidebar />
      </div>

      {notice !== null ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" className="btn btn--ghost" onClick={() => setNotice(null)}>
            知道了
          </button>
        </div>
      ) : null}
    </div>
  );
}
