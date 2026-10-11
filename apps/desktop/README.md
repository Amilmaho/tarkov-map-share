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
│       ├── public/maps/*.webp      # 10 张地图素材（由 tools/build-maps.mjs 生成）
│       └── src/
│           ├── components/         # MapCanvas / Toolbar / Sidebar / CalibrationPanel
│           ├── calibration.ts      # 标定草稿 → 单应矩阵（纯函数）
│           ├── maps.generated.ts   # 构建脚本生成的地图元数据（勿手改）
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
npm run build:win --workspace @tarkov-map-share/desktop   # 打 Windows 安装包 + 便携 zip
npm run build:mac --workspace @tarkov-map-share/desktop   # 仅用于本机验证打包产物，不对外分发
npm test --workspace @tarkov-map-share/desktop           # 单元测试
npm run test:e2e --workspace @tarkov-map-share/desktop   # 端到端（需先 build）
```

打包产物在 `apps/desktop/release/`：

* `tarkov-map-share Setup <版本>.exe` —— Windows 安装包，发给朋友装这个
* `tarkov-map-share-<版本>-win.zip` —— 免安装版，解压后直接跑 exe

**只发布 Windows**：塔科夫跑在 Windows 上，macOS 版没有任何使用场景。
`build:mac` 保留只是为了在开发机上验证"打包产物真的能跑"（`e2e/packaged.spec.ts`），
产物不用发给任何人。

应用图标在 `build/icon.svg`，用 `node tools/build-icon.mjs` 重新生成
`build/icon.png`（1024，macOS 与通用）与 `build/icon.ico`（6 个尺寸，Windows）
以及运行时用的 `src/renderer/public/icon.png`。

打包前的注意事项：

* `tools/prepare-package.mjs` 会把 `ws` 复制到应用自己的 `node_modules`——
  npm workspaces 会把它提升到仓库根目录，不复制的话打包产物会缺依赖
* 不要把 `ws` 打进主进程产物：实测 rollup 改写后会让主进程在启动服务端后卡死
* 国内网络需要镜像：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run build:win`
* 在 macOS 上打 Windows 包会跳过 exe 资源编辑（没有 wine），因此 exe 用默认 Electron 图标；
  想带上图标与版本信息，在 Windows 上跑同一条命令即可

首次安装如果卡在 Electron 二进制下载（国内网络常见），用镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

想在没有游戏的机器上联调时，可以用环境变量指定截图目录：

```bash
TMS_SCREENSHOT_DIR=/path/to/screenshots npm run dev:desktop
```

## 使用流程

0. **联机**：侧栏「联机」→ 填昵称 → 「创建房间（我是主机）」，把显示的地址和房间码发给队友；
   队友填地址 + 房间码 + 昵称点「加入」。房主模式下服务端跑在你自己电脑上，不需要服务器。
   队友位置会显示在「房间」面板里（坐标 + 多久前更新 + 一键复制）。

   异地联机的三种方式：

   | 场景 | 做法 |
   | --- | --- |
   | 同一个 WiFi / 网吧 | 直接用 192.168 开头的地址 |
   | 各自在家（推荐） | 双方装 Tailscale / ZeroTier，用 100.x 开头的虚拟地址（应用会把本机所有可用地址都列出来） |
   | 有公网 IP 或 VPS | 把 `apps/server` 部署到公网，客户端连 `wss://域名` |

   Tailscale 这类工具自带加密与 NAT 穿透，不需要改路由器；
   路由器端口映射在运营商级 NAT 下通常行不通，而且 `ws://` 是明文，不建议直接暴露到公网。
1. **选地图**：工具栏左上角切换（共 10 张）。
2. **标定**（每张图一次，约 1 分钟）：在图上点 2 个（或更多）认得出的地标，填它们的世界坐标——
   站在地标上按一次截图键，回来点"用截图"即可自动填入。**2 个点就能算**（相似变换），
   点 3 个更稳，4 个以上最准。两点要尽量离得远。
   标定面板里还有一个"试用预置标定"按钮（按地图元数据推算），但它**未经核实**，
   实测可能整体偏移，只建议用来快速核对方向。
3. **看自己的位置**：进游戏后按截图键，位置与朝向会自动出现在地图上，侧栏显示"N 秒前"。
4. **打点**：选好标记类型后在图上点一下；"选择"模式下点标记可选中、重命名、删除。

### 快速标定：单点校正

如果某张图的方向和比例大致正确、只是整体偏移（"试用预置标定"常见的结果），可以只点一下：

1. 点「试用预置标定」（或先做一次粗略标定）
2. 回游戏按一次截图键
3. 点「用我的位置校正」，然后在图上点你**实际所在**的位置

应用会把整张图的标定平移对齐并自动保存。改完换个位置再按一次截图即可验证：
如果点位仍然准，说明比例也是对的。

### 把标定分发给朋友

* 本机标定保存在用户数据目录的 `calibrations/`，不随程序走
* 标定面板 →「导出标定包」→ 得到一个 JSON 文件，发给朋友
* 朋友：标定面板 →「导入标定包」→ 选这个文件，直接能用，不用自己标
* 想随版本一起分发：把导出文件改名 `default.json` 放到
  `src/renderer/public/calibrations/` 并提交；应用在**本机没有该图标定**时会自动采用它

## 地图素材

素材不在仓库里手工维护，而是由脚本生成：

```bash
node tools/build-maps.mjs     # 下载 tarkov.dev 的 SVG → Chromium 渲染 → WebP → 生成元数据
```

脚本写入 `src/renderer/public/maps/*.webp` 与 `src/renderer/src/maps.generated.ts`，
下载缓存放在 `tools/.cache/`（已 gitignore）。

## 关键约束

1. 渲染进程不直接持有 Node 能力，所有文件访问都经过 preload 白名单。
2. 坐标换算一律调用 `packages/shared`，组件内禁止硬编码。
3. 只读截图目录：不读图片内容、不修改、不删除。
4. `@tarkov-map-share/shared` 是纯 TS 源码包，必须在主进程/预加载构建时**打包进去**
   （`electron.vite.config.ts` 已从外部化列表排除），否则 Node 会在运行时 `require` 一个 `.ts` 文件而崩溃。
5. 地图素材走 `document.baseURI` 解析：打包后页面是 `file://`，绝对路径 `/maps/...` 会解析到文件系统根目录。

详见 [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与
[../../skills/map-system/SKILL.md](../../skills/map-system/SKILL.md)。
