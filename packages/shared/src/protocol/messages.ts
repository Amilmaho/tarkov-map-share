import { z } from "zod";

import {
  DisplayNameSchema,
  HeadingSchema,
  MapIdSchema,
  MarkerDraftSchema,
  MarkerIdSchema,
  MarkerPatchSchema,
  MarkerSchema,
  MessageIdSchema,
  MemberLeaveReasonSchema,
  PasscodeSchema,
  PlayerSourceSchema,
  RoomCodeSchema,
  RoomMemberSchema,
  RoomSchema,
  RouteDraftSchema,
  RouteIdSchema,
  RoutePatchSchema,
  RouteSchema,
  TimestampSchema,
  UserIdSchema,
  WorldPositionSchema,
} from "../model";
import { ErrorCodeSchema } from "./errors";
import { PROTOCOL_VERSION } from "./version";

export const CLIENT_MESSAGE_TYPES = [
  "room.create",
  "room.join",
  "room.leave",
  "map.change",
  "player.update",
  "marker.create",
  "marker.update",
  "marker.delete",
  "route.create",
  "route.update",
  "route.delete",
  "snapshot.request",
  "ping",
] as const;

export const SERVER_MESSAGE_TYPES = [
  "room.created",
  "room.joined",
  "room.snapshot",
  "room.member_joined",
  "room.member_left",
  "map.changed",
  "player.updated",
  "marker.created",
  "marker.updated",
  "marker.deleted",
  "route.created",
  "route.updated",
  "route.deleted",
  "ack",
  "error",
  "pong",
] as const;

/** 空载荷（`room.leave` / `snapshot.request` / `ping`） */
const EmptyPayloadSchema = z.object({});

/* ------------------------------------------------------------------ *
 * 客户端 → 服务端
 * ------------------------------------------------------------------ */

export const RoomCreatePayloadSchema = z.object({
  mapId: MapIdSchema,
  displayName: DisplayNameSchema,
  maxMembers: z.number().int().min(2).max(10).default(5),
});

export const RoomJoinPayloadSchema = z.object({
  roomId: RoomCodeSchema,
  displayName: DisplayNameSchema,
  passcode: PasscodeSchema.optional(),
});

export const MapChangePayloadSchema = z.object({
  mapId: MapIdSchema,
});

export const PlayerUpdatePayloadSchema = z.object({
  position: WorldPositionSchema,
  rotation: HeadingSchema.optional(),
  mapId: MapIdSchema,
  source: PlayerSourceSchema,
  /** 位置采集时刻（截图按下的时间）。缺省时由服务端按接收时间处理 */
  capturedAt: TimestampSchema.optional(),
});

export const MarkerCreatePayloadSchema = z.object({ marker: MarkerDraftSchema });
export const MarkerUpdatePayloadSchema = z.object({
  markerId: MarkerIdSchema,
  patch: MarkerPatchSchema,
});
export const MarkerDeletePayloadSchema = z.object({ markerId: MarkerIdSchema });

export const RouteCreatePayloadSchema = z.object({ route: RouteDraftSchema });
export const RouteUpdatePayloadSchema = z.object({
  routeId: RouteIdSchema,
  patch: RoutePatchSchema,
});
export const RouteDeletePayloadSchema = z.object({ routeId: RouteIdSchema });

const envelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
  id: MessageIdSchema,
  ts: TimestampSchema,
  roomId: RoomCodeSchema.nullable(),
  /** 服务端下发的消息用字面量 `"server"` 表示来源 */
  from: z.union([UserIdSchema, z.literal("server")]).nullable(),
} as const;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelopeBase, type: z.literal("room.create"), payload: RoomCreatePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("room.join"), payload: RoomJoinPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("room.leave"), payload: EmptyPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("map.change"), payload: MapChangePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("player.update"), payload: PlayerUpdatePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("marker.create"), payload: MarkerCreatePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("marker.update"), payload: MarkerUpdatePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("marker.delete"), payload: MarkerDeletePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("route.create"), payload: RouteCreatePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("route.update"), payload: RouteUpdatePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("route.delete"), payload: RouteDeletePayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("snapshot.request"), payload: EmptyPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("ping"), payload: EmptyPayloadSchema }),
]);

/* ------------------------------------------------------------------ *
 * 服务端 → 客户端
 * ------------------------------------------------------------------ */

export const RoomCreatedPayloadSchema = z.object({
  room: RoomSchema,
  self: RoomMemberSchema,
});

export const RoomJoinedPayloadSchema = z.object({
  room: RoomSchema,
  self: RoomMemberSchema,
});

export const RoomSnapshotPayloadSchema = z.object({
  room: RoomSchema,
  members: z.array(RoomMemberSchema).max(10),
  markers: z.array(MarkerSchema).max(2000),
  routes: z.array(RouteSchema).max(500),
  serverTime: TimestampSchema,
});

export const RoomMemberJoinedPayloadSchema = z.object({ member: RoomMemberSchema });

export const RoomMemberLeftPayloadSchema = z.object({
  memberId: UserIdSchema,
  reason: MemberLeaveReasonSchema,
});

export const MapChangedPayloadSchema = z.object({
  mapId: MapIdSchema,
  changedBy: UserIdSchema,
});

export const PlayerUpdatedPayloadSchema = z.object({
  memberId: UserIdSchema,
  position: WorldPositionSchema,
  rotation: HeadingSchema,
  mapId: MapIdSchema,
  source: PlayerSourceSchema,
  capturedAt: TimestampSchema.nullable(),
});

export const MarkerCreatedPayloadSchema = z.object({ marker: MarkerSchema });
export const MarkerUpdatedPayloadSchema = z.object({
  markerId: MarkerIdSchema,
  patch: MarkerPatchSchema,
  updatedBy: UserIdSchema,
});
export const MarkerDeletedPayloadSchema = z.object({
  markerId: MarkerIdSchema,
  deletedBy: UserIdSchema,
});

export const RouteCreatedPayloadSchema = z.object({ route: RouteSchema });
export const RouteUpdatedPayloadSchema = z.object({
  routeId: RouteIdSchema,
  patch: RoutePatchSchema,
  updatedBy: UserIdSchema,
});
export const RouteDeletedPayloadSchema = z.object({
  routeId: RouteIdSchema,
  deletedBy: UserIdSchema,
});

export const AckPayloadSchema = z.object({
  refId: MessageIdSchema,
  ok: z.literal(true),
});

export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1).max(200),
  refId: MessageIdSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PongPayloadSchema = z.object({ serverTime: TimestampSchema });

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelopeBase, type: z.literal("room.created"), payload: RoomCreatedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("room.joined"), payload: RoomJoinedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("room.snapshot"), payload: RoomSnapshotPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("room.member_joined"), payload: RoomMemberJoinedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("room.member_left"), payload: RoomMemberLeftPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("map.changed"), payload: MapChangedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("player.updated"), payload: PlayerUpdatedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("marker.created"), payload: MarkerCreatedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("marker.updated"), payload: MarkerUpdatedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("marker.deleted"), payload: MarkerDeletedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("route.created"), payload: RouteCreatedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("route.updated"), payload: RouteUpdatedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("route.deleted"), payload: RouteDeletedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("ack"), payload: AckPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("error"), payload: ErrorPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("pong"), payload: PongPayloadSchema }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];
export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

/**
 * 解析结果：失败时返回可直接写进日志的原因列表。
 *
 * 未知字段被忽略（`.strip()` 语义），以符合协议第 8 节的向前兼容规则：
 * 旧版本收到新版本的多余字段时不应当报错。
 */
export type ParseOutcome<T> = { ok: true; message: T } | { ok: false; issues: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<根对象>";
    return `${path}: ${issue.message}`;
  });
}

export function parseClientMessage(input: unknown): ParseOutcome<ClientMessage> {
  const result = ClientMessageSchema.safeParse(input);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, issues: formatIssues(result.error) };
}

export function parseServerMessage(input: unknown): ParseOutcome<ServerMessage> {
  const result = ServerMessageSchema.safeParse(input);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, issues: formatIssues(result.error) };
}

/** 构造并校验一条客户端消息；校验失败直接抛错（用于发送前的自我保护） */
export function buildClientMessage(message: ClientMessage): ClientMessage {
  return ClientMessageSchema.parse(message);
}

/** 构造并校验一条服务端消息；校验失败直接抛错（避免把坏数据发给客户端） */
export function buildServerMessage(message: ServerMessage): ServerMessage {
  return ServerMessageSchema.parse(message);
}
