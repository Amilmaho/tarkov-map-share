import { z } from "zod";

import {
  ColorSchema,
  DisplayNameSchema,
  HeadingSchema,
  MapIdSchema,
  RoomCodeSchema,
  TimestampSchema,
  UserIdSchema,
  WorldPositionSchema,
} from "./common";

export const MemberRoleSchema = z.enum(["owner", "member"]);

/** 位置来源：截图文件名解析为主，其余为兜底通道 */
export const PlayerSourceSchema = z.enum(["screenshot", "manual", "paste", "log"]);

/** 成员离开房间的原因 */
export const MemberLeaveReasonSchema = z.enum(["leave", "timeout", "kicked"]);

export const RoomSchema = z.object({
  id: RoomCodeSchema,
  ownerId: UserIdSchema,
  mapId: MapIdSchema,
  maxMembers: z.number().int().min(2).max(10),
  hasPasscode: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const RoomMemberSchema = z.object({
  userId: UserIdSchema,
  roomId: RoomCodeSchema,
  role: MemberRoleSchema,
  joinedAt: TimestampSchema,
  online: z.boolean(),
});

export const PlayerStateSchema = z.object({
  id: UserIdSchema,
  displayName: DisplayNameSchema,
  color: ColorSchema,
  mapId: MapIdSchema,
  position: WorldPositionSchema,
  rotation: HeadingSchema,
  source: PlayerSourceSchema,
  online: z.boolean(),
  /** 服务端最后一次收到该成员消息的时间 */
  lastSeenAt: TimestampSchema,
  /**
   * 位置的采集时间（截图按下的时刻或手动打点的时刻）。
   * 队友端的新鲜度提示以此为准，而不是 `lastSeenAt`。
   */
  positionCapturedAt: TimestampSchema.nullable(),
});

export type MemberRole = z.infer<typeof MemberRoleSchema>;
export type PlayerSource = z.infer<typeof PlayerSourceSchema>;
export type MemberLeaveReason = z.infer<typeof MemberLeaveReasonSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type RoomMember = z.infer<typeof RoomMemberSchema>;
export type PlayerState = z.infer<typeof PlayerStateSchema>;
