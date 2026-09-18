import {
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
  type ServerMessageBody,
  createAckPayload,
  createServerMessage,
} from "@tarkov-map-share/shared";

import type { Connection } from "../gateway/connection";
import { type RoomStore, toProtocolMember } from "../rooms/room-store";

export type HandlerContext = {
  store: RoomStore;
  connection: Connection;
  now: number;
  createMessageId: () => string;
  send: (message: ServerMessage) => void;
  broadcast: (roomId: string, message: ServerMessage, excludeUserId?: string) => void;
};

/** 需要先加入房间才能处理的消息 */
export type InRoomMessage = Exclude<
  ClientMessage,
  { type: "room.create" } | { type: "room.join" } | { type: "ping" }
>;

const JOIN_ERROR_TEXT: Record<string, string> = {
  ROOM_NOT_FOUND: "房间不存在或已关闭",
  ROOM_FULL: "房间人数已满",
  ALREADY_IN_ROOM: "已经在该房间中",
  PASSCODE_REQUIRED: "该房间需要口令",
  PASSCODE_INVALID: "房间口令不正确",
};

/** 统一的出站消息构造：自动补齐信封、默认使用当前房间 */
class ServerMessenger {
  readonly #context: HandlerContext;
  readonly #refId: string;

  constructor(context: HandlerContext, refId: string) {
    this.#context = context;
    this.#refId = refId;
  }

  build(body: ServerMessageBody, roomId: string | null = this.#context.connection.roomId): ServerMessage {
    return createServerMessage(body, {
      id: this.#context.createMessageId(),
      ts: this.#context.now,
      roomId,
    });
  }

  reply(body: ServerMessageBody, roomId: string | null = this.#context.connection.roomId): void {
    this.#context.send(this.build(body, roomId));
  }

  fail(code: ErrorCode, text: string): void {
    this.reply({ type: "error", payload: { code, message: text, refId: this.#refId } });
  }

  ack(): void {
    this.reply({ type: "ack", payload: createAckPayload(this.#refId) });
  }
}

/**
 * 处理一条已经通过校验的客户端消息。
 *
 * 约定（详见 docs/WEBSOCKET_PROTOCOL.md）：
 * - 变更类消息成功时给发送方回 `ack`
 * - `player.updated` / `marker.*` / `route.*` 只广播给**其他**成员
 * - `map.changed` 广播给包括发送方在内的所有成员
 */
export function handleClientMessage(context: HandlerContext, message: ClientMessage): void {
  const messenger = new ServerMessenger(context, message.id);

  if (message.type === "room.create" || message.type === "room.join" || message.type === "ping") {
    handleSessionMessage(context, messenger, message);
    return;
  }

  const roomId = context.connection.roomId;
  if (roomId === null) {
    messenger.fail("NOT_IN_ROOM", "尚未加入房间");
    return;
  }

  handleRoomMessage(context, messenger, message, roomId);
}

function handleSessionMessage(
  context: HandlerContext,
  messenger: ServerMessenger,
  message: Extract<ClientMessage, { type: "room.create" | "room.join" | "ping" }>,
): void {
  const { store, connection } = context;

  switch (message.type) {
    case "room.create": {
      if (connection.roomId !== null) {
        messenger.fail("ALREADY_IN_ROOM", "已经在房间中，请先离开");
        return;
      }

      const created = store.createRoom({
        ownerId: connection.userId,
        displayName: message.payload.displayName,
        mapId: message.payload.mapId,
        ...(message.payload.maxMembers === undefined ? {} : { maxMembers: message.payload.maxMembers }),
        ...(message.payload.passcode === undefined ? {} : { passcode: message.payload.passcode }),
      });

      connection.roomId = created.room.id;
      connection.displayName = message.payload.displayName;

      messenger.reply(
        {
          type: "room.created",
          payload: { room: created.room, self: toProtocolMember(created.room.id, created.self) },
        },
        created.room.id,
      );
      return;
    }

    case "room.join": {
      if (connection.roomId !== null) {
        messenger.fail("ALREADY_IN_ROOM", "已经在房间中，请先离开");
        return;
      }

      const result = store.joinRoom({
        roomId: message.payload.roomId,
        userId: connection.userId,
        displayName: message.payload.displayName,
        ...(message.payload.passcode === undefined ? {} : { passcode: message.payload.passcode }),
      });

      if (!result.ok) {
        messenger.fail(result.code, JOIN_ERROR_TEXT[result.code] ?? "无法加入房间");
        return;
      }

      connection.roomId = result.room.id;
      connection.displayName = message.payload.displayName;

      const member = toProtocolMember(result.room.id, result.self);
      messenger.reply({ type: "room.joined", payload: { room: result.room, self: member } }, result.room.id);

      const snapshot = store.snapshot(result.room.id);
      if (snapshot !== null) messenger.reply({ type: "room.snapshot", payload: snapshot }, result.room.id);

      context.broadcast(
        result.room.id,
        messenger.build({ type: "room.member_joined", payload: { member } }, result.room.id),
        connection.userId,
      );
      return;
    }

    case "ping": {
      messenger.reply({ type: "pong", payload: { serverTime: context.now } });
      return;
    }

    default: {
      messenger.fail("INTERNAL", "消息类型与处理分支不匹配");
    }
  }
}

function handleRoomMessage(
  context: HandlerContext,
  messenger: ServerMessenger,
  message: InRoomMessage,
  roomId: string,
): void {
  const { store, connection } = context;
  const sender = connection.userId;

  switch (message.type) {
    case "room.leave": {
      const result = store.leaveRoom(roomId, sender);
      connection.roomId = null;

      if (result !== null) {
        context.broadcast(
          roomId,
          messenger.build({ type: "room.member_left", payload: { memberId: sender, reason: "leave" } }, roomId),
        );
      }
      messenger.ack();
      return;
    }

    case "map.change": {
      const updated = store.changeMap(roomId, message.payload.mapId);
      if (updated === null) {
        messenger.fail("ROOM_NOT_FOUND", "房间不存在或已关闭");
        return;
      }

      messenger.ack();
      // 切图对全队生效，发送方也要收到，避免出现"只有我看不到新图"
      context.broadcast(
        roomId,
        messenger.build({ type: "map.changed", payload: { mapId: updated.mapId, changedBy: sender } }, roomId),
      );
      return;
    }

    case "player.update": {
      const member = store.updatePlayer(roomId, sender, {
        position: message.payload.position,
        ...(message.payload.rotation === undefined ? {} : { rotation: message.payload.rotation }),
        mapId: message.payload.mapId,
        source: message.payload.source,
        ...(message.payload.capturedAt === undefined ? {} : { capturedAt: message.payload.capturedAt }),
      });
      if (member === null) {
        messenger.fail("NOT_IN_ROOM", "尚未加入房间");
        return;
      }

      // 位置是高频且可丢弃的数据，不回 ack
      context.broadcast(
        roomId,
        messenger.build(
          {
            type: "player.updated",
            payload: {
              memberId: member.userId,
              position: message.payload.position,
              rotation: member.rotation,
              mapId: member.mapId,
              source: member.source,
              capturedAt: member.positionCapturedAt,
            },
          },
          roomId,
        ),
        sender,
      );
      return;
    }

    case "marker.create": {
      if (store.getMarker(roomId, message.payload.marker.id) !== null) {
        // 幂等：同一个标记 ID 重复提交只回 ack，不重复广播
        messenger.ack();
        return;
      }

      const marker = store.addMarker(roomId, message.payload.marker, sender);
      if (marker === null) {
        messenger.fail("NOT_IN_ROOM", "尚未加入房间");
        return;
      }

      messenger.ack();
      context.broadcast(roomId, messenger.build({ type: "marker.created", payload: { marker } }, roomId), sender);
      return;
    }

    case "marker.update": {
      const marker = store.patchMarker(roomId, message.payload.markerId, message.payload.patch);
      if (marker === null) {
        messenger.fail("BAD_MESSAGE", "标记不存在或已被删除");
        return;
      }

      messenger.ack();
      context.broadcast(
        roomId,
        messenger.build(
          {
            type: "marker.updated",
            payload: { markerId: marker.id, patch: message.payload.patch, updatedBy: sender },
          },
          roomId,
        ),
        sender,
      );
      return;
    }

    case "marker.delete": {
      const marker = store.deleteMarker(roomId, message.payload.markerId);
      if (marker === null) {
        messenger.fail("BAD_MESSAGE", "标记不存在或已被删除");
        return;
      }

      messenger.ack();
      context.broadcast(
        roomId,
        messenger.build({ type: "marker.deleted", payload: { markerId: marker.id, deletedBy: sender } }, roomId),
        sender,
      );
      return;
    }

    case "route.create": {
      const route = store.addRoute(roomId, message.payload.route, sender);
      if (route === null) {
        messenger.fail("NOT_IN_ROOM", "尚未加入房间");
        return;
      }

      messenger.ack();
      context.broadcast(roomId, messenger.build({ type: "route.created", payload: { route } }, roomId), sender);
      return;
    }

    case "route.update": {
      const route = store.patchRoute(roomId, message.payload.routeId, message.payload.patch);
      if (route === null) {
        messenger.fail("BAD_MESSAGE", "路线不存在或已被删除");
        return;
      }

      messenger.ack();
      context.broadcast(
        roomId,
        messenger.build(
          {
            type: "route.updated",
            payload: { routeId: route.id, patch: message.payload.patch, updatedBy: sender },
          },
          roomId,
        ),
        sender,
      );
      return;
    }

    case "route.delete": {
      const route = store.deleteRoute(roomId, message.payload.routeId);
      if (route === null) {
        messenger.fail("BAD_MESSAGE", "路线不存在或已被删除");
        return;
      }

      messenger.ack();
      context.broadcast(
        roomId,
        messenger.build({ type: "route.deleted", payload: { routeId: route.id, deletedBy: sender } }, roomId),
        sender,
      );
      return;
    }

    case "snapshot.request": {
      const snapshot = store.snapshot(roomId);
      if (snapshot === null) {
        messenger.fail("ROOM_NOT_FOUND", "房间不存在或已关闭");
        return;
      }
      messenger.reply({ type: "room.snapshot", payload: snapshot }, roomId);
      return;
    }

    default: {
      messenger.fail("INTERNAL", "消息类型与处理分支不匹配");
    }
  }
}
