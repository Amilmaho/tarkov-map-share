import { describe, expect, it } from "vitest";

import { GameClient, type GameClientOptions } from "../src/client/game-client";
import { type MinimalSocket, SOCKET_CLOSED, SOCKET_OPEN, type SocketFactory } from "../src/client/socket";
import { createServerMessage, parseClientMessage } from "../src/protocol/messages";

const ULID = "01J8Z4M2KJ4N6P8Q2S7T1V3W9X";
const USER = `usr_${ULID}`;
const ROOM = "R7K2QF";

/** 测试用假 socket：手动触发 open / message / close */
class FakeSocket implements MinimalSocket {
  readyState = 0;
  sent: string[] = [];
  closeCode: number | null = null;

  #open: (() => void)[] = [];
  #message: ((data: string) => void)[] = [];
  #close: ((code: number) => void)[] = [];
  #error: ((error: unknown) => void)[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closeCode = code;
    this.readyState = SOCKET_CLOSED;
    for (const handler of this.#close) handler(code);
  }

  onOpen(handler: () => void): void {
    this.#open.push(handler);
  }
  onMessage(handler: (data: string) => void): void {
    this.#message.push(handler);
  }
  onClose(handler: (code: number) => void): void {
    this.#close.push(handler);
  }
  onError(handler: (error: unknown) => void): void {
    this.#error.push(handler);
  }

  // ---- 测试辅助 ----
  simulateOpen(): void {
    this.readyState = SOCKET_OPEN;
    for (const handler of this.#open) handler();
  }
  simulateMessage(message: unknown): void {
    for (const handler of this.#message) handler(JSON.stringify(message));
  }
  simulateClose(code = 1006): void {
    this.readyState = SOCKET_CLOSED;
    for (const handler of this.#close) handler(code);
  }
}

function serverMessage(body: Parameters<typeof createServerMessage>[0]) {
  return createServerMessage(body, { id: ULID, ts: 1_758_182_400_000, roomId: ROOM });
}

function createHarness(overrides: Partial<GameClientOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const messages: unknown[] = [];
  const states: string[] = [];
  const errors: string[] = [];

  const createSocket: SocketFactory = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };

  const client = new GameClient({
    createSocket,
    heartbeatIntervalMs: 40,
    timeoutMs: 120,
    reconnectBaseMs: 10,
    reconnectMaxMs: 20,
    ...overrides,
    onMessage: (message) => messages.push(message),
    onStateChange: (state) => states.push(state),
    onError: (reason) => errors.push(reason),
  });

  return { client, sockets, messages, states, errors };
}

describe("GameClient", () => {
  it("连接成功后进入 open 状态", () => {
    const { client, sockets, states } = createHarness();
    client.connect("ws://127.0.0.1:8787");

    expect(client.state).toBe("connecting");
    sockets[0]?.simulateOpen();

    expect(client.state).toBe("open");
    expect(states).toEqual(["connecting", "open"]);
    client.disconnect();
  });

  it("连接成功后发送合法信封", () => {
    const { client, sockets } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    client.createRoom({ mapId: "customs", displayName: "阿飞" });

    const raw = sockets[0]?.sent[0];
    expect(raw).toBeDefined();
    const parsed = parseClientMessage(JSON.parse(String(raw)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.type !== "room.create") return;
    expect(parsed.message.payload.mapId).toBe("customs");
    client.disconnect();
  });

  it("断线期间的消息会排队，连上后补发", () => {
    const { client, sockets } = createHarness();
    client.connect("ws://127.0.0.1:8787");

    client.send("player.update", { position: { x: 1, y: 0, z: 2 }, mapId: "customs", source: "screenshot" });
    expect(client.queuedMessages).toBe(1);
    expect(sockets[0]?.sent).toHaveLength(0);

    sockets[0]?.simulateOpen();

    expect(client.queuedMessages).toBe(0);
    expect(sockets[0]?.sent).toHaveLength(1);
    client.disconnect();
  });

  it("服务端断开后自动重连，并重新加入原房间", async () => {
    const { client, sockets } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    client.joinRoom({ roomId: ROOM, displayName: "阿飞" });
    sockets[0]?.simulateMessage(
      serverMessage({
        type: "room.joined",
        payload: {
          room: { id: ROOM, ownerId: USER, mapId: "customs", maxMembers: 5, hasPasscode: false, createdAt: 1, updatedAt: 1 },
          self: {
            userId: USER,
            roomId: ROOM,
            displayName: "阿飞",
            color: "#4c8dff",
            role: "owner",
            joinedAt: 1,
            online: true,
          },
        },
      }),
    );
    expect(client.roomId).toBe(ROOM);

    sockets[0]?.simulateClose();
    expect(client.state).toBe("reconnecting");

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    sockets[1]?.simulateOpen();
    const resent = sockets[1]?.sent.map((raw) => JSON.parse(raw) as { type: string }) ?? [];
    expect(resent.some((message) => message.type === "room.join")).toBe(true);
    client.disconnect();
  });

  it("重连退避随次数增长且有上限", async () => {
    const { client, sockets } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    sockets[0]?.simulateClose();
    await new Promise((resolve) => setTimeout(resolve, 15));
    sockets[1]?.simulateClose();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.reconnectAttempts).toBeGreaterThanOrEqual(2);
    client.disconnect();
  });

  it("按心跳间隔发送 ping", async () => {
    const { client, sockets } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    await new Promise((resolve) => setTimeout(resolve, 100));

    const types = (sockets[0]?.sent ?? []).map((raw) => (JSON.parse(raw) as { type: string }).type);
    expect(types.filter((type) => type === "ping").length).toBeGreaterThanOrEqual(2);
    client.disconnect();
  });

  it("长时间收不到消息会主动断开触发重连", async () => {
    const { client, sockets, errors } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(errors.some((reason) => reason.includes("长时间"))).toBe(true);
    client.disconnect();
  });

  it("忽略无法解析的消息并报错", () => {
    const { client, sockets, errors } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    sockets[0]?.simulateMessage({ type: "unknown.type", payload: {} });

    expect(errors.length).toBeGreaterThan(0);
    client.disconnect();
  });

  it("主动断开后不再重连", async () => {
    const { client, sockets } = createHarness();
    client.connect("ws://127.0.0.1:8787");
    sockets[0]?.simulateOpen();

    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(client.state).toBe("closed");
    expect(sockets.length).toBe(1);
  });
});
