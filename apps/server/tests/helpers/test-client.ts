import { once } from "node:events";
import { WebSocket } from "ws";

import {
  type ClientMessage,
  type ClientMessageBody,
  type ClientMessageType,
  type MessageOf,
  type ServerMessage,
  type ServerMessageType,
  createClientMessage,
  createUlid,
  parseServerMessage,
} from "@tarkov-map-share/shared";

type Waiter = {
  type: string;
  resolve: (message: ServerMessage) => void;
};

/**
 * 测试用假客户端：自动构造信封、按类型等待服务端消息。
 *
 * `waitFor` 只消费**尚未被匹配过**的消息，因此同一类型可以连续等待多次。
 */
export class TestClient {
  readonly received: ServerMessage[] = [];
  readonly invalidMessages: string[] = [];
  userId: string | null = null;
  roomId: string | null = null;

  readonly #socket: WebSocket;
  #waiters: Waiter[] = [];
  #pending: ServerMessage[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => {
      this.#onMessage(typeof data === "string" ? data : data.toString());
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await once(socket, "open");
    return new TestClient(socket);
  }

  get isOpen(): boolean {
    return this.#socket.readyState === WebSocket.OPEN;
  }

  /** 发送一条合法消息，返回消息 ID（便于做去重测试） */
  send<T extends ClientMessageType>(
    type: T,
    payload: MessageOf<ClientMessage, T>["payload"],
    options: { id?: string } = {},
  ): string {
    const id = options.id ?? createUlid();
    // TypeScript 无法在泛型函数内部保持 type ↔ payload 的关联，这里做一次局部断言；
    // 调用方仍然受泛型签名的判别联合检查保护。
    const body = { type, payload } as ClientMessageBody;
    const message = createClientMessage(body, {
      id,
      ts: Date.now(),
      roomId: this.roomId,
      from: this.userId,
    });
    this.#socket.send(JSON.stringify(message));
    return id;
  }

  /** 发送裸字符串，用于畸形消息测试 */
  sendRaw(text: string): void {
    this.#socket.send(text);
  }

  async waitFor<T extends ServerMessageType>(
    type: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const pendingIndex = this.#pending.findIndex((message) => message.type === type);
    if (pendingIndex >= 0) {
      const [message] = this.#pending.splice(pendingIndex, 1);
      return message as Extract<ServerMessage, { type: T }>;
    }

    return await new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const waiter: Waiter = {
        type,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as Extract<ServerMessage, { type: T }>);
        },
      };

      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((item) => item !== waiter);
        reject(
          new Error(
            `等待 ${type} 超时（${timeoutMs}ms），已收到: ${this.receivedTypes().join(", ") || "无"}`,
          ),
        );
      }, timeoutMs);

      this.#waiters.push(waiter);
    });
  }

  receivedTypes(): string[] {
    return this.received.map((message) => message.type);
  }

  countOf(type: ServerMessageType): number {
    return this.received.filter((message) => message.type === type).length;
  }

  /** 等待一小段时间，让在途消息都到达 */
  async settle(ms = 120): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    if (this.#socket.readyState === WebSocket.CLOSED) return;
    this.#socket.close();
    await once(this.#socket, "close");
  }

  waitForClose(timeoutMs = 1000): Promise<void> {
    if (this.#socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待连接关闭超时")), timeoutMs);
      this.#socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #onMessage(text: string): void {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      this.invalidMessages.push(text);
      return;
    }

    const parsed = parseServerMessage(parsedJson);
    if (!parsed.ok) {
      this.invalidMessages.push(text);
      return;
    }

    const message = parsed.message;
    this.received.push(message);

    if (message.type === "room.created" || message.type === "room.joined") {
      this.userId = message.payload.self.userId;
      this.roomId = message.payload.room.id;
    }

    const waiterIndex = this.#waiters.findIndex((waiter) => waiter.type === message.type);
    if (waiterIndex >= 0) {
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      waiter?.resolve(message);
      return;
    }

    this.#pending.push(message);
  }
}
