/**
 * ID 生成：ULID 与房间码。
 *
 * 两种 ID 都使用 Crockford Base32 字符集（去掉 I、L、O、U 中易混的部分），
 * 便于人眼抄写与语音播报。随机源支持注入，测试中可得到确定性结果。
 */

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 房间码字符集：A-Z 去掉 I、O，数字 2-9 去掉 0、1，共 32 个字符 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 房间码长度 */
export const ROOM_CODE_LENGTH = 6;

const ULID_RANDOM_BYTES = 10;
const ULID_TIME_CHARS = 10;
const ULID_RANDOM_CHARS = 16;
const MAX_TIMESTAMP = 0xffffffffffff; // 48 位

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 生成 ULID：前 10 个字符是时间戳，后 16 个字符是随机部分。
 *
 * 按时间戳单调递增（同一毫秒内不保证顺序），可以直接用于排序与分页。
 */
export function createUlid(timestamp: number = Date.now(), random?: Uint8Array): string {
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP) {
    throw new Error(`ULID 时间戳必须是 [0, ${MAX_TIMESTAMP}] 之间的整数`);
  }

  const bytes = random ?? randomBytes(ULID_RANDOM_BYTES);
  if (bytes.length < ULID_RANDOM_BYTES) {
    throw new Error(`ULID 随机部分至少需要 ${ULID_RANDOM_BYTES} 字节`);
  }

  let timePart = "";
  let remaining = timestamp;
  for (let index = 0; index < ULID_TIME_CHARS; index += 1) {
    timePart = CROCKFORD_ALPHABET.charAt(remaining % 32) + timePart;
    remaining = Math.floor(remaining / 32);
  }

  let randomPart = "";
  let accumulator = 0;
  let bitCount = 0;
  for (let index = 0; index < ULID_RANDOM_BYTES; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error("ULID 随机字节读取越界");
    accumulator = ((accumulator << 8) | byte) >>> 0;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      randomPart += CROCKFORD_ALPHABET.charAt((accumulator >>> bitCount) & 31);
    }
  }

  return timePart + randomPart.slice(0, ULID_RANDOM_CHARS);
}

/**
 * 生成房间码。
 *
 * 每个字符独立取自 32 个字符的字符集，`byte % 32` 在 0–255 上均匀分布，
 * 不存在取模偏置。
 */
export function createRoomCode(random?: Uint8Array): string {
  const bytes = random ?? randomBytes(ROOM_CODE_LENGTH);
  if (bytes.length < ROOM_CODE_LENGTH) {
    throw new Error(`房间码至少需要 ${ROOM_CODE_LENGTH} 字节随机数`);
  }

  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error("房间码随机字节读取越界");
    code += ROOM_CODE_ALPHABET.charAt(byte % ROOM_CODE_ALPHABET.length);
  }
  return code;
}

/** 生成带前缀的业务 ID，例如 `usr_01J8...`、`mk_01J8...` */
export function createPrefixedId(prefix: string, timestamp: number = Date.now()): string {
  return `${prefix}_${createUlid(timestamp)}`;
}
