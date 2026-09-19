/**
 * 最小 socket 抽象。
 *
 * 浏览器用全局 WebSocket（DOM 风格事件），Node 测试里用 `ws`（Node 风格事件），
 * 两边风格不同，所以这里统一成一套回调接口，由工厂负责适配。
 */

export type SocketState = 0 | 1 | 2 | 3;

export type MinimalSocket = {
  /** 0 连接中 / 1 已连接 / 2 关闭中 / 3 已关闭，与 WebSocket 常量一致 */
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (code: number) => void): void;
  onError(handler: (error: unknown) => void): void;
};

export type SocketFactory = (url: string) => MinimalSocket;

export const SOCKET_OPEN = 1;
export const SOCKET_CLOSED = 3;

/** 浏览器 / Electron 渲染进程用的工厂 */
export const browserSocketFactory: SocketFactory = (url) => {
  const socket = new WebSocket(url);
  return {
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onOpen: (handler) => socket.addEventListener("open", () => handler()),
    onMessage: (handler) =>
      socket.addEventListener("message", (event) => {
        // 服务端只会发文本帧
        handler(typeof event.data === "string" ? event.data : String(event.data));
      }),
    onClose: (handler) => socket.addEventListener("close", (event) => handler(event.code)),
    onError: (handler) => socket.addEventListener("error", (error) => handler(error)),
  };
};
