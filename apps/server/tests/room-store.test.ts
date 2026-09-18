import { describe, expect, it } from "vitest";

import { TOMBSTONE_TTL_MS, RoomStore } from "../src/rooms/room-store";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MARKER_ID = "mk_01J8Z4M2KJ4N6P8Q2S7T1V3W9X";
const SECOND_MARKER_ID = "mk_01J8Z4M2KJ4N6P8Q2S7T1V3W9Y";
const ROUTE_ID = "rt_01J8Z4M2KJ4N6P8Q2S7T1V3W9X";

const position = { x: 120.5, y: 2.44, z: -60.25 };

function createTestStore(clock: { now?: () => number } = {}): RoomStore {
  let codeSequence = 0;
  return new RoomStore({
    createCode: () => `R7K2Q${CODE_ALPHABET.charAt(codeSequence++ % CODE_ALPHABET.length)}`,
    ...(clock.now === undefined ? {} : { now: clock.now }),
  });
}

function createRoom(store: RoomStore, overrides: { maxMembers?: number; passcode?: string } = {}) {
  return store.createRoom({
    ownerId: "usr_01J8Z4M2KJ4N6P8Q2S7T1V3W9X",
    displayName: "房主",
    mapId: "customs",
    ...overrides,
  });
}

describe("房间生命周期", () => {
  it("创建房间会生成合法房间码并让创建者成为房主", () => {
    const store = createTestStore();
    const { room, self } = createRoom(store);

    expect(room.id).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room.ownerId).toBe(self.userId);
    expect(room.maxMembers).toBe(5);
    expect(room.hasPasscode).toBe(false);
    expect(self.role).toBe("owner");
    expect(store.memberCount(room.id)).toBe(1);
  });

  it("房间码持续冲突时报错而不是死循环", () => {
    const store = new RoomStore({ createCode: () => "R7K2QF" });
    const first = createRoom(store);

    expect(first.room.id).toBe("R7K2QF");
    expect(() => createRoom(store)).toThrow(/连续 20 次冲突/);
  });

  it("加入房间会分配不同颜色，并拒绝重复加入", () => {
    const store = createTestStore();
    const { room } = createRoom(store);

    const a = store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" });
    const b = store.joinRoom({ roomId: room.id, userId: "usr_B", displayName: "阿飞" });
    const again = store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(again).toEqual({ ok: false, code: "ALREADY_IN_ROOM" });

    if (!a.ok || !b.ok) return;
    expect(a.self.color).not.toBe(b.self.color);
    expect(store.memberCount(room.id)).toBe(3);
  });

  it("房间不存在与满员时返回对应错误码", () => {
    const store = createTestStore();
    expect(store.joinRoom({ roomId: "ZZZZZZ", userId: "usr_A", displayName: "老李" })).toEqual({
      ok: false,
      code: "ROOM_NOT_FOUND",
    });

    const { room } = createRoom(store, { maxMembers: 2 });
    expect(store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" }).ok).toBe(true);
    expect(store.joinRoom({ roomId: room.id, userId: "usr_B", displayName: "阿飞" })).toEqual({
      ok: false,
      code: "ROOM_FULL",
    });
  });

  it("带口令的房间会校验口令", () => {
    const store = createTestStore();
    const { room } = createRoom(store, { passcode: "8848" });
    expect(room.hasPasscode).toBe(true);

    expect(store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" })).toEqual({
      ok: false,
      code: "PASSCODE_REQUIRED",
    });
    expect(
      store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李", passcode: "0000" }),
    ).toEqual({ ok: false, code: "PASSCODE_INVALID" });
    expect(
      store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李", passcode: "8848" }).ok,
    ).toBe(true);
  });

  it("最后一名成员离开后房间被回收", () => {
    const store = createTestStore();
    const { room, self } = createRoom(store);
    store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" });

    const first = store.leaveRoom(room.id, self.userId);
    expect(first?.roomEmpty).toBe(false);
    expect(store.hasRoom(room.id)).toBe(true);

    const second = store.leaveRoom(room.id, "usr_A");
    expect(second?.roomEmpty).toBe(true);
    expect(store.hasRoom(room.id)).toBe(false);
    expect(store.roomCount).toBe(0);
  });
});

describe("成员与位置", () => {
  it("切换地图会同步更新所有成员的当前地图", () => {
    const store = createTestStore();
    const { room, self } = createRoom(store);
    store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" });

    const updated = store.changeMap(room.id, "woods");

    expect(updated?.mapId).toBe("woods");
    expect(store.getMember(room.id, self.userId)?.mapId).toBe("woods");
    expect(store.getMember(room.id, "usr_A")?.mapId).toBe("woods");
  });

  it("未上报位置的成员没有 PlayerState", () => {
    const store = createTestStore();
    const { room, self } = createRoom(store);

    expect(store.snapshot(room.id)?.players).toEqual([]);

    store.updatePlayer(room.id, self.userId, {
      position,
      rotation: 66.63,
      mapId: "customs",
      source: "screenshot",
      capturedAt: 1_758_182_400_000,
    });

    const players = store.snapshot(room.id)?.players ?? [];
    expect(players).toHaveLength(1);
    expect(players[0]?.position).toEqual(position);
    expect(players[0]?.rotation).toBeCloseTo(66.63, 5);
    expect(players[0]?.positionCapturedAt).toBe(1_758_182_400_000);
  });

  it("位置采集时间缺省时使用服务端接收时间", () => {
    let currentTime = 1_000;
    const store = createTestStore({ now: () => currentTime });
    const { room, self } = createRoom(store);

    currentTime = 5_000;
    store.updatePlayer(room.id, self.userId, { position, mapId: "customs", source: "manual" });

    const member = store.getMember(room.id, self.userId);
    expect(member?.positionCapturedAt).toBe(5_000);
    expect(member?.lastSeenAt).toBe(5_000);
  });
});

describe("标记与路线", () => {
  it("标记经过创建、修改、软删除后从快照中消失", () => {
    let currentTime = 1_000;
    const store = createTestStore({ now: () => currentTime });
    const { room, self } = createRoom(store);

    const marker = store.addMarker(
      room.id,
      { id: MARKER_ID, mapId: "customs", kind: "loot", position, label: "保险箱" },
      self.userId,
    );
    expect(marker?.color).toBeNull();
    expect(store.snapshot(room.id)?.markers).toHaveLength(1);

    currentTime = 2_000;
    const patched = store.patchMarker(room.id, MARKER_ID, { label: "已开" });
    expect(patched?.label).toBe("已开");
    expect(patched?.updatedAt).toBe(2_000);

    currentTime = 3_000;
    const deleted = store.deleteMarker(room.id, MARKER_ID);
    expect(deleted?.deletedAt).toBe(3_000);
    expect(store.snapshot(room.id)?.markers).toHaveLength(0);

    // 已删除的标记不能被再次修改或删除
    expect(store.patchMarker(room.id, MARKER_ID, { label: "又改" })).toBeNull();
    expect(store.deleteMarker(room.id, MARKER_ID)).toBeNull();
  });

  it("墓碑超过保留时长后被清理", () => {
    let currentTime = 1_000;
    const store = createTestStore({ now: () => currentTime });
    const { room, self } = createRoom(store);
    store.addMarker(
      room.id,
      { id: MARKER_ID, mapId: "customs", kind: "danger", position, label: "敌情" },
      self.userId,
    );
    store.deleteMarker(room.id, MARKER_ID);
    expect(store.getMarker(room.id, MARKER_ID)?.deletedAt).not.toBeNull();

    currentTime += TOMBSTONE_TTL_MS + 1;
    store.addMarker(
      room.id,
      { id: SECOND_MARKER_ID, mapId: "customs", kind: "note", position, label: "备注" },
      self.userId,
    );

    expect(store.getMarker(room.id, MARKER_ID)).toBeNull();
  });

  it("路线支持创建、修改与删除", () => {
    const store = createTestStore();
    const { room, self } = createRoom(store);
    const points = [position, { x: 90, y: 1.2, z: -140.5 }];

    const route = store.addRoute(
      room.id,
      { id: ROUTE_ID, mapId: "customs", name: "撤离路线", points, color: "#4c8dff" },
      self.userId,
    );
    expect(route?.points).toHaveLength(2);

    const patched = store.patchRoute(room.id, ROUTE_ID, { name: "改道" });
    expect(patched?.name).toBe("改道");

    expect(store.deleteRoute(room.id, ROUTE_ID)?.deletedAt).not.toBeNull();
    expect(store.snapshot(room.id)?.routes).toHaveLength(0);
    expect(store.patchRoute(room.id, ROUTE_ID, { name: "又改" })).toBeNull();
  });

  it("快照包含成员、玩家、标记与路线", () => {
    const store = createTestStore();
    const { room, self } = createRoom(store);
    store.joinRoom({ roomId: room.id, userId: "usr_A", displayName: "老李" });
    store.updatePlayer(room.id, self.userId, { position, mapId: "customs", source: "screenshot" });
    store.addMarker(
      room.id,
      { id: MARKER_ID, mapId: "customs", kind: "extract", position, label: "撤离" },
      self.userId,
    );

    const snapshot = store.snapshot(room.id);
    expect(snapshot?.members).toHaveLength(2);
    expect(snapshot?.players).toHaveLength(1);
    expect(snapshot?.markers).toHaveLength(1);
    expect(snapshot?.room.id).toBe(room.id);
    expect(snapshot?.serverTime).toBeGreaterThan(0);
  });
});
