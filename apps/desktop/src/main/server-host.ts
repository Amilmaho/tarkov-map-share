/**
 * 房主模式：把服务端跑在应用自己的进程里（ADR-0013）。

 * 桌面端不 spawn 子进程，而是直接调用 `createGameServer()`，
 * 退出应用时一并关闭。
 */

import { DEFAULT_PORT, type GameServerHandle, createGameServer, listLanAddresses } from "@tarkov-map-share/server";

import type { HostState } from "../shared/ipc";
import { createLogger } from "./logger-bridge";

export class ServerHost {
  #handle: GameServerHandle | null = null;
  #error: string | null = null;

  state(): HostState {
    const handle = this.#handle;
    return {
      running: handle !== null,
      port: handle?.port ?? null,
      addresses: handle === null ? [] : listLanAddresses().map((entry) => entry.address),
      error: this.#error,
    };
  }

  async start(port = DEFAULT_PORT): Promise<HostState> {
    if (this.#handle !== null) return this.state();

    try {
      this.#handle = await createGameServer({
        host: "0.0.0.0",
        port,
        logger: createLogger({ level: "info" }),
      });
      this.#error = null;
    } catch (error) {
      this.#handle = null;
      this.#error = error instanceof Error ? error.message : String(error);
    }
    return this.state();
  }

  async stop(): Promise<HostState> {
    const handle = this.#handle;
    this.#handle = null;
    if (handle !== null) await handle.close();
    return this.state();
  }
}
