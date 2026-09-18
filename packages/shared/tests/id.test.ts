import { describe, expect, it } from "vitest";

import { ROOM_CODE_PATTERN, ULID_PATTERN } from "../src/model/common";
import { ROOM_CODE_ALPHABET, createPrefixedId, createRoomCode, createUlid } from "../src/utils/id";

describe("createUlid", () => {
  it("生成 26 位、字符集合法的 ULID", () => {
    const ulid = createUlid();
    expect(ulid).toHaveLength(26);
    expect(ULID_PATTERN.test(ulid)).toBe(true);
  });

  it("随机源确定时结果可复现", () => {
    const random = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const first = createUlid(1758182400000, random);
    const second = createUlid(1758182400000, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

    expect(first).toBe(second);
  });

  it("时间戳越大，ULID 字典序也越大", () => {
    const random = () => new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const earlier = createUlid(1758182400000, random());
    const later = createUlid(1758182500000, random());
    const muchLater = createUlid(1758282400000, random());

    expect(earlier < later).toBe(true);
    expect(later < muchLater).toBe(true);
  });

  it("拒绝非法时间戳与不足长度的随机源", () => {
    expect(() => createUlid(-1)).toThrow();
    expect(() => createUlid(1.5)).toThrow();
    expect(() => createUlid(0x1000000000000)).toThrow();
    expect(() => createUlid(0, new Uint8Array(4))).toThrow();
  });
});

describe("createRoomCode", () => {
  it("生成 6 位、排除易混字符的房间码", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = createRoomCode();
      expect(code).toHaveLength(6);
      expect(ROOM_CODE_PATTERN.test(code)).toBe(true);
      for (const character of code) {
        expect("IO01").not.toContain(character);
      }
    }
  });

  it("随机源确定时结果可复现", () => {
    const bytes = new Uint8Array([0, 5, 31, 32, 64, 200]);
    expect(createRoomCode(bytes)).toBe(createRoomCode(new Uint8Array([0, 5, 31, 32, 64, 200])));
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
  });

  it("随机源不足时报错", () => {
    expect(() => createRoomCode(new Uint8Array(2))).toThrow();
  });
});

describe("createPrefixedId", () => {
  it("生成带前缀的业务 ID", () => {
    expect(createPrefixedId("usr")).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(createPrefixedId("mk")).toMatch(/^mk_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
