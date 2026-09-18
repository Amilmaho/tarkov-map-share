/**
 * 服务端的库入口（供桌面端在主进程内嵌入使用）。
 *
 * 注意不要从 `src/index.ts` 导入：那是 CLI 入口，导入即启动。
 */

export { createGameServer } from "./create-server";
export type { GameServerHandle, GameServerOptions } from "./create-server";
export { DEFAULT_HOST, DEFAULT_PORT, LOOPBACK_HOST, MEMBER_COLORS } from "./config";
export { createLogger, createSilentLogger } from "./logger";
export type { LogLevel, LogMeta, Logger } from "./logger";
export { formatInvite, listLanAddresses } from "./network";
export type { LanAddress } from "./network";
export { RoomStore } from "./rooms/room-store";
export type {
  CreateRoomInput,
  JoinRoomErrorCode,
  JoinRoomResult,
  MemberState,
  PlayerUpdateInput,
  RoomSnapshot,
  RoomState,
  RoomStoreOptions,
} from "./rooms/room-store";
