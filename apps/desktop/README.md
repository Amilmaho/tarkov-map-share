# apps/desktop — 桌面客户端

Electron + React + TypeScript 桌面端，负责地图渲染、房间交互与实时同步。

## 职责

* **Main 进程**：窗口与生命周期、托盘、系统通知、本地配置与 Token 安全存储。
* **Preload**：`contextBridge` 暴露白名单 IPC；渲染进程关闭 `nodeIntegration`。
* **Renderer**：React 界面，按 `features/` 分层，状态用 Zustand，地图用 Canvas 2D。

## 规划目录

```text
apps/desktop/
├── src/
│   ├── main/            # Electron 主进程
│   ├── preload/         # IPC 桥
│   └── renderer/
│       ├── features/
│       │   ├── map/       # 地图视图、图层、缩放平移
│       │   ├── markers/   # 标记与路线
│       │   ├── room/      # 房间创建/加入、成员列表
│       │   └── session/   # 连接状态、重连
│       ├── services/ws/   # WebSocket 客户端
│       ├── stores/        # Zustand Store
│       └── styles/
└── tests/                 # 组件测试与 Playwright 用例
```

## 依赖与命令

依赖在 Phase 3 引入（Electron、React、Vite、Zustand）。当前骨架阶段不提供可运行脚本，
`npm run dev:desktop` 会以 `--if-present` 安静跳过。

## 关键约束

1. 渲染进程不直连数据库、不直接持有 Node 能力。
2. 坐标换算一律调用 `packages/shared`，组件内禁止硬编码。
3. 位置更新走 `requestAnimationFrame` 节流，不做逐消息重绘。

详见 [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与
[../../skills/map-system/SKILL.md](../../skills/map-system/SKILL.md)。
