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

/**
 * 必须打包进产物的依赖：这两个是纯 TS 源码包，Node 不能直接 require。
 *
 * 注意：不要把 `ws` 也打包进来——实测它在 rollup 里会被改写，
 * 结果是主进程启动服务端后整个卡死（IPC 与页面都无响应）。
 * `ws` 保持外部引用，打包时由 tools/prepare-package.mjs 复制到应用自己的 node_modules。
 */
const BUNDLED_DEPENDENCIES = ["@tarkov-map-share/shared", "@tarkov-map-share/server"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_DEPENDENCIES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_DEPENDENCIES })],
  },
  renderer: {
    plugins: [react()],
  },
});
