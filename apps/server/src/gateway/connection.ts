import { WebSocket } from "ws";

import type { ServerMessage } from "@tarkov-map-share/shared";

import { RateLimiter } from "./rate-limit";

export type Connection = {
  /** 匿名用户 ID，连接建立时分配 */
  userId: string;
  socket: WebSocket;
  roomId: string | null;
  displayName: string | null;
  lastSeenAt: number;
  /** 连接级限流的连续超限次数 */
  violations: number;
  limiter: RateLimiter;
  /** 最近处理过的消息 ID，用于去重 */
  seenMessageIds: Set<string>;
};

export function sendToConnection(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState !== WebSocket.OPEN) return;
  connection.socket.send(JSON.stringify(message));
}
