/**
 * 共享层入口。
 *
 * 目录约定：
 * - `protocol/` 消息信封与各类型载荷（Zod Schema 为唯一事实来源）
 * - `model/`    跨端领域模型
 * - `map/`      单应变换与视图坐标换算
 * - `capture/`  游戏截图文件名解析
 * - `utils/`    ID 生成等无副作用工具
 */
export * from "./capture/screenshot-filename";
export * from "./client";
export * from "./map";
export * from "./model";
export * from "./protocol";
export * from "./utils/id";
