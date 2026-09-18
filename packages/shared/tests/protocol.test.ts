import { describe, expect, it } from "vitest";

import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  buildServerMessage,
  parseClientMessage,
  parseServerMessage,
} from "../src/protocol/messages";

const ULID = "01J8Z4M2KJ4N6P8Q2S7T1V3W9X";
const USER = `usr_${ULID}`;
const MARKER_ID = `mk_${ULID}`;
const ROUTE_ID = `rt_${ULID}`;
const ROOM = "R7K2QF";
const NOW = 1758182400000;

const envelope = { v: 1, id: ULID, ts: NOW, roomId: ROOM, from: USER };

const position = { x: 120.5, y: 2.44, z: -60.25 };

const room = {
  id: ROOM,
  ownerId: USER,
  mapId: "customs",
  maxMembers: 5,
  hasPasscode: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const member = { userId: USER, roomId: ROOM, role: "owner", joinedAt: NOW, online: true };

const player = {
  id: USER,
  displayName: "阿飞",
  color: "#4c8dff",
  mapId: "customs",
  position,
  rotation: 66.63,
  source: "screenshot",
  online: true,
  lastSeenAt: NOW,
  positionCapturedAt: NOW - 1500,
};

const marker = {
  id: MARKER_ID,
  roomId: ROOM,
  mapId: "customs",
  kind: "loot",
  position,
  label: "保险箱",
  color: null,
  createdBy: USER,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

const route = {
  id: ROUTE_ID,
  roomId: ROOM,
  mapId: "customs",
  name: "撤离路线",
  points: [position, { x: 90, y: 1.2, z: -140.5 }],
  color: "#4c8dff",
  createdBy: USER,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

const clientMessages = [
  { ...envelope, type: "room.create", payload: { mapId: "customs", displayName: "阿飞" } },
  { ...envelope, roomId: null, from: null, type: "room.join", payload: { roomId: ROOM, displayName: "老李" } },
  { ...envelope, type: "room.leave", payload: {} },
  { ...envelope, type: "map.change", payload: { mapId: "woods" } },
  {
    ...envelope,
    type: "player.update",
    payload: { position, rotation: 66.63, mapId: "customs", source: "screenshot", capturedAt: NOW - 1500 },
  },
  {
    ...envelope,
    type: "marker.create",
    payload: { marker: { id: MARKER_ID, mapId: "customs", kind: "loot", position, label: "保险箱" } },
  },
  { ...envelope, type: "marker.update", payload: { markerId: MARKER_ID, patch: { label: "已开" } } },
  { ...envelope, type: "marker.delete", payload: { markerId: MARKER_ID } },
  {
    ...envelope,
    type: "route.create",
    payload: { route: { id: ROUTE_ID, mapId: "customs", name: "路线", points: route.points, color: "#35c46a" } },
  },
  { ...envelope, type: "route.update", payload: { routeId: ROUTE_ID, patch: { name: "改道" } } },
  { ...envelope, type: "route.delete", payload: { routeId: ROUTE_ID } },
  { ...envelope, type: "snapshot.request", payload: {} },
  { ...envelope, type: "ping", payload: {} },
] as const;

const serverMessages = [
  { ...envelope, from: null, type: "room.created", payload: { room, self: member } },
  { ...envelope, from: null, type: "room.joined", payload: { room, self: member } },
  {
    ...envelope,
    from: null,
    type: "room.snapshot",
    payload: { room, members: [member], players: [player], markers: [marker], routes: [route], serverTime: NOW },
  },
  { ...envelope, from: null, type: "room.member_joined", payload: { member } },
  { ...envelope, from: null, type: "room.member_left", payload: { memberId: USER, reason: "timeout" } },
  { ...envelope, from: null, type: "map.changed", payload: { mapId: "woods", changedBy: USER } },
  {
    ...envelope,
    from: null,
    type: "player.updated",
    payload: { memberId: USER, position, rotation: 66.63, mapId: "customs", source: "screenshot", capturedAt: NOW },
  },
  { ...envelope, from: null, type: "marker.created", payload: { marker } },
  { ...envelope, from: null, type: "marker.updated", payload: { markerId: MARKER_ID, patch: { label: "已开" }, updatedBy: USER } },
  { ...envelope, from: null, type: "marker.deleted", payload: { markerId: MARKER_ID, deletedBy: USER } },
  { ...envelope, from: null, type: "route.created", payload: { route } },
  { ...envelope, from: null, type: "route.updated", payload: { routeId: ROUTE_ID, patch: { name: "改道" }, updatedBy: USER } },
  { ...envelope, from: null, type: "route.deleted", payload: { routeId: ROUTE_ID, deletedBy: USER } },
  { ...envelope, from: null, type: "ack", payload: { refId: ULID, ok: true } },
  { ...envelope, from: "server", type: "error", payload: { code: "ROOM_FULL", message: "房间人数已满（5/5）", refId: ULID } },
  { ...envelope, from: null, type: "pong", payload: { serverTime: NOW } },
] as const;

describe("客户端消息", () => {
  it("类型清单与文档一致", () => {
    expect(CLIENT_MESSAGE_TYPES).toHaveLength(13);
    expect(new Set(clientMessages.map((message) => message.type))).toEqual(new Set(CLIENT_MESSAGE_TYPES));
  });

  it("全部 13 种消息都能通过校验", () => {
    for (const message of clientMessages) {
      const result = parseClientMessage(message);
      expect(result.ok, message.type).toBe(true);
      if (!result.ok) continue;
      expect(result.message.type).toBe(message.type);
    }
  });

  it("room.create 允许省略 maxMembers，由服务端决定默认值", () => {
    const result = parseClientMessage(clientMessages[0]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.message.type !== "room.create") return;
    expect(result.message.payload.maxMembers).toBeUndefined();
  });

  it("marker.create 允许省略 color", () => {
    const result = parseClientMessage(clientMessages[5]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.message.type !== "marker.create") return;
    expect(result.message.payload.marker.color).toBeUndefined();
  });
});

describe("服务端消息", () => {
  it("类型清单与文档一致", () => {
    expect(SERVER_MESSAGE_TYPES).toHaveLength(16);
    expect(new Set(serverMessages.map((message) => message.type))).toEqual(new Set(SERVER_MESSAGE_TYPES));
  });

  it("全部 16 种消息都能通过校验", () => {
    for (const message of serverMessages) {
      const result = parseServerMessage(message);
      expect(result.ok, message.type).toBe(true);
      if (!result.ok) continue;
      expect(result.message.type).toBe(message.type);
    }
  });

  it("解析后的对象可以再次通过构造校验（往返一致）", () => {
    for (const message of serverMessages) {
      const parsed = parseServerMessage(message);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(buildServerMessage(parsed.message)).toEqual(parsed.message);
    }
  });
});

describe("非法消息", () => {
  const invalid: { label: string; message: unknown }[] = [
    { label: "协议版本不支持", message: { ...envelope, v: 2, type: "ping", payload: {} } },
    { label: "消息 ID 不是 ULID", message: { ...envelope, id: "msg-1", type: "ping", payload: {} } },
    { label: "时间戳为负", message: { ...envelope, ts: -1, type: "ping", payload: {} } },
    { label: "房间码包含易混字符", message: { ...envelope, roomId: "ABCDEI", type: "ping", payload: {} } },
    { label: "未知消息类型", message: { ...envelope, type: "player.teleport", payload: {} } },
    {
      label: "缺少必填字段 position",
      message: { ...envelope, type: "player.update", payload: { mapId: "customs", source: "screenshot" } },
    },
    {
      label: "位置来源不在枚举内",
      message: { ...envelope, type: "player.update", payload: { position, mapId: "customs", source: "telepathy" } },
    },
    {
      label: "坐标超出合理范围",
      message: {
        ...envelope,
        type: "player.update",
        payload: { position: { x: 20000, y: 0, z: 0 }, mapId: "customs", source: "manual" },
      },
    },
    {
      label: "朝向角等于 360",
      message: {
        ...envelope,
        type: "player.update",
        payload: { position, rotation: 360, mapId: "customs", source: "screenshot" },
      },
    },
    { label: "昵称为空", message: { ...envelope, type: "room.create", payload: { mapId: "customs", displayName: "" } } },
    {
      label: "昵称超长",
      message: { ...envelope, type: "room.create", payload: { mapId: "customs", displayName: "额".repeat(25) } },
    },
    {
      label: "房间人数上限越界",
      message: { ...envelope, type: "room.create", payload: { mapId: "customs", displayName: "阿飞", maxMembers: 99 } },
    },
    {
      label: "地图 ID 含大写字母",
      message: { ...envelope, type: "map.change", payload: { mapId: "Customs" } },
    },
    { label: "标记补丁为空对象", message: { ...envelope, type: "marker.update", payload: { markerId: MARKER_ID, patch: {} } } },
    {
      label: "标记标签超长",
      message: {
        ...envelope,
        type: "marker.create",
        payload: { marker: { id: MARKER_ID, mapId: "customs", kind: "loot", position, label: "字".repeat(65) } },
      },
    },
    {
      label: "路线只有 1 个点",
      message: {
        ...envelope,
        type: "route.create",
        payload: { route: { id: ROUTE_ID, mapId: "customs", name: "路线", points: [position], color: "#35c46a" } },
      },
    },
    { label: "载荷不是对象", message: { ...envelope, type: "ping", payload: "ping" } },
    { label: "缺少信封字段", message: { type: "ping", payload: {} } },
  ];

  it.each(invalid)("$label 被拒绝", ({ message }) => {
    const result = parseClientMessage(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("错误码不在枚举内时被拒绝", () => {
    const result = parseServerMessage({
      ...envelope,
      from: "server",
      type: "error",
      payload: { code: "TOO_MUCH_LAZER", message: "非法错误码" },
    });

    expect(result.ok).toBe(false);
  });
});

describe("向前兼容", () => {
  it("未知字段被忽略而不是报错", () => {
    const result = parseClientMessage({
      ...envelope,
      futureField: "来自新版本的字段",
      type: "ping",
      payload: { futurePayloadField: 123 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("futureField" in result.message).toBe(false);
    expect("futurePayloadField" in result.message.payload).toBe(false);
  });
});
