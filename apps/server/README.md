# apps/server — 实时服务端

Node.js + TypeScript 服务端，负责房间生命周期、权威状态与实时广播。

**默认拓扑是房主模式**（ADR-0013）：服务端跑在房主的电脑上，队友通过局域网地址连入，
不需要任何公网服务器；同一份代码也可以原样部署到 VPS。

## 模块划分

```text
apps/server/
├── src/
│   ├── create-server.ts   # createGameServer()：可嵌入的服务端工厂
│   ├── index.ts           # CLI 薄壳（读环境变量、打印局域网地址、优雅退出）
│   ├── config.ts          # 端口、心跳、限流、配色等常量
│   ├── logger.ts          # 结构化日志（自动脱敏口令）
│   ├── network.ts         # 枚举可分享的局域网地址
│   ├── gateway/           # 连接状态、限流、消息入口
│   ├── handlers/          # 按消息类型划分的处理函数（与传输层解耦）
│   └── rooms/             # 房间状态与不变量（容量、口令、标记、路线）
└── tests/               # 房间与协议集成测试
```

## 命令

```bash
npm run dev:server                       # 仓库根目录启动，默认 0.0.0.0:8787
TMS_PORT=9000 npm run dev:server         # 换端口
TMS_HOST=127.0.0.1 npm run dev:server    # 单机模式，队友连不上
```

启动后会打印队友应连接的局域网地址，例如 `192.168.31.33:8787`。
Windows 首次启动会弹出防火墙授权，必须允许专用网络访问。

## 作为库使用（桌面端）

```ts
import { createGameServer } from "@tarkov-map-share/server";

const server = await createGameServer({ host: "0.0.0.0", port: 8787 });
console.log(server.url, server.port);
// 退出时
await server.close();
```

## 关键约束

1. 服务端是房间状态的唯一权威来源，客户端只做乐观更新。
2. 所有入站消息：先查体积 → 再 `JSON.parse` → 最后过 Zod Schema。
3. handler 保持纯逻辑，副作用（send / broadcast / 落库）通过注入以便测试。
4. 位置消息 last-write-wins，可丢弃；标记/路线使用软删除。
5. 日志不得包含口令与 Token。

详见 [../../docs/WEBSOCKET_PROTOCOL.md](../../docs/WEBSOCKET_PROTOCOL.md) 与
[../../skills/websocket/SKILL.md](../../skills/websocket/SKILL.md)。
