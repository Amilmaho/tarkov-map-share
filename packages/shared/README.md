# packages/shared — 共享层

桌面端与服务端共同依赖的**单一事实来源**：类型、协议 Schema、坐标计算。

## 规划目录

```text
packages/shared/
├── src/
│   ├── capture/      # 截图文件名解析（位置/朝向采集通道）
│   ├── protocol/     # 消息信封、各类型 payload 的 Zod Schema、错误码
│   ├── model/        # Room、Member、Marker、Route、PlayerState
│   ├── map/          # 单应变换、校准解析、坐标换算、Viewport
│   └── utils/        # ULID 与房间码生成
└── tests/            # 坐标与协议测试
```

## 约束

1. 不允许依赖 `apps/*`，不允许访问 DOM 或 Node 专有 API。
2. 类型由 Zod Schema 推导（`z.infer`），不手写重复定义。
3. 坐标换算只在这里实现，并有 ≥ 95% 覆盖率要求。
4. 依赖保持极简：当前只有 `zod`（固定 v3）。

## API 契约

```ts
export const PROTOCOL_VERSION = 1;

// 已完成
// parseScreenshotFilename / isScreenshotFilename / quaternionToEuler
// ClientMessageSchema / ServerMessageSchema / parseClientMessage / parseServerMessage
// solveHomography / worldToImage / imageToWorld / reprojectionError
// createViewport / worldToScreen / screenToWorld / zoomAtPoint / fitToViewport
// buildHomographyFromCalibration
// createUlid / createRoomCode / createPrefixedId

// 规划中
// （Phase 1 已完成，下一步是 Phase 2 服务端房间逻辑）
```

详见 [../../docs/DATA_MODEL.md](../../docs/DATA_MODEL.md) 与
[../../docs/MAP_COORDINATES.md](../../docs/MAP_COORDINATES.md)。
