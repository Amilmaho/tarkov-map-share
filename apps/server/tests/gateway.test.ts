import { afterEach, describe, expect, it } from "vitest";

import { type ServerMessage, createUlid } from "@tarkov-map-share/shared";

import { type GameServerHandle, type GameServerOptions, createGameServer } from "../src/create-server";
import { createSilentLogger } from "../src/logger";
import { TestClient } from "./helpers/test-client";

const servers: GameServerHandle[] = [];
const clients: TestClient[] = [];

const position = { x: -323.69, y: 2.44, z: -225.63 };
const capturedAt = 1_758_182_400_000;

async function startServer(overrides: GameServerOptions = {}): Promise<GameServerHandle> {
  const server = await createGameServer({
    host: "127.0.0.1",
    port: 0,
    logger: createSilentLogger(),
    ...overrides,
  });
  servers.push(server);
  return server;
}

async function connect(server: GameServerHandle): Promise<TestClient> {
  const client = await TestClient.connect(`ws://127.0.0.1:${server.port}`);
  clients.push(client);
  return client;
}

type RoomOptions = {
  maxMembers?: number;
  passcode?: string;
  guestPasscode?: string;
};

/** 建好一个两人房间：房主 + 老李，并等所有初始消息收完 */
async function setupRoom(options: RoomOptions = {}) {
  const server = await startServer();
  const host = await connect(server);

  host.send("room.create", {
    mapId: "customs",
    displayName: "房主",
    ...(options.maxMembers === undefined ? {} : { maxMembers: options.maxMembers }),
    ...(options.passcode === undefined ? {} : { passcode: options.passcode }),
  });
  const created = await host.waitFor("room.created");
  const roomId = created.payload.room.id;

  const guest = await connect(server);
  guest.send("room.join", {
    roomId,
    displayName: "老李",
    ...(options.guestPasscode === undefined ? {} : { passcode: options.guestPasscode }),
  });
  const joined = await guest.waitFor("room.joined");
  const snapshot = await guest.waitFor("room.snapshot");
  await host.waitFor("room.member_joined");

  return { server, host, guest, roomId, guestId: joined.payload.self.userId, snapshot };
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.close();
});

describe("房间流程", () => {
  it("创建房间返回合法房间码，房主拿到 owner 角色", async () => {
    const server = await startServer();
    const host = await connect(server);

    host.send("room.create", { mapId: "customs", displayName: "房主" });
    const created = await host.waitFor("room.created");

    expect(created.payload.room.id).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.payload.room.mapId).toBe("customs");
    expect(created.payload.room.maxMembers).toBe(5);
    expect(created.payload.self.role).toBe("owner");
    expect(created.payload.self.roomId).toBe(created.payload.room.id);
    expect(host.userId).toBe(created.payload.self.userId);
    expect(host.invalidMessages).toEqual([]);
  });

  it("第二名成员加入后拿到完整快照，房主收到 member_joined", async () => {
    const { host, guest, roomId, guestId, snapshot } = await setupRoom();

    expect(snapshot.payload.room.id).toBe(roomId);
    expect(snapshot.payload.members).toHaveLength(2);
    // 两人都还没上报位置，因此 players 为空
    expect(snapshot.payload.players).toEqual([]);

    const announced = host.received.find(
      (message): message is Extract<ServerMessage, { type: "room.member_joined" }> =>
        message.type === "room.member_joined",
    );
    expect(announced?.payload.member.userId).toBe(guestId);
    expect(guest.roomId).toBe(roomId);
  });

  it("房间不存在时返回 ROOM_NOT_FOUND", async () => {
    const server = await startServer();
    const client = await connect(server);

    client.send("room.join", { roomId: "ZZZZZZ", displayName: "老李" });
    const error = await client.waitFor("error");

    expect(error.payload.code).toBe("ROOM_NOT_FOUND");
  });

  it("房间满员时返回 ROOM_FULL，且连接仍可继续使用", async () => {
    const { server, roomId } = await setupRoom({ maxMembers: 2 });
    const third = await connect(server);

    third.send("room.join", { roomId, displayName: "阿飞" });
    const error = await third.waitFor("error");
    expect(error.payload.code).toBe("ROOM_FULL");

    third.send("ping", {});
    expect((await third.waitFor("pong")).type).toBe("pong");
    expect(third.isOpen).toBe(true);
  });

  it("带口令的房间分别返回 PASSCODE_REQUIRED / PASSCODE_INVALID 后才允许加入", async () => {
    const server = await startServer();
    const host = await connect(server);
    host.send("room.create", { mapId: "customs", displayName: "房主", passcode: "8848" });
    const created = await host.waitFor("room.created");
    const roomId = created.payload.room.id;
    expect(created.payload.room.hasPasscode).toBe(true);

    const missing = await connect(server);
    missing.send("room.join", { roomId, displayName: "老李" });
    expect((await missing.waitFor("error")).payload.code).toBe("PASSCODE_REQUIRED");

    missing.send("room.join", { roomId, displayName: "老李", passcode: "0000" });
    expect((await missing.waitFor("error")).payload.code).toBe("PASSCODE_INVALID");

    missing.send("room.join", { roomId, displayName: "老李", passcode: "8848" });
    const joined = await missing.waitFor("room.joined");
    expect(joined.payload.room.id).toBe(roomId);
  });
});

describe("实时同步", () => {
  it("位置更新广播给队友，不回显给发送方", async () => {
    const { host, guest, guestId } = await setupRoom();

    guest.send("player.update", {
      position,
      rotation: 66.63,
      mapId: "customs",
      source: "screenshot",
      capturedAt,
    });

    const updated = await host.waitFor("player.updated");
    expect(updated.payload.memberId).toBe(guestId);
    expect(updated.payload.position).toEqual(position);
    expect(updated.payload.rotation).toBeCloseTo(66.63, 4);
    expect(updated.payload.source).toBe("screenshot");
    expect(updated.payload.capturedAt).toBe(capturedAt);

    await guest.settle();
    expect(guest.countOf("player.updated")).toBe(0);
    expect(guest.countOf("ack")).toBe(0);
  });

  it("标记的创建、修改、删除都会同步给队友", async () => {
    const { host, guest, guestId } = await setupRoom();
    const markerId = `mk_${createUlid()}`;

    guest.send("marker.create", {
      marker: { id: markerId, mapId: "customs", kind: "loot", position, label: "保险箱" },
    });
    const ack = await guest.waitFor("ack");
    expect(ack.payload.ok).toBe(true);

    const created = await host.waitFor("marker.created");
    expect(created.payload.marker.id).toBe(markerId);
    expect(created.payload.marker.createdBy).toBe(guestId);
    expect(created.payload.marker.roomId).toBe(guest.roomId);
    expect(created.payload.marker.deletedAt).toBeNull();
    expect(guest.countOf("marker.created")).toBe(0);

    guest.send("marker.update", { markerId, patch: { label: "已开" } });
    await guest.waitFor("ack");
    const patched = await host.waitFor("marker.updated");
    expect(patched.payload.markerId).toBe(markerId);
    expect(patched.payload.patch).toEqual({ label: "已开" });
    expect(patched.payload.updatedBy).toBe(guestId);

    guest.send("marker.delete", { markerId });
    await guest.waitFor("ack");
    const deleted = await host.waitFor("marker.deleted");
    expect(deleted.payload.markerId).toBe(markerId);
    expect(deleted.payload.deletedBy).toBe(guestId);
  });

  it("路线创建会同步给队友", async () => {
    const { host, guest } = await setupRoom();
    const routeId = `rt_${createUlid()}`;

    guest.send("route.create", {
      route: {
        id: routeId,
        mapId: "customs",
        name: "撤离路线",
        points: [position, { x: 90, y: 1.2, z: -140.5 }],
        color: "#4c8dff",
      },
    });

    await guest.waitFor("ack");
    const created = await host.waitFor("route.created");
    expect(created.payload.route.id).toBe(routeId);
    expect(created.payload.route.points).toHaveLength(2);
  });

  it("切图会广播给包括发起方在内的所有人", async () => {
    const { host, guest } = await setupRoom();

    guest.send("map.change", { mapId: "woods" });

    const forGuest = await guest.waitFor("map.changed");
    const forHost = await host.waitFor("map.changed");
    expect(forGuest.payload.mapId).toBe("woods");
    expect(forHost.payload.mapId).toBe("woods");
    expect(forHost.payload.changedBy).toBe(guest.userId);
  });

  it("快照请求返回成员与已上报位置的玩家", async () => {
    const { host, guest } = await setupRoom();

    guest.send("player.update", { position, mapId: "customs", source: "manual" });
    await host.waitFor("player.updated");

    host.send("snapshot.request", {});
    const snapshot = await host.waitFor("room.snapshot");

    expect(snapshot.payload.members).toHaveLength(2);
    expect(snapshot.payload.players).toHaveLength(1);
    expect(snapshot.payload.players[0]?.position).toEqual(position);
  });

  it("重连后可以用快照追平已有标记", async () => {
    const { server, host, guest, roomId } = await setupRoom();
    const markerId = `mk_${createUlid()}`;

    host.send("marker.create", {
      marker: { id: markerId, mapId: "customs", kind: "extract", position, label: "撤离" },
    });
    await host.waitFor("ack");
    await guest.waitFor("marker.created");

    await guest.close();
    await host.waitFor("room.member_left");

    const reconnected = await connect(server);
    reconnected.send("room.join", { roomId, displayName: "老李" });
    const snapshot = await reconnected.waitFor("room.snapshot");

    expect(snapshot.payload.markers.map((marker) => marker.id)).toContain(markerId);
  });
});

describe("离开与断线", () => {
  it("主动离开会以 reason=leave 通知队友", async () => {
    const { host, guest } = await setupRoom();

    guest.send("room.leave", {});
    await guest.waitFor("ack");

    const left = await host.waitFor("room.member_left");
    expect(left.payload.memberId).toBe(guest.userId);
    expect(left.payload.reason).toBe("leave");
  });

  it("连接断开会以 reason=timeout 通知队友并更新成员列表", async () => {
    const { server, host, guest, roomId } = await setupRoom();
    expect(server.store.memberCount(roomId)).toBe(2);

    await guest.close();

    const left = await host.waitFor("room.member_left");
    expect(left.payload.memberId).toBe(guest.userId);
    expect(left.payload.reason).toBe("timeout");
    expect(server.store.memberCount(roomId)).toBe(1);
  });

  it("空闲超时的连接会被服务端断开", async () => {
    const server = await startServer({ clientTimeoutMs: 30, heartbeatSweepMs: 60_000 });
    const client = await connect(server);

    await new Promise((resolve) => setTimeout(resolve, 60));
    server.sweepIdleConnections();

    await client.waitForClose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.connectionCount()).toBe(0);
  });
});

describe("异常输入与限流", () => {
  it("未加入房间就发送标记返回 NOT_IN_ROOM", async () => {
    const server = await startServer();
    const client = await connect(server);

    client.send("marker.create", {
      marker: { id: `mk_${createUlid()}`, mapId: "customs", kind: "loot", position, label: "保险箱" },
    });

    expect((await client.waitFor("error")).payload.code).toBe("NOT_IN_ROOM");
  });

  it("畸形 JSON 与非法字段返回 BAD_MESSAGE，连接保持可用", async () => {
    const server = await startServer();
    const client = await connect(server);

    client.sendRaw("{ 这不是 JSON");
    expect((await client.waitFor("error")).payload.code).toBe("BAD_MESSAGE");

    client.sendRaw(
      JSON.stringify({ v: 1, id: createUlid(), ts: Date.now(), roomId: null, from: null, type: "room.join", payload: { roomId: "ABC", displayName: "老李" } }),
    );
    expect((await client.waitFor("error")).payload.code).toBe("BAD_MESSAGE");

    client.send("ping", {});
    expect((await client.waitFor("pong")).type).toBe("pong");
    expect(client.invalidMessages).toEqual([]);
  });

  it("协议版本不匹配返回 PROTOCOL_VERSION", async () => {
    const server = await startServer();
    const client = await connect(server);

    client.sendRaw(
      JSON.stringify({ v: 2, id: createUlid(), ts: Date.now(), roomId: null, from: null, type: "ping", payload: {} }),
    );

    const error = await client.waitFor("error");
    expect(error.payload.code).toBe("PROTOCOL_VERSION");
  });

  it("同一个消息 ID 重复发送只会应用一次", async () => {
    const { host, guest } = await setupRoom();
    const messageId = createUlid();
    const payload = {
      marker: { id: `mk_${createUlid()}`, mapId: "customs", kind: "loot" as const, position, label: "保险箱" },
    };

    guest.send("marker.create", payload, { id: messageId });
    await guest.waitFor("ack");
    guest.send("marker.create", payload, { id: messageId });
    await guest.waitFor("ack");

    await host.settle();
    expect(host.countOf("marker.created")).toBe(1);
    expect(guest.countOf("error")).toBe(0);
  });

  it("标记创建超限时返回 RATE_LIMITED", async () => {
    const { guest } = await setupRoom();

    for (let index = 0; index < 12; index += 1) {
      guest.send("marker.create", {
        marker: { id: `mk_${createUlid()}`, mapId: "customs", kind: "note", position, label: `标记 ${index}` },
      });
    }

    const error = await guest.waitFor("error");
    expect(error.payload.code).toBe("RATE_LIMITED");
  });

  it("位置更新超限时静默丢弃，不产生错误消息", async () => {
    const { host, guest } = await setupRoom();

    for (let index = 0; index < 20; index += 1) {
      guest.send("player.update", { position, mapId: "customs", source: "screenshot" });
    }

    await guest.settle(250);
    expect(guest.countOf("error")).toBe(0);
    // 限流为 15 条/秒，服务端最多广播 15 条
    expect(host.countOf("player.updated")).toBeLessThanOrEqual(15);
  });
});

describe("启动与端口", () => {
  it("端口被占用时自动尝试下一个端口", async () => {
    const first = await startServer();
    const second = await createGameServer({
      host: "127.0.0.1",
      port: first.port,
      logger: createSilentLogger(),
    });
    servers.push(second);

    // 正常是从起始端口往后 +1；相邻端口恰好被别的进程占用时会继续往后找
    expect(second.port).toBeGreaterThan(first.port);
    expect(first.port).not.toBe(second.port);
  });

  it("监听 0.0.0.0 时本机连接地址使用回环地址", async () => {
    const server = await startServer({ host: "0.0.0.0" });
    expect(server.url).toBe(`ws://127.0.0.1:${server.port}`);

    const client = await connect(server);
    client.send("ping", {});
    expect((await client.waitFor("pong")).type).toBe("pong");
  });
});
