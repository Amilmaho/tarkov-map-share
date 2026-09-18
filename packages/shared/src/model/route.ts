import { z } from "zod";

import {
  ColorSchema,
  LabelSchema,
  MapIdSchema,
  RoomCodeSchema,
  RouteIdSchema,
  TimestampSchema,
  UserIdSchema,
  WorldPositionSchema,
} from "./common";

export const RoutePointsSchema = z
  .array(WorldPositionSchema)
  .min(2, "路线至少需要 2 个点")
  .max(200, "路线最多 200 个点");

export const RouteSchema = z.object({
  id: RouteIdSchema,
  roomId: RoomCodeSchema,
  mapId: MapIdSchema,
  name: LabelSchema,
  points: RoutePointsSchema,
  color: ColorSchema,
  createdBy: UserIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable(),
});

export const RouteDraftSchema = z.object({
  id: RouteIdSchema,
  mapId: MapIdSchema,
  name: LabelSchema,
  points: RoutePointsSchema,
  color: ColorSchema,
});

export const RoutePatchSchema = z
  .object({
    name: LabelSchema.optional(),
    points: RoutePointsSchema.optional(),
    color: ColorSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "补丁不能为空对象");

export type Route = z.infer<typeof RouteSchema>;
export type RouteDraft = z.infer<typeof RouteDraftSchema>;
export type RoutePatch = z.infer<typeof RoutePatchSchema>;
