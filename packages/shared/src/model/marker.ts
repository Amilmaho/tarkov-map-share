import { z } from "zod";

import {
  ColorSchema,
  LabelSchema,
  MapIdSchema,
  MarkerIdSchema,
  RoomCodeSchema,
  TimestampSchema,
  UserIdSchema,
  WorldPositionSchema,
} from "./common";

export const MarkerKindSchema = z.enum(["loot", "danger", "extract", "quest", "note", "spawn"]);

/** 完整标记：服务端权威状态 */
export const MarkerSchema = z.object({
  id: MarkerIdSchema,
  roomId: RoomCodeSchema,
  mapId: MapIdSchema,
  kind: MarkerKindSchema,
  position: WorldPositionSchema,
  label: LabelSchema,
  color: ColorSchema.nullable(),
  createdBy: UserIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable(),
});

/**
 * 客户端提交的标记：ID 由客户端生成（乐观更新），
 * 房间、创建者与时间戳由服务端补齐。
 */
export const MarkerDraftSchema = z.object({
  id: MarkerIdSchema,
  mapId: MapIdSchema,
  kind: MarkerKindSchema,
  position: WorldPositionSchema,
  label: LabelSchema,
  color: ColorSchema.nullable().optional(),
});

/** 标记补丁：至少包含一个字段，未列出的字段保持原值 */
export const MarkerPatchSchema = z
  .object({
    kind: MarkerKindSchema.optional(),
    position: WorldPositionSchema.optional(),
    label: LabelSchema.optional(),
    color: ColorSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "补丁不能为空对象");

export type MarkerKind = z.infer<typeof MarkerKindSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type MarkerDraft = z.infer<typeof MarkerDraftSchema>;
export type MarkerPatch = z.infer<typeof MarkerPatchSchema>;
