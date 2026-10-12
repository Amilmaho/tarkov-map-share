/**
 * 内存中的房间状态（ADR-0006）。
 *
 * 这一层只负责状态与不变量（容量、口令、成员、标记、路线），
 * 不涉及 WebSocket；协议与广播由 gateway 处理，因此可以单独做单元测试。
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  type Marker,
  type MarkerDraft,
  type MarkerPatch,
  type MemberRole,
  type PlayerSource,
  type PlayerState,
  type Room,
  type RoomMember,
  type Route,
  type RouteDraft,
  type RoutePatch,
  type WorldPosition,
  createPrefixedId,
  createRoomCode,
} from "@tarkov-map-share/shared";

import { DEFAULT_MAX_MEMBERS, MEMBER_COLORS } from "../config";

/** 软删除的墓碑保留时长：足够覆盖并发写，又不会无限增长 */
export const TOMBSTONE_TTL_MS = 5 * 60 * 1000;

export type PasscodeRecord = {
  salt: string;
  hash: string;
};

export type MemberState = {
  userId: string;
  role: MemberRole;
  joinedAt: number;
  displayName: string;
  color: string;
  mapId: string;
  source: PlayerSource;
  online: boolean;
  lastSeenAt: number;
  /** 尚未上报过位置时为 null */
  position: WorldPosition | null;
  rotation: number;
  positionCapturedAt: number | null;
};

export type RoomState = {
  room: Room;
  passcode: PasscodeRecord | null;
  members: Map<string, MemberState>;
  markers: Map<string, Marker>;
  routes: Map<string, Route>;
};

export type RoomSnapshot = {
  room: Room;
  members: RoomMember[];
  players: PlayerState[];
  markers: Marker[];
  routes: Route[];
  serverTime: number;
};

export type RoomStoreOptions = {
  now?: () => number;
  createId?: (prefix: string) => string;
  createCode?: () => string;
  colors?: readonly string[];
  defaultMaxMembers?: number;
};

export type CreateRoomInput = {
  ownerId: string;
  displayName: string;
  mapId: string;
  maxMembers?: number;
  passcode?: string;
};

export type JoinRoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ALREADY_IN_ROOM"
  | "PASSCODE_REQUIRED"
  | "PASSCODE_INVALID";

export type JoinRoomResult =
  | { ok: true; room: Room; self: MemberState }
  | { ok: false; code: JoinRoomErrorCode };

export type PlayerUpdateInput = {
  position: WorldPosition;
  rotation?: number;
  mapId: string;
  source: PlayerSource;
  capturedAt?: number;
};

function hashPasscode(passcode: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${passcode}`).digest("hex");
}

function createPasscodeRecord(passcode: string): PasscodeRecord {
  const salt = randomBytes(8).toString("hex");
  return { salt, hash: hashPasscode(passcode, salt) };
}

function matchesPasscode(record: PasscodeRecord, passcode: string): boolean {
  const candidate = Buffer.from(hashPasscode(passcode, record.salt), "hex");
  const expected = Buffer.from(record.hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export class RoomStore {
  readonly #rooms = new Map<string, RoomState>();
  readonly #now: () => number;
  readonly #createId: (prefix: string) => string;
  readonly #createCode: () => string;
  readonly #colors: readonly string[];
  readonly #defaultMaxMembers: number;

  constructor(options: RoomStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#createId = options.createId ?? ((prefix: string) => createPrefixedId(prefix, this.#now()));
    this.#createCode = options.createCode ?? (() => createRoomCode());
    this.#colors = options.colors ?? MEMBER_COLORS;
    this.#defaultMaxMembers = options.defaultMaxMembers ?? DEFAULT_MAX_MEMBERS;
  }

  get roomCount(): number {
    return this.#rooms.size;
  }

  createRoom(input: CreateRoomInput): { room: Room; self: MemberState } {
    const now = this.#now();
    const code = this.#allocateRoomCode();

    const room: Room = {
      id: code,
      ownerId: input.ownerId,
      mapId: input.mapId,
      maxMembers: input.maxMembers ?? this.#defaultMaxMembers,
      hasPasscode: input.passcode !== undefined,
      createdAt: now,
      updatedAt: now,
    };

    const state: RoomState = {
      room,
      passcode: input.passcode === undefined ? null : createPasscodeRecord(input.passcode),
      members: new Map(),
      markers: new Map(),
      routes: new Map(),
    };
    this.#rooms.set(code, state);

    const self = this.#addMember(state, {
      userId: input.ownerId,
      displayName: input.displayName,
      role: "owner",
    });

    return { room, self };
  }

  joinRoom(input: {
    roomId: string;
    userId: string;
    displayName: string;
    passcode?: string;
  }): JoinRoomResult {
    const state = this.#rooms.get(input.roomId);
    if (state === undefined) return { ok: false, code: "ROOM_NOT_FOUND" };

    if (state.members.has(input.userId)) return { ok: false, code: "ALREADY_IN_ROOM" };

    if (state.passcode !== null) {
      if (input.passcode === undefined) return { ok: false, code: "PASSCODE_REQUIRED" };
      if (!matchesPasscode(state.passcode, input.passcode)) {
        return { ok: false, code: "PASSCODE_INVALID" };
      }
    }

    if (state.members.size >= state.room.maxMembers) return { ok: false, code: "ROOM_FULL" };

    const self = this.#addMember(state, {
      userId: input.userId,
      displayName: input.displayName,
      role: "member",
    });
    this.#touch(state);

    return { ok: true, room: state.room, self };
  }

  leaveRoom(roomId: string, userId: string): { room: Room; member: MemberState; roomEmpty: boolean } | null {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return null;

    const member = state.members.get(userId);
    if (member === undefined) return null;

    state.members.delete(userId);
    this.#touch(state);

    const roomEmpty = state.members.size === 0;
    const room = state.room;
    if (roomEmpty) this.#rooms.delete(roomId);

    return { room, member, roomEmpty };
  }

  getRoom(roomId: string): Room | null {
    return this.#rooms.get(roomId)?.room ?? null;
  }

  hasRoom(roomId: string): boolean {
    return this.#rooms.has(roomId);
  }

  getMember(roomId: string, userId: string): MemberState | null {
    return this.#rooms.get(roomId)?.members.get(userId) ?? null;
  }

  listMembers(roomId: string): MemberState[] {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return [];
    return [...state.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  memberCount(roomId: string): number {
    return this.#rooms.get(roomId)?.members.size ?? 0;
  }

  /** 房间内所有成员的 userId，用于定向广播 */
  memberIds(roomId: string): string[] {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return [];
    return [...state.members.keys()];
  }

  setOnline(roomId: string, userId: string, online: boolean): MemberState | null {
    const member = this.getMember(roomId, userId);
    if (member === null) return null;
    member.online = online;
    member.lastSeenAt = this.#now();
    return member;
  }

  touchMember(roomId: string, userId: string): void {
    const member = this.getMember(roomId, userId);
    if (member === null) return;
    member.lastSeenAt = this.#now();
  }

  /** 切换队伍地图；房间内所有成员的当前地图一起更新 */
  changeMap(roomId: string, mapId: string): Room | null {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return null;

    state.room.mapId = mapId;
    for (const member of state.members.values()) member.mapId = mapId;
    this.#touch(state);

    return state.room;
  }

  updatePlayer(roomId: string, userId: string, input: PlayerUpdateInput): MemberState | null {
    const member = this.getMember(roomId, userId);
    if (member === null) return null;

    const now = this.#now();
    member.position = input.position;
    if (input.rotation !== undefined) member.rotation = input.rotation;
    member.mapId = input.mapId;
    member.source = input.source;
    member.positionCapturedAt = input.capturedAt ?? now;
    member.lastSeenAt = now;
    member.online = true;

    const state = this.#rooms.get(roomId);
    if (state !== undefined) this.#touch(state);

    return member;
  }

  addMarker(roomId: string, draft: MarkerDraft, createdBy: string): Marker | null {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return null;

    const now = this.#now();
    const marker: Marker = {
      id: draft.id,
      roomId,
      mapId: draft.mapId,
      floorId: draft.floorId ?? null,
      kind: draft.kind,
      position: draft.position,
      label: draft.label,
      color: draft.color ?? null,
      createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    state.markers.set(marker.id, marker);
    this.#touch(state);
    return marker;
  }

  getMarker(roomId: string, markerId: string): Marker | null {
    return this.#rooms.get(roomId)?.markers.get(markerId) ?? null;
  }

  patchMarker(roomId: string, markerId: string, patch: MarkerPatch): Marker | null {
    const state = this.#rooms.get(roomId);
    const marker = state?.markers.get(markerId);
    if (state === undefined || marker === undefined || marker.deletedAt !== null) return null;

    if (patch.kind !== undefined) marker.kind = patch.kind;
    if (patch.position !== undefined) marker.position = patch.position;
    if (patch.label !== undefined) marker.label = patch.label;
    if (patch.color !== undefined) marker.color = patch.color;
    marker.updatedAt = this.#now();

    this.#touch(state);
    return marker;
  }

  /** 软删除：保留墓碑，避免并发写把已删除的标记加回来 */
  deleteMarker(roomId: string, markerId: string): Marker | null {
    const state = this.#rooms.get(roomId);
    const marker = state?.markers.get(markerId);
    if (state === undefined || marker === undefined || marker.deletedAt !== null) return null;

    const now = this.#now();
    marker.deletedAt = now;
    marker.updatedAt = now;

    this.#touch(state);
    this.#pruneTombstones(state);
    return marker;
  }

  addRoute(roomId: string, draft: RouteDraft, createdBy: string): Route | null {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return null;

    const now = this.#now();
    const route: Route = {
      id: draft.id,
      roomId,
      mapId: draft.mapId,
      name: draft.name,
      points: draft.points,
      color: draft.color,
      createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    state.routes.set(route.id, route);
    this.#touch(state);
    return route;
  }

  patchRoute(roomId: string, routeId: string, patch: RoutePatch): Route | null {
    const state = this.#rooms.get(roomId);
    const route = state?.routes.get(routeId);
    if (state === undefined || route === undefined || route.deletedAt !== null) return null;

    if (patch.name !== undefined) route.name = patch.name;
    if (patch.points !== undefined) route.points = patch.points;
    if (patch.color !== undefined) route.color = patch.color;
    route.updatedAt = this.#now();

    this.#touch(state);
    return route;
  }

  deleteRoute(roomId: string, routeId: string): Route | null {
    const state = this.#rooms.get(roomId);
    const route = state?.routes.get(routeId);
    if (state === undefined || route === undefined || route.deletedAt !== null) return null;

    const now = this.#now();
    route.deletedAt = now;
    route.updatedAt = now;

    this.#touch(state);
    this.#pruneTombstones(state);
    return route;
  }

  /** 全量快照：只包含未删除的标记与路线 */
  snapshot(roomId: string): RoomSnapshot | null {
    const state = this.#rooms.get(roomId);
    if (state === undefined) return null;

    const markers = [...state.markers.values()]
      .filter((marker) => marker.deletedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt);
    const routes = [...state.routes.values()]
      .filter((route) => route.deletedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt);

    const members = this.listMembers(roomId);

    return {
      room: state.room,
      members: members.map((member) => toProtocolMember(state.room.id, member)),
      players: members
        .map((member) => toProtocolPlayer(member))
        .filter((player): player is PlayerState => player !== null),
      markers,
      routes,
      serverTime: this.#now(),
    };
  }

  #allocateRoomCode(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = this.#createCode();
      if (!this.#rooms.has(code)) return code;
    }
    throw new Error("房间码生成失败：连续 20 次冲突");
  }

  #addMember(
    state: RoomState,
    input: { userId: string; displayName: string; role: MemberRole },
  ): MemberState {
    const now = this.#now();
    const color = this.#colors[state.members.size % this.#colors.length] ?? "#4c8dff";

    const member: MemberState = {
      userId: input.userId,
      role: input.role,
      joinedAt: now,
      displayName: input.displayName,
      color,
      mapId: state.room.mapId,
      source: "manual",
      online: true,
      lastSeenAt: now,
      position: null,
      rotation: 0,
      positionCapturedAt: null,
    };

    state.members.set(member.userId, member);
    return member;
  }

  #touch(state: RoomState): void {
    state.room.updatedAt = this.#now();
    this.#pruneTombstones(state);
  }

  #pruneTombstones(state: RoomState): void {
    const deadline = this.#now() - TOMBSTONE_TTL_MS;
    for (const [id, marker] of state.markers) {
      if (marker.deletedAt !== null && marker.deletedAt < deadline) state.markers.delete(id);
    }
    for (const [id, route] of state.routes) {
      if (route.deletedAt !== null && route.deletedAt < deadline) state.routes.delete(id);
    }
  }
}

export function toProtocolMember(roomId: string, member: MemberState): RoomMember {
  return {
    userId: member.userId,
    roomId,
    displayName: member.displayName,
    color: member.color,
    role: member.role,
    joinedAt: member.joinedAt,
    online: member.online,
  };
}

/** 从未上报过位置的成员没有 PlayerState，客户端在成员列表里显示为"位置未知" */
export function toProtocolPlayer(member: MemberState): PlayerState | null {
  if (member.position === null) return null;

  return {
    id: member.userId,
    displayName: member.displayName,
    color: member.color,
    mapId: member.mapId,
    position: member.position,
    rotation: member.rotation,
    source: member.source,
    online: member.online,
    lastSeenAt: member.lastSeenAt,
    positionCapturedAt: member.positionCapturedAt,
  };
}

/** 供 handler 复用的校验辅助：把房间码规范化（大写、去空格） */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}
