/**
 * 房间客户端：连接、心跳、断线重连、离线补发。
 *
 * 传输层通过 `createSocket` 注入，因此既能在渲染进程里跑（浏览器 WebSocket），
 * 也能在 Node 测试里跑（`ws`），还能用假 socket 做纯逻辑测试。
 */

import {
  type ClientMessage,
  type ClientMessageBody,
  type ClientMessageType,
  type MessageOf,
  type ServerMessage,
} from "../protocol/messages";
import { createClientMessage, parseServerMessage } from "../protocol/messages";
import { createUlid } from "../utils/id";
import { type SocketFactory, SOCKET_OPEN, type MinimalSocket } from "./socket";

export type ClientState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type PendingJoin = {
  roomId: string;
  displayName: string;
  passcode?: string;
};

export type GameClientOptions = {
  createSocket: SocketFactory;
  now?: () => number;
  random?: () => number;
  /** 心跳间隔，默认 15 秒（与协议文档一致） */
  heartbeatIntervalMs?: number;
  /** 超过该时长没有任何消息就判定连接失效，默认 60 秒 */
  timeoutMs?: number;
  /** 重连退避起点，默认 1 秒 */
  reconnectBaseMs?: number;
  /** 重连退避上限，默认 30 秒 */
  reconnectMaxMs?: number;
  onMessage?: (message: ServerMessage) => void;
  onStateChange?: (state: ClientState) => void;
  onError?: (reason: string) => void;
};

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

type GameClientTimers = {
  setInterval: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

const defaultTimers: GameClientTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (timer) => clearInterval(timer),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class GameClient {
  readonly #options: Required<
    Pick<GameClientOptions, "createSocket" | "now" | "random" | "heartbeatIntervalMs" | "timeoutMs" | "reconnectBaseMs" | "reconnectMaxMs">
  > &
    GameClientOptions;
  readonly #timers: GameClientTimers;

  #socket: MinimalSocket | null = null;
  #state: ClientState = "idle";
  #url: string | null = null;
  #manualClose = false;
  #attempt = 0;
  #lastMessageAt = 0;
  #userId: string | null = null;
  #roomId: string | null = null;
  #pendingJoin: PendingJoin | null = null;
  #queue: ClientMessage[] = [];
  /** 自己收到过的最新快照，用于重连后对比是否追平 */
  #snapshotReceived = false;

  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #timeoutTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: GameClientOptions, timers: GameClientTimers = defaultTimers) {
    this.#options = {
      now: () => Date.now(),
      random: () => Math.random(),
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      reconnectBaseMs: DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: DEFAULT_RECONNECT_MAX_MS,
      ...options,
    };
    this.#timers = timers;
  }

  get state(): ClientState {
    return this.#state;
  }

  get userId(): string | null {
    return this.#userId;
  }

  get roomId(): string | null {
    return this.#roomId;
  }

  get queuedMessages(): number {
    return this.#queue.length;
  }

  get reconnectAttempts(): number {
    return this.#attempt;
  }

  /** 是否收到过房间快照（重连追平的判据之一） */
  get hasSnapshot(): boolean {
    return this.#snapshotReceived;
  }

  connect(url: string): void {
    this.#url = url;
    this.#manualClose = false;
    this.#openSocket();
  }

  disconnect(): void {
    this.#manualClose = true;
    this.#stopTimers();
    if (this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#socket?.close(1000, "client closing");
    this.#socket = null;
    this.#setState("closed");
  }

  /** 断线期间排队的消息数量（调试用） */
  send<T extends ClientMessageType>(type: T, payload: MessageOf<ClientMessage, T>["payload"]): string {
    const id = createUlid(this.#options.now());
    // TypeScript 无法在泛型方法内部保持 type ↔ payload 的关联，这里做一次局部断言；
    // 调用方仍受泛型签名的判别联合保护，服务端收到后还会再校验一次。
    const body = { type, payload } as ClientMessageBody;
    const message = createClientMessage(
      body,
      { id, ts: this.#options.now(), roomId: this.#roomId, from: this.#userId },
    );

    if (this.#socket !== null && this.#socket.readyState === SOCKET_OPEN) {
      this.#socket.send(JSON.stringify(message));
    } else {
      this.#queue.push(message);
    }
    return id;
  }

  createRoom(input: { mapId: string; displayName: string; maxMembers?: number; passcode?: string }): void {
    this.#pendingJoin = null;
    this.send("room.create", input);
  }

  joinRoom(input: PendingJoin): void {
    this.#pendingJoin = input;
    this.send("room.join", input);
  }

  leaveRoom(): void {
    this.#pendingJoin = null;
    this.send("room.leave", {});
  }

  #openSocket(): void {
    const url = this.#url;
    if (url === null) return;

    this.#setState(this.#attempt === 0 ? "connecting" : "reconnecting");
    const socket = this.#options.createSocket(url);
    this.#socket = socket;

    socket.onOpen(() => {
      this.#attempt = 0;
      this.#lastMessageAt = this.#options.now();
      this.#setState("open");
      this.#flushQueue();
      this.#restartHeartbeat();
      // 重连成功后重新加入原房间，服务端会回一份快照
      if (this.#pendingJoin !== null) this.send("room.join", this.#pendingJoin);
    });

    socket.onMessage((data) => {
      this.#lastMessageAt = this.#options.now();
      const parsed = parseServerMessage(safeJson(data));
      if (!parsed.ok) {
        this.#options.onError?.(`收到无法解析的服务端消息：${parsed.issues[0] ?? "格式错误"}`);
        return;
      }

      const message = parsed.message;
      if (message.type === "room.created" || message.type === "room.joined") {
        this.#userId = message.payload.self.userId;
        this.#roomId = message.payload.room.id;
      }
      if (message.type === "room.snapshot") this.#snapshotReceived = true;

      this.#options.onMessage?.(message);
    });

    socket.onClose(() => {
      this.#stopTimers();
      this.#socket = null;
      if (this.#manualClose) {
        this.#setState("closed");
        return;
      }
      this.#scheduleReconnect();
    });

    socket.onError(() => {
      // 具体错误由 onClose 统一处理，避免重复调度重连
      this.#options.onError?.("连接出错");
    });
  }

  #scheduleReconnect(): void {
    this.#setState("reconnecting");
    this.#attempt += 1;

    const base = this.#options.reconnectBaseMs;
    const max = this.#options.reconnectMaxMs;
    const exponential = Math.min(max, base * 2 ** (this.#attempt - 1));
    // 加一点抖动，避免多人同时重连把服务端打爆
    const jitter = exponential * 0.2 * this.#options.random();
    const delay = Math.min(max, exponential + jitter);

    if (this.#reconnectTimer !== null) this.#timers.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = this.#timers.setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, delay);
  }

  #flushQueue(): void {
    const queue = this.#queue;
    this.#queue = [];
    for (const message of queue) {
      this.#socket?.send(JSON.stringify(message));
    }
  }

  #restartHeartbeat(): void {
    this.#stopTimers();

    this.#heartbeatTimer = this.#timers.setInterval(() => {
      if (this.#socket?.readyState === SOCKET_OPEN) this.send("ping", {});
    }, this.#options.heartbeatIntervalMs);

    this.#timeoutTimer = this.#timers.setInterval(() => {
      if (this.#options.now() - this.#lastMessageAt <= this.#options.timeoutMs) return;
      // 长时间收不到任何消息：主动断开，交给重连逻辑
      this.#options.onError?.("长时间没有收到服务端消息，正在重连");
      this.#socket?.close(4000, "timeout");
    }, this.#options.timeoutMs);
  }

  #stopTimers(): void {
    if (this.#heartbeatTimer !== null) {
      this.#timers.clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (this.#timeoutTimer !== null) {
      this.#timers.clearInterval(this.#timeoutTimer);
      this.#timeoutTimer = null;
    }
  }

  #setState(state: ClientState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.onStateChange?.(state);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { SOCKET_OPEN };
