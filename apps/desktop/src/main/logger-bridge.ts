/**
 * 主进程日志：复用服务端的结构化日志实现。
 *
 * 单独放一个文件，避免主进程各处重复 import 服务端包。
 */

export { createLogger } from "@tarkov-map-share/server";
export type { Logger } from "@tarkov-map-share/server";
