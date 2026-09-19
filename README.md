# tarkov-map-share

多人实时地图共享工具：和朋友在同一张《逃离塔科夫》地图上同步位置、标记和路线。

> 这是一个纯协作辅助工具。它不读取游戏内存、不注入进程、不模拟输入，也不提供任何影响对局公平性的功能。

## 功能概览

| 功能 | 状态 |
| --- | --- |
| 房间创建 / 通过房间码加入 | 计划中 |
| 按截图键自动上报精确位置（解析游戏截图文件名） | 解析器已完成 |
| 协议消息 Schema（v1，共 29 种消息） | 已完成 |
| 世界坐标 ↔ 地图像素 ↔ 屏幕坐标换算 | 已完成 |
| 服务端房间核心（建房 / 加入 / 快照 / 广播 / 限流） | 已完成 |
| 房主模式（服务端内嵌在房主客户端，无需服务器） | 已完成 |
| 桌面端地图渲染（缩放 / 平移 / 打点 / 标定） | 已完成 |
| 截图目录监听（按截图键自动上报位置） | 已完成 |
| 10 张地图素材（来自 tarkov.dev 开源矢量图，CC BY-NC-SA 4.0） | 已完成 |
| 房间实时同步（创建/加入/广播/重连/坐标板） | 已完成 |
| 玩家位置与标记实时同步 | 已完成 |
| 地图标记（点位、文字、图标） | 计划中 |
| 路线绘制与共享 | 计划中 |
| 多地图切换与坐标校准 | 计划中 |
| 断线重连与状态恢复 | 计划中 |

## 技术栈

* **桌面端** `apps/desktop`：Electron + React + TypeScript + Vite + Zustand
* **服务端** `apps/server`：Node.js + TypeScript + `ws`
* **共享层** `packages/shared`：Zod Schema、协议类型、坐标换算
* **存储**：SQLite（持久化）+ 内存（在线房间状态）

## 目录结构

```text
tarkov-map-share/
├── AGENTS.md                  # 开发约定（先读这个）
├── docs/                      # 架构、协议、坐标、数据模型、决策记录
├── skills/                    # 面向 Agent 的专项技能
├── apps/desktop/              # 桌面客户端
├── apps/server/               # 实时服务端
└── packages/shared/           # 共享类型与坐标计算
```

## 快速开始

```bash
# 1. 安装依赖（workspace 统一安装）
npm install

# 2. 启动服务端
npm run dev:server

# 3. 另开一个终端启动桌面端
npm run dev:desktop
```

当前仓库处于脚手架阶段，命令会随开发计划逐阶段补齐，详见 `docs/DEVELOPMENT_PLAN.md`。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、模块划分、数据流 |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | 阶段划分、交付物、验收标准 |
| [docs/WEBSOCKET_PROTOCOL.md](docs/WEBSOCKET_PROTOCOL.md) | 实时通信协议与消息定义 |
| [docs/MAP_COORDINATES.md](docs/MAP_COORDINATES.md) | 游戏坐标与地图像素坐标换算 |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | 数据模型与持久化结构 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 架构决策记录（ADR） |

## 合规声明

本项目不读取游戏内存、不注入进程、不模拟输入。地图素材来源于社区公开资源时，必须在
`docs/MAP_COORDINATES.md` 的资源清单中记录来源与许可。
