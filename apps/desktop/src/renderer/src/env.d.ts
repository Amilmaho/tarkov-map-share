import type { DesktopApi } from "../../shared/ipc";

declare global {
  interface Window {
    /** 由 preload 注入；在纯浏览器里预览时为 undefined */
    desktopApi?: DesktopApi;
  }
}

export {};
