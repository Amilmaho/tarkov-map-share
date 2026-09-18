import { z } from "zod";

/** 与 docs/WEBSOCKET_PROTOCOL.md 第 6 节一一对应 */
export const ERROR_CODES = [
  "BAD_MESSAGE",
  "PROTOCOL_VERSION",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "PASSCODE_REQUIRED",
  "PASSCODE_INVALID",
  "RATE_LIMITED",
  "FORBIDDEN",
  "ALREADY_IN_ROOM",
  "NOT_IN_ROOM",
  "INTERNAL",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
