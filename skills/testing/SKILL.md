---
name: testing
description: >-
  Write and run tests for tarkov-map-share: Vitest unit and integration tests,
  WebSocket room tests with fake clients, coordinate test data, and Playwright
  end-to-end coverage of the Electron app. Use when adding tests, fixing failing
  tests, designing test data, or setting up CI checks.
---

# 测试规范

## 测试金字塔

| 层级 | 工具 | 覆盖对象 | 目标 |
| --- | --- | --- | --- |
| 单元 | Vitest | 坐标换算、Schema、纯函数、Store | 快、多、无 IO |
| 集成 | Vitest + 假客户端 | 房间生命周期、广播、限流、持久化 | 覆盖协议行为 |
| 端到端 | Playwright | 创建房间 → 加入 → 打点 → 同步 | 覆盖主流程 |

命令：

```bash
npm test                      # 全部单元 + 集成
npm test -- --watch           # 开发时监听
npm test -- packages/shared   # 只跑某个包
npm run test:e2e              # Playwright（需要构建桌面端）
```

## 单元测试

* 一个测试只验证一个行为，命名用中文描述行为：`it("世界坐标转像素后应落在控制点上")`。
* 坐标类测试使用**表驱动**，测试数据放在 `__fixtures__` 或 `.test-data.ts`。
* 禁止使用真实网络、真实时间、真实文件系统；用注入的时钟与临时目录。
* 浮点比较必须带容差：

```ts
expect(actual.px).toBeCloseTo(expected.px, 1); // 0.1 像素
```

## 集成测试（WebSocket）

用内存传输或 `ws` 监听随机端口启动服务端，构造假客户端：

```ts
const server = await startTestServer();          // 随机端口
const alice = await connectTestClient(server);   // 自动处理握手与信封
await alice.send("room.create", { mapId: "customs", displayName: "A" });
const room = await alice.waitFor("room.created");

const bob = await connectTestClient(server);
await bob.send("room.join", { roomId: room.payload.room.id, displayName: "B" });

await alice.send("marker.create", { marker: fixtureMarker });
const received = await bob.waitFor("marker.created");
expect(received.payload.marker.id).toBe(fixtureMarker.id);
```

断言前必须带超时（默认 2s），避免挂死 CI。测试结束务必关闭连接与服务端，防止句柄泄漏。

必须覆盖的负面用例：

1. 非法 payload（缺字段 / 类型错误 / 超长文本）。
2. 房间码错误、房间满员、重复加入。
3. 非成员发消息、非房主切图。
4. 超频触发 `RATE_LIMITED`。
5. 断开后成员列表更新；重连后快照追平。

## 端到端测试（Electron）

* 使用 Playwright 的 Electron 支持启动打包或开发构建。
* 每个用例独立启动两个窗口/两个 profile，用可预测的房间码。
* 只断言用户可见结果（标记出现、成员出现），不断言内部实现。
* 网络类用例通过注入的测试服务端地址运行，禁止依赖公网。

## 测试数据

* 地图坐标测试数据必须来自真实校准点，禁止随手编造。
* 需要负数、零、边界值、越界值四类数据。
* 标记/路线的 fixture 放在共享测试目录，两端复用。

## 覆盖目标

| 模块 | 目标 |
| --- | --- |
| `packages/shared/map` | ≥ 95%（核心精度逻辑） |
| `packages/shared/protocol` | ≥ 90% |
| `apps/server` 房间逻辑 | ≥ 85% |
| `apps/desktop` 组件 | 只覆盖关键交互，不追求数字 |

## 反模式

| 反模式 | 问题 |
| --- | --- |
| 用 `setTimeout` 等待而非等待消息 | 不稳定、CI 容易 flaky |
| 测试之间共享可变状态 | 顺序依赖，随机失败 |
| 断言实现细节（内部函数调用次数） | 重构即碎 |
| 只写正面用例 | 校验逻辑形同虚设 |
| 修 Bug 不补测试 | 同一 Bug 会回归 |

## 相关文档

* 阶段验收标准：[../../docs/DEVELOPMENT_PLAN.md](../../docs/DEVELOPMENT_PLAN.md)
* 协议与消息：[../../docs/WEBSOCKET_PROTOCOL.md](../../docs/WEBSOCKET_PROTOCOL.md)
* 坐标与校准：[../../docs/MAP_COORDINATES.md](../../docs/MAP_COORDINATES.md)
