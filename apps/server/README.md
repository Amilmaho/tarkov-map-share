# apps/server — 实时服务端

Node.js + TypeScript 服务端，负责房间生命周期、权威状态与实时广播。

## 模块划分

```text
apps/server/
├── src/
│   ├── gateway/         # 连接、鉴权、心跳、消息入口与 Zod 校验
│   ├── rooms/           # 房间注册表、成员、快照、广播
│   ├── handlers/        # 按消息类型划分的处理函数（纯逻辑）
│   ├── persistence/     # SQLite 读写与迁移
│   └── http/            # Fastify：健康检查、地图清单、房间码校验
└── tests/               # 房间与协议集成测试
```

## 依赖与命令

依赖在 Phase 2 引入（`ws`、Fastify、Zod、better-sqlite3）。当前骨架阶段不提供可运行脚本，
`npm run dev:server` 会以 `--if-present` 安静跳过。

## 关键约束

1. 服务端是房间状态的唯一权威来源，客户端只做乐观更新。
2. 所有入站消息：先查体积 → 再 `JSON.parse` → 最后过 Zod Schema。
3. handler 保持纯逻辑，副作用（send / broadcast / 落库）通过注入以便测试。
4. 位置消息 last-write-wins，可丢弃；标记/路线使用软删除。
5. 日志不得包含口令与 Token。

详见 [../../docs/WEBSOCKET_PROTOCOL.md](../../docs/WEBSOCKET_PROTOCOL.md) 与
[../../skills/websocket/SKILL.md](../../skills/websocket/SKILL.md)。
