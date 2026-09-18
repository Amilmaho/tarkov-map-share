---
name: websocket
description: >-
  Implement and change the realtime layer of tarkov-map-share: protocol envelope,
  message types, room lifecycle, reconnect, heartbeat, rate limiting and their
  tests. Use when adding or modifying any WebSocket message, server handler, room
  logic, or desktop WS client behaviour.
---

# 实时通信（WebSocket）

## 铁律

协议有三个必须同时更新的位置，缺一不可：

1. `docs/WEBSOCKET_PROTOCOL.md`
2. `packages/shared/src/protocol`（Zod Schema + 类型）
3. 服务端 handler 与桌面端消息分发

先改文档与 Schema，再改实现；Schema 是校验的唯一入口。

## 消息信封

```ts
type Envelope<T extends MessageType> = {
  v: 1;
  id: string;              // ULID
  type: T;
  ts: number;              // 毫秒
  roomId: string | null;
  from: string | null;
  payload: PayloadOf<T>;
};
```

任何消息的收发都必须走统一的 `parseEnvelope` / `createEnvelope`，禁止手写 JSON 拼装。

## 新增一个消息类型

```
Task Progress:
- [ ] 1. 在 docs/WEBSOCKET_PROTOCOL.md 的对应表格与流程里补上定义
- [ ] 2. 在 shared/protocol 增加 payload schema 并注册到 message union
- [ ] 3. 服务端 handler：校验 -> 鉴权/容量 -> 更新状态 -> ack + 广播
- [ ] 4. 桌面端：发送方 + 接收方处理，未知类型忽略并记日志
- [ ] 5. 测试：Schema 合法/非法用例 + 服务端行为用例 + 两客户端集成用例
```

## 服务端 handler 结构

```ts
async function handleMarkerCreate(ctx: RoomContext, env: Envelope, payload: MarkerCreatePayload) {
  assertRate(ctx, "marker.create");            // 限流
  assertMember(ctx, env.from);                 // 成员校验
  const marker = normalizeMarker(payload.marker, ctx.room); // 规范化 + 边界校验
  applyMarkerUpsert(ctx.state, marker);        // 更新权威状态
  send(ctx, ack(env.id));                      // 先 ack 发送方
  broadcastExcept(ctx, env.from, markerCreated(marker)); // 再广播其他成员
}
```

要求：

* 每个 handler 都是**纯逻辑 + 显式副作用**，便于单测（注入 send / broadcast 函数）。
* 校验失败返回 `error` 消息，**不要断开连接**；只有连续超限或畸形连接才断开。
* 位置消息使用 last-write-wins，可丢弃过期消息，不返回错误。
* 删除一律软删除（`deletedAt`），避免旧快照"复活"数据。

## 连接与重连

| 关注点 | 约定 |
| --- | --- |
| 心跳 | 15s `ping`；60s 无消息判定断线 |
| 重连 | 指数退避 1→2→4→8s，上限 30s，带随机抖动 |
| 重连后 | 重新 `room.join`，以 `room.snapshot` 覆盖本地状态 |
| 去重 | 服务端按 `id` 去重，重复消息只回 `ack` |
| 离线期间 | 客户端可暂存自己的操作，重连后按序补发（标记/路线）；位置不补发 |

## 安全与限制

* 先看消息体积（≤ 64 KB），再 `JSON.parse`，最后过 Schema。
* 校验 `Origin`（公网 `wss://` 部署），拒绝非白名单来源。
* 房间码 6 位 `A-Z2-9`；口令只存哈希，日志不记录。
* 渲染用户文本时按纯文本处理，禁止插入 HTML。

## 测试要点

* Schema：合法样例通过；缺字段、类型错误、超长文本、越界坐标被拒。
* 房间：创建/加入/重复加入/满员/错误房间码/房主离开。
* 广播：第二个客户端能收到第一个客户端的标记与位置更新。
* 断线：客户端断开后成员列表更新；重连后快照追平。
* 限流：超过阈值返回 `RATE_LIMITED` 且连接保持可用。

详细测试写法见 [../testing/SKILL.md](../testing/SKILL.md)。

## 反模式

| 反模式 | 问题 |
| --- | --- |
| 在 handler 里直接 `socket.send(JSON.stringify(...))` | 绕过信封与校验，无法测试 |
| 客户端自己判定"我是不是房主" | 权限必须在服务端校验 |
| 位置消息逐条转发不做合并 | 高频时带宽与渲染双爆 |
| 删除真删数据 | 并发下会被旧快照复活 |
