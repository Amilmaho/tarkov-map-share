/** 默认监听所有网卡，队友可以通过局域网地址连入 */
export const DEFAULT_HOST = "0.0.0.0";
/** 仅本机可连（单机模式） */
export const LOOPBACK_HOST = "127.0.0.1";

export const DEFAULT_PORT = 8787;
/** 端口被占用时向后尝试的次数 */
export const PORT_ATTEMPTS = 10;

/** 心跳扫描间隔 */
export const HEARTBEAT_SWEEP_MS = 15_000;
/** 超过该时长没有任何消息即判定连接失效 */
export const CLIENT_TIMEOUT_MS = 60_000;

/** 单条消息字节上限，与协议文档一致 */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** 每个连接记住的最近消息 ID 数量，用于去重 */
export const MAX_TRACKED_MESSAGE_IDS = 200;

export const DEFAULT_MAX_MEMBERS = 5;
export const MAX_MEMBERS_LIMIT = 10;

/** 成员配色，按加入顺序分配 */
export const MEMBER_COLORS = ["#4c8dff", "#f5a524", "#35c46a", "#d977f0", "#22b8cf", "#f76b8a"] as const;
