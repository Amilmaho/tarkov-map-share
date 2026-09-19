import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * 使用 electron-vite 的默认目录约定：
 * - 主进程   src/main/index.ts
 * - 预加载   src/preload/index.ts
 * - 渲染进程 src/renderer/index.html
 *
 * `externalizeDepsPlugin` 让 dependencies 保持外部引用（不打包进产物），
 * 这样 chokidar 之类的依赖能正常使用。
 *
 * 例外：`@tarkov-map-share/shared` 是纯 TypeScript 源码包，运行时无法被 Node 直接 require，
 * 必须打包进产物，所以要从外部化列表里排除。
 */

/** 这两个是纯 TS 源码包，必须打包进产物；其余依赖保持外部引用 */
const WORKSPACE_PACKAGES = ["@tarkov-map-share/shared", "@tarkov-map-share/server"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  renderer: {
    plugins: [react()],
  },
});
