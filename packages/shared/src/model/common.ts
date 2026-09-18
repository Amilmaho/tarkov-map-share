import { z } from "zod";

/** 地图 ID：小写字母、数字与连字符，例如 `customs` */
export const MAP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** 房间码：6 位大写字母/数字，已排除易混的 I、O、0、1 */
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
/** 颜色：`#RRGGBB` */
export const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
/** ULID（Crockford Base32，26 位） */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const MapIdSchema = z
  .string()
  .regex(MAP_ID_PATTERN, "地图 ID 只能包含小写字母、数字与连字符");

export const RoomCodeSchema = z
  .string()
  .regex(ROOM_CODE_PATTERN, "房间码为 6 位大写字母或数字，且不含 I、O、0、1");

export const ColorSchema = z.string().regex(COLOR_PATTERN, "颜色格式应为 #RRGGBB");

export const UserIdSchema = z.string().regex(new RegExp(`^usr_${ULID_PATTERN.source.slice(1, -1)}$`), "用户 ID 形如 usr_<ULID>");
export const MarkerIdSchema = z.string().regex(new RegExp(`^mk_${ULID_PATTERN.source.slice(1, -1)}$`), "标记 ID 形如 mk_<ULID>");
export const RouteIdSchema = z.string().regex(new RegExp(`^rt_${ULID_PATTERN.source.slice(1, -1)}$`), "路线 ID 形如 rt_<ULID>");
export const MessageIdSchema = z.string().regex(ULID_PATTERN, "消息 ID 应为 ULID");

/** 毫秒时间戳，不允许负数 */
export const TimestampSchema = z.number().int().nonnegative();

/** 世界坐标：单位米，`y` 为高度 */
export const WorldPositionSchema = z.object({
  x: z.number().finite().min(-10000).max(10000),
  y: z.number().finite().min(-1000).max(1000),
  z: z.number().finite().min(-10000).max(10000),
});

/** 朝向角：0 = 正北（+Z），顺时针为正 */
export const HeadingSchema = z.number().finite().min(0).lt(360);

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "昵称不能为空")
  .max(24, "昵称最长 24 个字符")
  .refine((value) => !CONTROL_CHARACTERS.test(value), "昵称不能包含控制字符");

/** 标记与路线的纯文本标签，渲染时不做任何富文本解析 */
export const LabelSchema = z
  .string()
  .trim()
  .min(1, "标签不能为空")
  .max(64, "标签最长 64 个字符")
  .refine((value) => !CONTROL_CHARACTERS.test(value), "标签不能包含控制字符");

export const PasscodeSchema = z.string().min(4, "口令至少 4 位").max(32, "口令最长 32 位");

export type WorldPosition = z.infer<typeof WorldPositionSchema>;
export type MapId = z.infer<typeof MapIdSchema>;
export type RoomCode = z.infer<typeof RoomCodeSchema>;
export type UserId = z.infer<typeof UserIdSchema>;
export type MarkerId = z.infer<typeof MarkerIdSchema>;
export type RouteId = z.infer<typeof RouteIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
