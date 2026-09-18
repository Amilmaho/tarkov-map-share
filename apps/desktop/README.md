# apps/desktop — 桌面客户端

Electron + React + TypeScript 桌面端：地图渲染、打点、截图目录监听。
当前对应 `docs/DEVELOPMENT_PLAN.md` 的 Phase 3（实时协作在 Phase 4 接入）。

## 职责划分

* **Main 进程**：窗口与生命周期、截图目录监听、标定文件读写、系统目录选择框。
* **Preload**：`contextBridge` 暴露白名单 API；渲染进程关闭 `nodeIntegration`、开启 `sandbox`。
* **Renderer**：React + Zustand + Canvas 2D，负责地图绘制与交互，坐标换算全部调用 `packages/shared`。

## 目录结构

```text
apps/desktop/
├── src/
│   ├── main/
│   │   ├── index.ts                # 窗口、IPC、生命周期
│   │   ├── screenshot-inbox.ts     # 去重 + 连拍节流（纯逻辑，可单测）
│   │   ├── screenshot-watcher.ts   # 定时扫描截图目录
│   │   └── calibration-store.ts    # 标定文件的读写与校验
│   ├── preload/index.ts            # 白名单 IPC 桥
│   ├── shared/ipc.ts               # 主进程 ↔ 渲染进程的类型契约
│   └── renderer/
│       ├── public/maps/customs.webp  # 地图素材（4608px 无损 WebP）
│       └── src/
│           ├── components/         # MapCanvas / Toolbar / Sidebar / CalibrationPanel
│           ├── calibration.ts      # 标定草稿 → 单应矩阵（纯函数）
│           ├── maps.ts             # 地图清单与资源路径解析
│           ├── store.ts            # Zustand 状态
│           └── format.ts           # 位置与新鲜度文案
├── e2e/app-smoke.spec.ts           # Playwright：启动并断言地图真的画出来了
└── tests/                          # Vitest：监听、标定、格式化
```

## 命令

```bash
npm run dev:desktop                                      # 仓库根目录：开发模式（热更新）
npm run build --workspace @tarkov-map-share/desktop      # 构建到 apps/desktop/out
npm test --workspace @tarkov-map-share/desktop           # 单元测试
npm run test:e2e --workspace @tarkov-map-share/desktop   # 端到端（需先 build）
```

首次安装如果卡在 Electron 二进制下载（国内网络常见），用镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

想在没有游戏的机器上联调时，可以用环境变量指定截图目录：

```bash
TMS_SCREENSHOT_DIR=/path/to/screenshots npm run dev:desktop
```

## 使用流程

1. **标定地图**（每张图一次）：点工具栏"标定" → 在地图上点 4 个认得出的地标 → 每个点填入它的
   世界坐标（站在地标上按一次截图键，回来点"用截图"即可自动填入）→ "计算并保存"。
2. **看自己的位置**：进游戏后按截图键，位置与朝向会自动出现在地图上，侧栏显示"N 秒前"。
3. **打点**：选好标记类型后在图上点一下；"选择"模式下点标记可选中、重命名、删除。

## 关键约束

1. 渲染进程不直接持有 Node 能力，所有文件访问都经过 preload 白名单。
2. 坐标换算一律调用 `packages/shared`，组件内禁止硬编码。
3. 只读截图目录：不读图片内容、不修改、不删除。
4. `@tarkov-map-share/shared` 是纯 TS 源码包，必须在主进程/预加载构建时**打包进去**
   （`electron.vite.config.ts` 已从外部化列表排除），否则 Node 会在运行时 `require` 一个 `.ts` 文件而崩溃。
5. 地图素材走 `document.baseURI` 解析：打包后页面是 `file://`，绝对路径 `/maps/...` 会解析到文件系统根目录。

详见 [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与
[../../skills/map-system/SKILL.md](../../skills/map-system/SKILL.md)。
