# AGENTS.md

## 项目说明

`tarkov-map-share` 是一个**多人实时地图共享工具**：玩家在桌面端打开一张《逃离塔科夫》地图，创建或加入一个房间，把自己的位置、标记、路线实时同步给队友。

项目目标是做成一个**纯辅助的协作工具**：

* 只处理玩家**主动提供**的信息（手动打点、分享房间码、输入坐标、粘贴截图）。
* 不读取游戏内存，不注入进程，不模拟输入，不自动操作游戏客户端。
* 不提供任何影响对局公平性的能力。

项目同时承担学习目标：通过实际开发学习 Agent 如何理解项目、拆分任务、使用 Skill、修改代码、编写测试和做 Code Review。

---

# 一、目录结构

```text
tarkov-map-share/
├── AGENTS.md                  # Agent 与协作者的通用开发约定（本文件）
├── README.md                  # 项目介绍、快速开始
├── docs/                      # 设计与协议文档（唯一事实来源）
│   ├── ARCHITECTURE.md        # 系统架构、模块划分、数据流
│   ├── DEVELOPMENT_PLAN.md    # 分阶段开发计划与验收标准
│   ├── WEBSOCKET_PROTOCOL.md  # 实时通信协议
│   ├── MAP_COORDINATES.md     # 地图坐标系与坐标变换
│   ├── DATA_MODEL.md          # 数据模型、类型定义、持久化结构
│   └── DECISIONS.md           # 架构决策记录（ADR）
├── skills/                    # 面向 Agent 的专项技能说明
│   ├── project-development/SKILL.md
│   ├── websocket/SKILL.md
│   ├── map-system/SKILL.md
│   └── testing/SKILL.md
├── apps/
│   ├── desktop/               # Electron + React 桌面客户端
│   └── server/                # Node.js 实时服务端
└── packages/
    └── shared/                # 共享类型、协议 Schema、坐标计算
```

---

# 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 桌面端 | Electron、React、TypeScript、Vite、Zustand、Tailwind CSS |
| 地图渲染 | Canvas 2D / Konva（自绘缩放、平移、打点） |
| 服务端 | Node.js、TypeScript、`ws`、Fastify（HTTP 辅助接口） |
| 共享层 | TypeScript、Zod（运行时校验 + 类型推导） |
| 存储 | SQLite（持久化房间与标记）、内存（在线房间状态） |
| 测试 | Vitest（单元/集成）、Playwright（桌面端端到端） |

版本与最终选型以 `docs/DECISIONS.md` 为准；与文档冲突时，先更新文档再改代码。

---

# 三、开发命令

```bash
npm install                 # 安装全部 workspace 依赖
npm run dev:server          # 启动实时服务端（开发模式）
npm run dev:desktop         # 启动 Electron 桌面端（开发模式）
npm run typecheck           # 全仓库类型检查
npm test                    # 全仓库单元测试
npm run lint                # 代码风格检查
```

脚本按 Phase 逐步补齐，具体以 `apps/*/package.json` 为准。

---

# 四、基本开发原则

## 1. 修改代码之前先理解项目

在修改代码之前：

1. 阅读 `docs/` 下与任务相关的文档。
2. 查找已有的相关实现（组件、Hook、Service、类型）。
3. 理解当前代码结构与数据流。
4. 判断哪些文件需要修改。
5. 给出简短的实现计划。
6. 再开始写代码。

不要在不了解现有实现的情况下直接重构。

## 2. 优先复用已有实现

在创建新的 Component、Hook、Service、Store、API、类型之前，先搜索项目中是否已有类似实现，并优先保持项目现有风格，不要为一个小功能引入过度抽象。

## 3. 保持修改范围最小

* 只修改与任务相关的文件。
* 不顺手重构无关代码。
* 不删除没有被要求删除的功能。
* 需要调整架构时，先在 `docs/DECISIONS.md` 说明原因并获得确认。

## 4. 单一事实来源

* **协议**：`docs/WEBSOCKET_PROTOCOL.md` + `packages/shared` 的 Zod Schema。两者必须同步。
* **坐标**：所有世界坐标 ↔ 地图像素坐标的转换只能实现在 `packages/shared` 中，禁止在组件里重复实现。
* **类型**：跨进程/跨服务的数据结构只在 `packages/shared` 定义，禁止各端各写一份。

## 5. 类型安全

* TypeScript 开启 `strict`。
* 禁止 `any`；外部输入（网络消息、文件、剪贴板）必须先经 Zod 校验。
* 不使用非空断言 `!` 来绕过可能为空的状态，优先显式处理分支。

---

# 五、架构约束

1. **桌面端不直连数据库**，所有共享数据通过服务端提供。
2. **所有实时同步必须走 WebSocket**，消息格式必须符合 `docs/WEBSOCKET_PROTOCOL.md`。
3. **服务端是房间状态的权威来源**：客户端可以乐观更新，但以服务端广播的结果为准。
4. **坐标计算必须可测试**：新增地图时，必须提供校准数据与至少 3 个已知点的测试用例。
5. **渲染与业务分离**：地图渲染层只负责绘制，不承载业务规则。
6. **位置采集以截图文件名为准**：解析只允许实现在 `packages/shared/src/capture`，
   桌面端只负责目录监听与上报；解析失败时回退到地图点选通道。当前 Raid 的地图由玩家手动选择。
7. **首发平台是 Windows**：游戏与截图目录都在 Windows 主机上，macOS 仅用于开发与调试。
8. **只读外部文件**：截图目录、日志目录一律只读，不修改、不删除、不上传文件内容。

---

# 六、编码规范

* 文件与目录：`kebab-case`（组件文件可用 `PascalCase.tsx`）。
* 变量与函数：`camelCase`；类型与组件：`PascalCase`；常量：`SCREAMING_SNAKE_CASE`。
* 代码、标识符、注释用英文；面向用户的文案与 `docs/` 文档用中文。
* 导入顺序：第三方 → `@tarkov-map-share/*` → 相对路径。
* 提交信息：`feat: / fix: / docs: / test: / chore:` + 简要中文描述。

---

# 七、工作流

1. **理解**：读文档、读代码，确认任务边界。
2. **计划**：列出要改动的文件与验证方式。
3. **实现**：小步修改，保持可运行。
4. **验证**：类型检查 + 相关测试；涉及协议或坐标必须补测试。
5. **同步文档**：行为变化同步到 `docs/`，架构变化追加 ADR。

任何一步发现与文档冲突，先说明冲突点，再决定是改代码还是改文档。

---

# 八、测试要求

| 改动范围 | 必须补充的测试 |
| --- | --- |
| `packages/shared` 坐标计算 | 世界↔像素往返、缩放平移、边界点 |
| 协议消息 | Schema 校验用例 + 服务端处理用例 |
| 服务端房间逻辑 | 加入/离开/断线重连/并发更新 |
| 桌面端 UI | 关键交互的组件测试；主流程补 Playwright |

修复 Bug 时，先写一个能复现的失败测试，再修实现。

---

# 九、技能使用

`skills/` 下的技能在对应场景必须优先阅读：

* `project-development`：任何功能开发、任务拆解、提交前自检。
* `websocket`：新增/修改协议消息、服务端连接与房间逻辑。
* `map-system`：地图加载、坐标转换、打点、缩放平移。
* `testing`：编写或调整测试、设计测试数据。

---

# 十、红线

以下行为**绝对禁止**，属于项目红线：

1. 读取、扫描或修改《逃离塔科夫》游戏进程内存。
2. 注入 DLL、Hook 游戏函数、修改游戏文件。
3. 模拟键鼠输入、自动瞄准、自动移动或任何自动化对局操作。
4. 采集或传播其他玩家未主动共享的信息。
5. 使用来源不明或未授权的地图素材，地图资源必须记录来源与许可。
