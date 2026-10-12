import { describe, expect, it } from "vitest";

import { GENERATED_MAPS } from "../src/renderer/src/maps.generated";

describe("生成的地图元数据", () => {
  it("每张地图至少有一层，且地面层文件与地图同名", () => {
    for (const map of GENERATED_MAPS) {
      expect(map.floors.length, map.id).toBeGreaterThanOrEqual(1);
      expect(map.floors[0]?.file).toBe(`${map.id}.webp`);
      expect(map.floors[0]?.name).toContain("地面");
    }
  });

  it("多楼层地图带上了各自的楼层", () => {
    const floorsOf = (id: string) =>
      GENERATED_MAPS.find((map) => map.id === id)?.floors.map((floor) => floor.name) ?? [];

    expect(floorsOf("interchange")).toEqual(["地面", "1 层", "2 层"]);
    expect(floorsOf("customs")).toEqual(["地面", "1 层", "2 层", "3 层", "地下"]);
    expect(floorsOf("factory")).toEqual(["地面", "2 层", "3 层", "地下室"]);
    expect(floorsOf("reserve")).toEqual(["地面", "掩体"]);
  });

  it("楼层文件名不与地面层冲突", () => {
    for (const map of GENERATED_MAPS) {
      const files = map.floors.map((floor) => floor.file);
      expect(new Set(files).size, map.id).toBe(files.length);
    }
  });
});
