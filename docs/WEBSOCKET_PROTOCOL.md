# WebSocket 协议

版本：`v1`（草稿）

本文件是实时通信的**唯一事实来源**。任何消息结构变化都必须同时更新：

1. 本文件；
2. `packages/shared/src/protocol` 中的 Zod Schema；
3. 服务端 handler 与桌面端分发逻辑。

三处不一致视为 Bug。

---

## 1. 传输与连接

| 项目 | 约定 |
| --- | --- |
| 传输 | WebSocket（本地开发 `ws://`，公网 `wss://`） |
| 路径 | `/ws` |
| 编码 | UTF-8 JSON（单条消息建议 ≤ 32 KB，硬上限 64 KB） |
| 心跳 | 客户端每 15s 发 `ping`，服务端回 `pong`；60s 无消息判定断线 |
| 鉴权 | `room.join` 时携带房间码（可选口令）；MVP 不做账号体系 |
| 重连 | 客户端指数退避（1s → 2s → 4s → 8s，上限 30s），重连后重新 `room.join` |

## 2. 消息信封

所有消息共用同一个信封，业务内容放在 `payload`：

```json
{
  "v": 1,
  "id": "01J8Z4M2KJ4N6P8Q2S7T1V3W9X",
  "type": "player.update",
  "ts": 1758182400000,
  "roomId": "R7K2QF",
  "from": "usr_01J8Z4M2KJ4N6P8Q2S7T1V3W9X",
  "payload": { }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `v` | `number` | 协议版本，当前为 `1`；不匹配时服务端返回 `error: PROTOCOL_VERSION` |
| `id` | `string` | 消息 ID（ULID），用于 `ack` 关联与去重 |
| `type` | `string` | 消息类型，见下表 |
| `ts` | `number` | 客户端发送时间戳（毫秒）；服务端记录自身接收时间 |
| `roomId` | `string \| null` | 房间上下文，未加入房间时为 `null` |
| `from` | `string \| null` | 玩家消息为 `usr_<ULID>`；服务端下发的消息固定为字面量 `"server"` |
| `payload` | `object` | 业务数据，按 `type` 校验 |

## 3. 消息类型总览

### 3.1 客户端 → 服务端

| `type` | payload | 说明 |
| --- | --- | --- |
| `room.create` | `{ mapId, displayName, maxMembers?, passcode? }` | 创建房间，返回房间码；口令可选，人数上限不传则由服务端决定 |
| `room.join` | `{ roomId, displayName, passcode? }` | 加入房间 |
| `room.leave` | `{}` | 主动离开 |
| `map.change` | `{ mapId }` | 切换整队地图（需要权限，默认房主） |
| `player.update` | `{ position, rotation?, mapId, source, capturedAt? }` | 上报自身位置；`capturedAt` 为采集时刻（如截图按下的时间） |
| `marker.create` | `{ marker }` | 创建标记（客户端生成 ID） |
| `marker.update` | `{ markerId, patch }` | 修改标记 |
| `marker.delete` | `{ markerId }` | 删除标记（软删除） |
| `route.create` | `{ route }` | 创建路线 |
| `route.update` | `{ routeId, patch }` | 修改路线 |
| `route.delete` | `{ routeId }` | 删除路线 |
| `snapshot.request` | `{}` | 主动请求一次全量快照 |
| `ping` | `{}` | 心跳 |

### 3.2 服务端 → 客户端

| `type` | payload | 说明 |
| --- | --- | --- |
| `room.created` | `{ room }` | 创建成功，含房间码与自身成员信息 |
| `room.joined` | `{ room, self }` | 加入成功 |
| `room.snapshot` | `{ room, members, players, markers, routes, serverTime }` | 全量状态；`players` 只包含至少上报过一次位置的成员 |
| `room.member_joined` | `{ member }` | 有新成员加入 |
| `room.member_left` | `{ memberId, reason }` | 成员离开（`leave` / `timeout` / `kicked`） |
| `map.changed` | `{ mapId, changedBy }` | 全队地图切换 |
| `player.updated` | `{ memberId, position, rotation, mapId, source }` | 其他玩家位置更新 |
| `marker.created` | `{ marker }` | 新标记 |
| `marker.updated` | `{ markerId, patch, updatedBy }` | 标记被修改 |
| `marker.deleted` | `{ markerId, deletedBy }` | 标记被删除 |
| `route.created` / `route.updated` / `route.deleted` | 同标记 | 路线变更 |
| `ack` | `{ refId, ok: true }` | 请求已应用 |
| `error` | `{ code, message, refId?, details? }` | 错误，见第 6 节 |
| `pong` | `{ serverTime }` | 心跳响应 |

## 4. 典型流程

### 4.1 创建并加入

```text
C → S  room.create { mapId: "customs", displayName: "阿飞" }
S → C  room.created { room: { id: "R7K2QF", ... }, self: {...} }
C → S  player.update { position: { x: 120.5, z: -60.25 }, mapId: "customs" }
S → C  （无回应：位置是高频且可丢弃的数据，不回 ack）
```

### 4.2 第二名成员加入

```text
C2 → S  room.join { roomId: "R7K2QF", displayName: "老李" }
S  → C2 room.joined { room, self }
S  → C2 room.snapshot { members, markers, routes, serverTime }
S  → C1 room.member_joined { member: {...} }
```

### 4.3 标记同步

```text
C1 → S  marker.create { marker: { id: "mk_01J...", kind: "loot", position: {...} } }
S  → C1 ack { refId }
S  → C2 marker.created { marker }
```

## 5. 一致性与冲突处理

1. **服务端权威**：客户端可乐观更新，收到 `ack` 或广播后以服务端数据为准。
2. **位置类消息**：只保留最新值（last-write-wins），服务端可丢弃过期 `player.update`。
3. **标记/路线**：按字段合并（patch），删除使用软删除 `deletedAt`。
4. **重复消息**：服务端按 `id` 去重，重复 `id` 直接返回 `ack`，不重复应用。
5. **顺序**：同一连接内消息按接收顺序处理；不同成员之间不保证全局顺序。
6. **快照对齐**：重连后必须重新 `room.join` + 接收 `room.snapshot`，用快照覆盖本地状态。
7. **未知字段忽略**：校验使用 `.strip()` 语义，多余字段被丢弃而不是报错，以支持协议第 8 节的向前兼容。
8. **空补丁拒绝**：`marker.update` / `route.update` 的 `patch` 不许为空对象。
9. **广播范围**：`player.updated`、`marker.*`、`route.*` 只发给**其他**成员（发送方已有乐观状态并会收到 `ack`）；
   `map.changed` 发给包括发起方在内的所有成员。
10. **`map.change` 权限**：房间内任意成员都可以切图（互信小队模型，见 ADR-0005）；需要收紧时只改这一处。
11. **状态与广播同源**：服务端先在内存状态上应用变更，再由同一份数据生成广播内容，保证各成员看到的状态一致。

## 6. 错误码

| `code` | HTTP 类比 | 说明 | 客户端处理 |
| --- | --- | --- | --- |
| `BAD_MESSAGE` | 400 | 信封或 payload 未通过校验 | 记日志，丢弃该消息 |
| `PROTOCOL_VERSION` | 400 | 协议版本不匹配 | 提示用户升级客户端 |
| `ROOM_NOT_FOUND` | 404 | 房间不存在或已关闭 | 回退到加入界面 |
| `ROOM_FULL` | 409 | 房间人数已满 | 提示人数已满 |
| `PASSCODE_REQUIRED` / `PASSCODE_INVALID` | 401 | 缺少或错误口令 | 弹出输入口令 |
| `RATE_LIMITED` | 429 | 触发频率限制 | 退避后重试，不弹错 |
| `FORBIDDEN` | 403 | 无权限（如非房主切图） | 提示无权限 |
| `ALREADY_IN_ROOM` | 409 | 重复加入 | 忽略，等待快照 |
| `NOT_IN_ROOM` | 409 | 未加入房间就发送了房间内消息 | 回到加入房间界面 |
| `INTERNAL` | 500 | 服务端异常 | 提示重试并上报日志 |

错误消息示例：

```json
{
  "v": 1,
  "id": "01J8Z4M6ZB1A2C3D4E5F6G7H8J",
  "type": "error",
  "ts": 1758182405000,
  "roomId": null,
  "from": "server",
  "payload": {
    "code": "ROOM_FULL",
    "message": "房间人数已满（5/5）",
    "refId": "01J8Z4M2KJ4N6P8Q2S7T1V3W9X"
  }
}
```

## 7. 频率限制

| 消息 | 限制 | 超限行为 |
| --- | --- | --- |
| `player.update` | 每人 15 条/秒 | 丢弃多余消息（不报错，避免刷屏） |
| `marker.create` | 每人 10 条/10 秒 | 返回 `RATE_LIMITED` |
| `route.*` | 每人 20 条/10 秒 | 返回 `RATE_LIMITED` |
| 连接级总消息量 | 60 条/秒 | 连续超限 3 次断开连接 |

## 8. 版本演进规则

* 新增**可选**字段：不升版本。
* 新增消息类型：不升版本，旧客户端忽略未知 `type` 并记录日志。
* 删除字段、修改字段语义、改必填性：**升版本**（`v` 递增）。
* 服务端同时支持相邻两个版本；不支持的版本返回 `PROTOCOL_VERSION`。

## 9. 安全要求

1. 服务端对每条消息先校验体积上限，再解析 JSON，最后过 Zod Schema。
2. 客户端不得信任服务端之外的任何输入；渲染标记文本时按纯文本处理，避免注入。
3. 房间码使用不易猜测的字符集与长度（≥ 6 位，排除易混字符 `0/O/1/I`）。
4. 公网部署必须使用 `wss://`，并把来源校验（Origin）与 TLS 终止写进部署文档。
5. 日志中禁止记录完整口令和 Token。
