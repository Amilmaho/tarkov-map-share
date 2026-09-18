---
name: project-development
description: >-
  Guide feature development inside the tarkov-map-share monorepo: read the right
  docs first, split a task into verifiable steps, respect module boundaries, and
  run the pre-commit self-check. Use when implementing, refactoring, or reviewing
  any change in this repository, or when the user asks how to work on this project.
---

# 项目开发流程

## 快速开始

接到任何开发任务时，按顺序执行：

1. 读 `AGENTS.md` 的架构约束与红线。
2. 读与任务相关的 `docs/` 文档（协议、坐标、数据模型、决策）。
3. 用 `rg` 搜索已有实现，确认是否可以复用。
4. 写出简短计划（改哪些文件、怎么验证）。
5. 实现 → 类型检查 → 测试 → 同步文档。

## 任务拆解模板

```text
目标：<一句话说明交付物>
范围：<涉及的 app / package>
改动：
  - <文件路径>：<改什么>
验证：
  - npm run typecheck
  - npm test -- <相关测试>
风险：<协议/坐标/持久化等需要同步文档的点>
```

一个任务只解决一个目标。如果发现需要顺带改架构，先停下来说明，并在
`docs/DECISIONS.md` 追加 ADR。

## 模块边界

| 目录 | 可以依赖 | 不允许 |
| --- | --- | --- |
| `packages/shared` | 仅第三方库 | 依赖 `apps/*`、访问 DOM / Node API |
| `apps/desktop` | `packages/shared` | 直连数据库、在组件里重写坐标换算 |
| `apps/server` | `packages/shared` | 依赖 `apps/desktop`、把业务逻辑写进网关 |

新增类型前先问：它是否会被两端使用？是则放 `packages/shared`。

## 提交前自检清单

```
Task Progress:
- [ ] 类型检查通过（npm run typecheck）
- [ ] 相关测试通过，且为 Bug 修复补齐了复现用例
- [ ] 没有新增 any / 非空断言绕过
- [ ] 协议或坐标变更已同步 docs/ 与 shared schema
- [ ] 架构级变化已记录 ADR
- [ ] 未触碰 AGENTS.md 第十节红线
- [ ] 未提交调试日志与临时文件
```

## 代码约定

* 文件 `kebab-case`，组件 `PascalCase.tsx`。
* 导入顺序：第三方 → `@tarkov-map-share/*` → 相对路径。
* 外部输入（网络消息、剪贴板、文件）先过 Zod Schema 再使用。
* 提交信息：`feat: / fix: / docs: / test: / chore:` + 中文简述。

## 常见错误

| 现象 | 原因 | 正确做法 |
| --- | --- | --- |
| 两端类型不一致 | 各自定义了同名类型 | 统一放 `packages/shared` |
| 标记位置漂移 | 组件内自己算了像素坐标 | 调用共享层坐标 API |
| 消息字段对不上 | 改了 Schema 没改文档或 handler | 三处同步（文档 / Schema / handler） |
| 测试通过但线上崩 | 未校验外部输入 | 加 Schema 校验与非法输入用例 |
| 顺手重构引发回归 | 修改范围超出任务 | 拆成独立任务 |

## 相关文档

* 架构与约束：[../../AGENTS.md](../../AGENTS.md)、[../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
* 阶段计划：[../../docs/DEVELOPMENT_PLAN.md](../../docs/DEVELOPMENT_PLAN.md)
* 决策记录：[../../docs/DECISIONS.md](../../docs/DECISIONS.md)
