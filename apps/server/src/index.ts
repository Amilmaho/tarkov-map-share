/**
 * CLI 入口（薄壳）。
 *
 * 房主模式：直接在游戏主机上运行本进程，队友通过局域网地址连入。
 * 桌面端集成时不要用这个入口，改为在 Electron 主进程里调用 `createGameServer()`。
 */

import { DEFAULT_HOST, DEFAULT_PORT } from "./config";
import { createGameServer } from "./create-server";
import { createLogger } from "./logger";
import { listLanAddresses } from "./network";

const logger = createLogger({
  level: process.env.TMS_LOG_LEVEL === "debug" ? "debug" : "info",
});

const requestedPort = Number.parseInt(process.env.TMS_PORT ?? "", 10);
const host = process.env.TMS_HOST ?? DEFAULT_HOST;

const server = await createGameServer({
  host,
  port: Number.isFinite(requestedPort) ? requestedPort : DEFAULT_PORT,
  logger,
});

logger.info("服务端已启动", { host: server.host, port: server.port, url: server.url });

const addresses = listLanAddresses();
if (addresses.length === 0) {
  logger.warn("未找到可用的局域网地址，队友可能无法连入");
}
for (const entry of addresses) {
  logger.info(`队友可连接：${entry.address}:${server.port}（网卡 ${entry.iface}）`, {
    address: entry.address,
    iface: entry.iface,
  });
}
logger.info("首次启动时 Windows 防火墙会弹窗，请选择允许专用网络访问");

const shutdown = async (signal: string): Promise<void> => {
  logger.info("收到退出信号，正在关闭", { signal });
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
