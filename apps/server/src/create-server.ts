/**
 * 可嵌入的实时服务端。
 *
 * 关键约束（ADR-0013）：服务端核心必须是**库**，桌面端可以在自己的进程里直接启动它，
 * 而不需要 spawn 一个 node 子进程（Electron 打包后没有独立 node 可执行文件）。
 * CLI（src/index.ts）只是这一层之上的薄壳。
 */

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocketServer, WebSocket, type RawData } from "ws";

import {
  type ErrorCode,
  type ServerMessage,
  type ServerMessageBody,
  createServerMessage,
  createUlid,
  parseClientMessage,
  PROTOCOL_VERSION,
} from "@tarkov-map-share/shared";

import {
  CLIENT_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  HEARTBEAT_SWEEP_MS,
  MAX_MESSAGE_BYTES,
  MAX_TRACKED_MESSAGE_IDS,
  PORT_ATTEMPTS,
} from "./config";
import { type Connection, sendToConnection } from "./gateway/connection";
import {
  CONNECTION_LIMIT_KEY,
  CONNECTION_RATE_LIMIT,
  MAX_CONSECUTIVE_VIOLATIONS,
  RATE_LIMITS,
  RateLimiter,
  SILENT_DROP_TYPES,
} from "./gateway/rate-limit";
import { handleClientMessage } from "./handlers/handle-client-message";
import { type Logger, createLogger } from "./logger";
import { RoomStore } from "./rooms/room-store";

/** 变更类消息：重复 ID 时补一个 ack，避免客户端重试后一直等 */
const MUTATION_TYPES: ReadonlySet<string> = new Set([
  "room.leave",
  "marker.create",
  "marker.update",
  "marker.delete",
  "route.create",
  "route.update",
  "route.delete",
]);

export type GameServerOptions = {
  host?: string;
  /** 传 0 由系统分配随机端口（测试常用）；被占用时自动向后尝试 */
  port?: number;
  logger?: Logger;
  now?: () => number;
  heartbeatSweepMs?: number;
  clientTimeoutMs?: number;
  portAttempts?: number;
  maxMessageBytes?: number;
  colors?: readonly string[];
};

export type GameServerHandle = {
  host: string;
  port: number;
  /** 给本机客户端用的连接地址 */
  url: string;
  store: RoomStore;
  connectionCount: () => number;
  broadcast: (roomId: string, message: ServerMessage, excludeUserId?: string) => void;
  /** 手动触发一次空闲连接扫描（测试用，定时器也会调用） */
  sweepIdleConnections: () => void;
  close: () => Promise<void>;
};

function toText(data: RawData): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return null;
}

function byteLengthOf(data: RawData): number {
  if (typeof data === "string") return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  return 0;
}

function isAddressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "EADDRINUSE";
}

async function closeQuietly(server: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function listenWithRetry(options: {
  host: string;
  startPort: number;
  attempts: number;
  maxMessageBytes: number;
  logger: Logger;
}): Promise<{ wss: WebSocketServer; port: number }> {
  const { host, startPort, attempts, logger } = options;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const requestedPort = startPort === 0 ? 0 : startPort + attempt;
    const wss = new WebSocketServer({ host, port: requestedPort, maxPayload: options.maxMessageBytes });

    try {
      await once(wss, "listening");
      const address = wss.address();
      const boundPort = typeof address === "object" && address !== null ? (address as AddressInfo).port : requestedPort;
      return { wss, port: boundPort };
    } catch (error) {
      lastError = error;
      await closeQuietly(wss);
      if (!isAddressInUse(error)) throw error;
      logger.warn("端口已被占用，尝试下一个端口", { port: requestedPort });
    }
  }

  throw new Error(`连续 ${attempts} 个端口都被占用（起始端口 ${startPort}）: ${String(lastError)}`);
}

export async function createGameServer(options: GameServerOptions = {}): Promise<GameServerHandle> {
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => Date.now());
  const clientTimeoutMs = options.clientTimeoutMs ?? CLIENT_TIMEOUT_MS;
  const sweepMs = options.heartbeatSweepMs ?? HEARTBEAT_SWEEP_MS;
  const host = options.host ?? DEFAULT_HOST;
  const startPort = options.port ?? DEFAULT_PORT;
  const attempts = options.portAttempts ?? PORT_ATTEMPTS;
  const maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;

  const store = new RoomStore({
    now,
    ...(options.colors === undefined ? {} : { colors: options.colors }),
  });

  const { wss, port } = await listenWithRetry({
    host,
    startPort,
    attempts,
    maxMessageBytes: options.maxMessageBytes ?? MAX_MESSAGE_BYTES,
    logger,
  });

  const connections = new Map<WebSocket, Connection>();

  /** 连接级规则与各类消息规则合并，供每个连接独立的限流器使用 */
  const limiterRules = { ...RATE_LIMITS, [CONNECTION_LIMIT_KEY]: CONNECTION_RATE_LIMIT };

  const makeMessage = (
    body: ServerMessageBody,
    roomId: string | null,
  ): ServerMessage => createServerMessage(body, { id: createUlid(now()), ts: now(), roomId });

  const broadcast = (roomId: string, message: ServerMessage, excludeUserId?: string): void => {
    for (const connection of connections.values()) {
      if (connection.roomId !== roomId) continue;
      if (excludeUserId !== undefined && connection.userId === excludeUserId) continue;
      sendToConnection(connection, message);
    }
  };

  const sendError = (connection: Connection, code: ErrorCode, text: string, refId?: string): void => {
    sendToConnection(
      connection,
      makeMessage(
        { type: "error", payload: { code, message: text, ...(refId === undefined ? {} : { refId }) } },
        connection.roomId,
      ),
    );
  };

  const rememberMessageId = (connection: Connection, messageId: string): void => {
    connection.seenMessageIds.add(messageId);
    if (connection.seenMessageIds.size <= MAX_TRACKED_MESSAGE_IDS) return;
    const oldest = connection.seenMessageIds.values().next().value;
    if (typeof oldest === "string") connection.seenMessageIds.delete(oldest);
  };

  const handleRawMessage = (connection: Connection, data: RawData): void => {
    const receivedAt = now();
    connection.lastSeenAt = receivedAt;

    // 连接级总量限制：连续超限 3 次直接断开
    const total = connection.limiter.check(CONNECTION_LIMIT_KEY, receivedAt);
    if (!total.allowed) {
      connection.violations += 1;
      if (connection.violations >= MAX_CONSECUTIVE_VIOLATIONS) {
        logger.warn("连接因持续超限被断开", { userId: connection.userId });
        connection.socket.close(1008, "rate limit exceeded");
        return;
      }
    } else {
      connection.violations = 0;
    }

    if (byteLengthOf(data) > maxMessageBytes) {
      sendError(connection, "BAD_MESSAGE", "消息体积超过上限");
      return;
    }

    const text = toText(data);
    if (text === null) {
      sendError(connection, "BAD_MESSAGE", "无法解析的消息载荷");
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      sendError(connection, "BAD_MESSAGE", "消息不是合法 JSON");
      return;
    }

    // 版本先于 Schema 校验，才能返回明确的 PROTOCOL_VERSION 而不是笼统的 BAD_MESSAGE
    const rawVersion =
      typeof parsedJson === "object" && parsedJson !== null && "v" in parsedJson
        ? (parsedJson as { v?: unknown }).v
        : undefined;
    if (rawVersion !== PROTOCOL_VERSION) {
      const rawId =
        typeof parsedJson === "object" && parsedJson !== null && "id" in parsedJson
          ? (parsedJson as { id?: unknown }).id
          : undefined;
      sendError(
        connection,
        "PROTOCOL_VERSION",
        `协议版本不匹配（服务端为 v${PROTOCOL_VERSION}），请升级客户端`,
        typeof rawId === "string" ? rawId : undefined,
      );
      return;
    }

    const parsed = parseClientMessage(parsedJson);
    if (!parsed.ok) {
      logger.debug("消息校验失败", { userId: connection.userId, issues: parsed.issues });
      sendError(connection, "BAD_MESSAGE", `消息校验失败：${parsed.issues[0] ?? "格式错误"}`);
      return;
    }

    const message = parsed.message;
    const limit = connection.limiter.check(message.type, receivedAt);
    if (!limit.allowed) {
      if (SILENT_DROP_TYPES.has(message.type)) return;
      sendToConnection(
        connection,
        makeMessage(
          {
            type: "error",
            payload: {
              code: "RATE_LIMITED",
              message: "操作过于频繁，请稍后再试",
              refId: message.id,
              details: { retryAfterMs: limit.retryAfterMs },
            },
          },
          connection.roomId,
        ),
      );
      return;
    }

    if (connection.seenMessageIds.has(message.id)) {
      if (MUTATION_TYPES.has(message.type)) {
        sendToConnection(
          connection,
          makeMessage({ type: "ack", payload: { refId: message.id, ok: true } }, connection.roomId),
        );
      }
      return;
    }
    rememberMessageId(connection, message.id);

    if (connection.roomId !== null) store.touchMember(connection.roomId, connection.userId);

    handleClientMessage(
      {
        store,
        connection,
        now: receivedAt,
        createMessageId: () => createUlid(now()),
        send: (message_) => sendToConnection(connection, message_),
        broadcast,
      },
      message,
    );
  };

  const handleConnectionClosed = (connection: Connection): void => {
    connections.delete(connection.socket);

    const roomId = connection.roomId;
    if (roomId === null) return;

    const result = store.leaveRoom(roomId, connection.userId);
    if (result === null) return;

    // 非主动离开（room.leave）的断开统一按 timeout 通知队友
    broadcast(
      roomId,
      makeMessage({ type: "room.member_left", payload: { memberId: connection.userId, reason: "timeout" } }, roomId),
    );
    logger.info("成员断开连接", {
      userId: connection.userId,
      roomId,
      roomEmpty: result.roomEmpty,
    });
  };

  wss.on("connection", (socket, request) => {
    const connection: Connection = {
      userId: `usr_${createUlid(now())}`,
      socket,
      roomId: null,
      displayName: null,
      lastSeenAt: now(),
      violations: 0,
      limiter: new RateLimiter(limiterRules),
      seenMessageIds: new Set<string>(),
    };
    connections.set(socket, connection);

    logger.debug("客户端已连接", { userId: connection.userId, address: request.socket.remoteAddress });

    socket.on("message", (data) => handleRawMessage(connection, data));
    socket.on("close", () => handleConnectionClosed(connection));
    socket.on("error", (error: Error) => logger.warn("连接出错", { userId: connection.userId, reason: error.message }));
  });

  const sweepIdleConnections = (): void => {
    const current = now();
    for (const connection of connections.values()) {
      if (current - connection.lastSeenAt <= clientTimeoutMs) continue;
      logger.warn("连接超时，主动断开", { userId: connection.userId, idleMs: current - connection.lastSeenAt });
      connection.socket.close(1001, "timeout");
    }
  };

  const sweepTimer = setInterval(sweepIdleConnections, sweepMs);
  sweepTimer.unref?.();

  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

  return {
    host,
    port,
    url: `ws://${displayHost}:${port}`,
    store,
    connectionCount: () => connections.size,
    broadcast,
    sweepIdleConnections,
    close: async () => {
      clearInterval(sweepTimer);
      for (const connection of connections.values()) {
        connection.socket.close(1001, "server closing");
      }
      await closeQuietly(wss);
      connections.clear();
      logger.info("服务端已关闭", { port });
    },
  };
}
