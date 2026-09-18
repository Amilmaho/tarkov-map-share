# 数据模型

所有跨端复用的类型定义在 `packages/shared/src/model`，并配套 Zod Schema 用于运行时校验。
数据库表结构由本文档定义，迁移脚本放在 `apps/server/src/persistence/migrations`。

---

## 1. 领域模型

### 1.1 成员 Player

```ts
type PlayerState = {
  id: string;              // usr_<ulid>
  displayName: string;     // 1..24 字符
  color: string;           // 分配的颜色（#RRGGBB），用于地图上的点
  mapId: string;           // 当前所在地图
  position: WorldPosition; // { x, y, z }，单位米
  rotation: number;        // 朝向角度，0 = 正北，顺时针为正
  source: "screenshot" | "manual" | "paste" | "log";
  online: boolean;
  lastSeenAt: number;      // 毫秒时间戳
  positionCapturedAt: number | null; // 位置采集时刻（截图按下/手动打点），队友端据此显示新鲜度
};

type WorldPosition = {
  x: number;
  y: number;   // 高度，不参与地图定位
  z: number;
};
```

`source` 的默认值是 `"screenshot"`：由游戏内置截图的文件名解析得到，精度为游戏原生数值。
`"manual"` / `"paste"` 是地图点选与手动输入通道，作为解析失败时的兜底。

`lastSeenAt` 表示"服务端最后一次收到该成员的消息"，只用于判断连接是否存活；
队友端展示的"N 秒前"必须使用 `positionCapturedAt`，否则位置放久了也会显示成最新的。

### 1.1.1 截图采集 ScreenshotCapture

```ts
type ScreenshotCapture = {
  fileName: string;
  capturedAt: { year: number; month: number; day: number; hour: number; minute: number; second: number | null };
  position: WorldPosition;   // 文件名中的 x, y, z
  rotation: Quaternion;      // 文件名中的 x, y, z, w
  headingDegrees: number;    // 由四元数换算，0 = 正北
  pitchDegrees: number;
  rollDegrees: number;
  unclassifiedValue: number; // 语义待确认，禁止参与业务计算
  sequence: number;          // 同分钟内序号
};
```

类型与解析函数来自 `packages/shared/src/capture/screenshot-filename.ts`，
详细字段说明见 `docs/MAP_COORDINATES.md` 第 7 节。

### 1.2 房间 Room

```ts
type Room = {
  id: string;            // 房间码，6 位，字符集 A-Z2-9（去掉易混字符）
  ownerId: string;       // 房主 usr id
  mapId: string;         // 当前地图
  maxMembers: number;    // 默认 5
  hasPasscode: boolean;  // 只暴露是否存在口令，不暴露哈希
  createdAt: number;
  updatedAt: number;
};

type RoomMember = {
  userId: string;
  roomId: string;
  role: "owner" | "member";
  joinedAt: number;
  online: boolean;
};
```

### 1.3 标记 Marker

```ts
type Marker = {
  id: string;            // mk_<ulid>，客户端生成
  roomId: string;
  mapId: string;
  kind: "loot" | "danger" | "extract" | "quest" | "note" | "spawn";
  position: WorldPosition;
  label: string;         // ≤ 64 字符，纯文本
  color: string | null;  // 为空时按 kind 使用默认色
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null; // 软删除
};
```

### 1.4 路线 Route

```ts
type Route = {
  id: string;            // rt_<ulid>
  roomId: string;
  mapId: string;
  name: string;
  points: WorldPosition[];  // 2..200 个点
  color: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
```

### 1.5 地图 MapDoc

```ts
type MapDoc = {
  id: string;            // "customs"
  name: string;          // "海关"
  imageWidth: number;
  imageHeight: number;
  calibration: Calibration;
  bounds: {              // 世界坐标包围盒，用于快速判断越界
    minX: number; maxX: number;
    minZ: number; maxZ: number;
  };
};
```

## 2. 关系概览

```text
Room 1 ── * RoomMember
Room 1 ── * Marker        (按 roomId 聚合，按 mapId 过滤)
Room 1 ── * Route
MapDoc 1 ── * Marker / Route （逻辑引用，mapId 为字符串外键）
PlayerState 1 ── 1 RoomMember （在线态在内存，不落库）
```

## 3. 存储策略

### 3.1 内存态（`rooms` 服务）

保存房间、成员、位置、标记、路线的**当前值**，由 `ws` 网关直接读写。

* 位置：每人只保留最新一条。
* 标记/路线：按 `roomId` 分组的 Map，值为最新状态。
* 房间全部成员离线且超过 `ROOM_TTL`（默认 6 小时）后回收。

### 3.2 SQLite（持久化）

| 表 | 主键 | 说明 |
| --- | --- | --- |
| `maps` | `id` | 地图元数据（尺寸、包围盒） |
| `map_calibrations` | `map_id` | 校准数据（JSON 列存控制点与矩阵） |
| `rooms` | `id` | 房间记录 |
| `room_members` | `(room_id, user_id)` | 成员与加入时间 |
| `markers` | `id` | 标记（含 `deleted_at`） |
| `routes` | `id` | 路线（`points` 存 JSON） |

约定：

* 所有时间使用**毫秒整数**（`INTEGER`）。
* 布尔使用 `INTEGER 0/1`。
* JSON 列在 Schema 中校验后再写入；读取时同样过一遍 Schema。
* 索引：`markers(room_id, map_id, deleted_at)`、`routes(room_id, map_id)`、
  `room_members(user_id)`。

### 3.3 保留策略

| 数据 | 保留 |
| --- | --- |
| 在线房间位置 | 仅内存，不落库 |
| 标记 / 路线 | 房间回收后随房间一起删除（默认 30 天） |
| 房间记录 | 30 天 |
| 服务日志 | 7 天，不含敏感字段 |

## 4. ID 与命名

| 对象 | 形式 | 生成方 |
| --- | --- | --- |
| 房间码 | 6 位 `A-Z2-9` | 服务端 |
| 用户 | `usr_<ULID>` | 服务端（首次加入时创建） |
| 标记 | `mk_<ULID>` | 客户端（乐观更新需要） |
| 路线 | `rt_<ULID>` | 客户端 |
| 消息 | `<ULID>` | 发送方 |

使用 ULID 保证按时间有序，便于排查与分页。

## 5. 校验规则

| 字段 | 规则 |
| --- | --- |
| `displayName` | 1–24 字符，去除首尾空格，禁止控制字符 |
| `label` / `name` | ≤ 64 字符，纯文本 |
| `color` | `#RRGGBB` |
| `position.x/z` | 有限数，`[-10000, 10000]` |
| `position.y` | 有限数，`[-1000, 1000]` |
| `rotation` | 有限数，归一化到 `[0, 360)` |
| `points` | 2–200 个点，相邻重复点自动合并 |
| `maxMembers` | 2–10，默认 5 |

客户端提交的是**草稿**（`MarkerDraft` / `RouteDraft`）：ID 由客户端生成以便乐观更新，
`roomId`、`createdBy`、`createdAt`、`updatedAt`、`deletedAt` 由服务端补齐；
修改走 `MarkerPatch` / `RoutePatch`，空补丁会被拒绝。

所有校验都用共享层的 Zod Schema 实现，服务端与客户端复用同一份规则。

## 6. 待确认

1. 是否需要"账号"概念，还是每次启动生成匿名 `usr` 并本地保存。
2. 标记是否需要归属人以外的编辑权限（当前设计：房间内任何人可改，记录 `updatedBy`）。
3. 是否保留历史位置轨迹（当前设计：不保留，出于隐私与体积考虑）。
