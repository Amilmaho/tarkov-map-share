/**
 * 用真实的 GameClient + 真实服务端跑 Phase 4 的验收标准：
 * 1. 两个客户端在同一房间，A 的标记在 300ms 内出现在 B 那里
 * 2. 断线后自动重连，状态由快照追平
 * 3. 并发修改同一标记不产生重复数据
 */

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  type GameClientOptions,
  GameClient,
  type MinimalSocket,
  type ServerMessage,
  type SocketFactory,
  createUlid,
} from "@tarkov-map-share/shared";

import { type GameServerHandle, createGameServer } from "../src/create-server";
import { createSilentLogger } from "../src/logger";

const servers: GameServerHandle[] = [];
const clients: GameClient[] = [];

/** 把 ws 的 Node 风格事件适配成客户端要求的回调接口 */
function createWsSocketFactory(sockets: WebSocket[]): SocketFactory {
  return (url: string): MinimalSocket => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    return {
      get readyState() {
        return socket.readyState;
      },
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
      onOpen: (handler) => socket.once("open", () => handler()),
      onMessage: (handler) =>
        socket.on("message", (data: WebSocket.RawData) => handler(data.toString())),
      onClose: (handler) => socket.once("close", (code: number) => handler(code)),
      onError: (handler) => socket.once("error", (error: unknown) => handler(error)),
    };
  };
}

type Harness = {
  client: GameClient;
  sockets: WebSocket[];
  messages: ServerMessage[];
  errors: string[];
};

function createClient(): Harness {
  const sockets: WebSocket[] = [];
  const messages: ServerMessage[] = [];
  const errors: string[] = [];

  const options: GameClientOptions = {
    createSocket: createWsSocketFactory(sockets),
    onMessage: (message) => messages.push(message),
    onError: (reason) => errors.push(reason),
  };
  const client = new GameClient(options);
  clients.push(client);

  return { client, sockets, messages, errors };
}

async function startServer(): Promise<GameServerHandle> {
  const server = await createGameServer({
    host: "127.0.0.1",
    port: 0,
    logger: createSilentLogger(),
    heartbeatSweepMs: 60_000,
  });
  servers.push(server);
  return server;
}

async function waitUntil(check: () => boolean, timeoutMs = 3_000, label = "条件"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待${label}超时（${timeoutMs}ms）`);
}

function lastMessage<T extends ServerMessage["type"]>(
  messages: ServerMessage[],
  type: T,
): Extract<ServerMessage, { type: T }> | undefined {
  return messages.filter((message): message is Extract<ServerMessage, { type: T }> => message.type === type).at(-1);
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

describe("Phase 4 验收：客户端 ↔ 服务端", () => {
  it("两个客户端在同一房间时，标记同步在 300ms 内到达", async () => {
    const server = await startServer();
    const url = `ws://127.0.0.1:${server.port}`;

    const alice = createClient();
    alice.client.connect(url);
    await waitUntil(() => alice.client.state === "open", 2_000, "A 连接");

    alice.client.createRoom({ mapId: "customs", displayName: "阿飞" });
    await waitUntil(() => alice.client.roomId !== null, 2_000, "建房");
    const roomId = alice.client.roomId;
    if (roomId === null) throw new Error("建房失败");

    const bob = createClient();
    bob.client.connect(url);
    await waitUntil(() => bob.client.state === "open", 2_000, "B 连接");
    bob.client.joinRoom({ roomId, displayName: "老李" });
    await waitUntil(() => bob.client.roomId === roomId, 2_000, "B 加入");
    await waitUntil(() => bob.messages.some((message) => message.type === "room.snapshot"), 2_000, "B 快照");

    const markerId = `mk_${createUlid()}`;
    const startedAt = Date.now();
    alice.client.send("marker.create", {
      marker: {
        id: markerId,
        mapId: "customs",
        kind: "danger",
        position: { x: 480.65, y: 4.11, z: -81.34 },
        label: "敌情",
      },
    });

    await waitUntil(
      () => bob.messages.some((message) => message.type === "marker.created"),
      2_000,
      "B 收到标记",
    );
    const elapsed = Date.now() - startedAt;

    const created = lastMessage(bob.messages, "marker.created");
    expect(created?.payload.marker.id).toBe(markerId);
    expect(elapsed).toBeLessThan(300);
  });

  it("断线后自动重连，并用快照追平状态", async () => {
    const server = await startServer();
    const url = `ws://127.0.0.1:${server.port}`;

    const alice = createClient();
    alice.client.connect(url);
    await waitUntil(() => alice.client.state === "open", 2_000, "A 连接");
    alice.client.createRoom({ mapId: "customs", displayName: "阿飞" });
    await waitUntil(() => alice.client.roomId !== null, 2_000, "建房");
    const roomId = alice.client.roomId;
    if (roomId === null) throw new Error("建房失败");

    const bob = createClient();
    bob.client.connect(url);
    await waitUntil(() => bob.client.state === "open", 2_000, "B 连接");
    bob.client.joinRoom({ roomId, displayName: "老李" });
    await waitUntil(() => bob.client.hasSnapshot, 2_000, "B 快照");

    // 模拟网络中断：直接切断底层连接，客户端应当自动重连并重新入房
    const socketCountBefore = bob.sockets.length;
    bob.sockets.at(-1)?.terminate();

    await waitUntil(() => bob.client.state === "reconnecting", 2_000, "进入重连");
    await waitUntil(() => bob.sockets.length > socketCountBefore, 3_000, "重新建立连接");
    await waitUntil(() => bob.client.state === "open", 3_000, "重连成功");
    await waitUntil(() => bob.client.roomId === roomId, 3_000, "自动回房");

    // 重连后服务端会补一份快照
    const snapshots = bob.messages.filter((message) => message.type === "room.snapshot");
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(bob.client.queuedMessages).toBe(0);
  });

  it("并发修改同一标记时只保留一份，且以最后写入为准", async () => {
    const server = await startServer();
    const url = `ws://127.0.0.1:${server.port}`;

    const alice = createClient();
    alice.client.connect(url);
    await waitUntil(() => alice.client.state === "open", 2_000, "A 连接");
    alice.client.createRoom({ mapId: "customs", displayName: "阿飞" });
    await waitUntil(() => alice.client.roomId !== null, 2_000, "建房");
    const roomId = alice.client.roomId;
    if (roomId === null) throw new Error("建房失败");

    const bob = createClient();
    bob.client.connect(url);
    await waitUntil(() => bob.client.state === "open", 2_000, "B 连接");
    bob.client.joinRoom({ roomId, displayName: "老李" });
    await waitUntil(() => bob.client.hasSnapshot, 2_000, "B 快照");

    const markerId = `mk_${createUlid()}`;
    alice.client.send("marker.create", {
      marker: {
        id: markerId,
        mapId: "customs",
        kind: "loot",
        position: { x: 480.65, y: 4.11, z: -81.34 },
        label: "保险箱",
      },
    });
    await waitUntil(() => bob.messages.some((message) => message.type === "marker.created"), 2_000, "B 收到标记");

    // 两边几乎同时改同一个标记
    alice.client.send("marker.update", { markerId, patch: { label: "阿飞改的" } });
    bob.client.send("marker.update", { markerId, patch: { label: "老李改的" } });

    await waitUntil(
      () => alice.messages.some((message) => message.type === "marker.updated"),
      2_000,
      "A 收到广播",
    );

    alice.client.send("snapshot.request", {});
    await waitUntil(
      // A 是建房方，只会因为主动请求才收到快照，所以第一份就够了
      () => alice.messages.some((message) => message.type === "room.snapshot"),
      2_000,
      "A 拿到新快照",
    );

    const snapshot = lastMessage(alice.messages, "room.snapshot");
    const sameId = snapshot?.payload.markers.filter((marker) => marker.id === markerId) ?? [];
    expect(sameId).toHaveLength(1);
    expect(["阿飞改的", "老李改的"]).toContain(sameId[0]?.label);
  });

  it("标记删除后不会在队友那边复活", async () => {
    const server = await startServer();
    const url = `ws://127.0.0.1:${server.port}`;

    const alice = createClient();
    alice.client.connect(url);
    await waitUntil(() => alice.client.state === "open", 2_000, "A 连接");
    alice.client.createRoom({ mapId: "customs", displayName: "阿飞" });
    await waitUntil(() => alice.client.roomId !== null, 2_000, "建房");
    const roomId = alice.client.roomId;
    if (roomId === null) throw new Error("建房失败");

    const bob = createClient();
    bob.client.connect(url);
    await waitUntil(() => bob.client.state === "open", 2_000, "B 连接");
    bob.client.joinRoom({ roomId, displayName: "老李" });
    await waitUntil(() => bob.client.hasSnapshot, 2_000, "B 快照");

    const markerId = `mk_${createUlid()}`;
    alice.client.send("marker.create", {
      marker: {
        id: markerId,
        mapId: "customs",
        kind: "note",
        position: { x: 100, y: 0, z: 100 },
        label: "集合点",
      },
    });
    await waitUntil(() => bob.messages.some((message) => message.type === "marker.created"), 2_000, "B 收到标记");

    alice.client.send("marker.delete", { markerId });
    await waitUntil(() => bob.messages.some((message) => message.type === "marker.deleted"), 2_000, "B 收到删除");

    bob.client.send("snapshot.request", {});
    await waitUntil(
      () => bob.messages.filter((message) => message.type === "room.snapshot").length >= 2,
      2_000,
      "B 拿到新快照",
    );

    const snapshot = lastMessage(bob.messages, "room.snapshot");
    expect(snapshot?.payload.markers.some((marker) => marker.id === markerId)).toBe(false);
  });
});
