// 该文件由 tools/build-maps.mjs 自动生成，请勿手改。
// 数据来源：the-hideout/tarkov-dev（MIT）与 assets.tarkov.dev 上的矢量地图。

export type GeneratedMap = {
  id: string;
  name: string;
  width: number;
  height: number;
  rotation: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  floors: readonly { id: string; name: string; file: string }[];
  attribution: { author: string; authorLink: string; svgPath: string };
};

export const GENERATED_MAPS: readonly GeneratedMap[] = [
  {
    id: "customs",
    name: "海关",
    width: 4096,
    height: 2082,
    rotation: 0,
    bounds: { minX: -372, maxX: 698, minZ: -307, maxZ: 237 },
    floors: [{ id: "ground", name: "地面", file: "customs.webp" }, { id: "f1", name: "1 层", file: "customs__f1.webp" }, { id: "f2", name: "2 层", file: "customs__f2.webp" }, { id: "f3", name: "3 层", file: "customs__f3.webp" }, { id: "underground", name: "地下", file: "customs__underground.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Customs.svg" },
  },
  {
    id: "factory",
    name: "工厂",
    width: 4096,
    height: 3791,
    rotation: 270,
    bounds: { minX: -65.5, maxX: 77, minZ: -64.5, maxZ: 67.4 },
    floors: [{ id: "ground", name: "地面", file: "factory.webp" }, { id: "f2", name: "2 层", file: "factory__f2.webp" }, { id: "f3", name: "3 层", file: "factory__f3.webp" }, { id: "basement", name: "地下室", file: "factory__basement.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Factory.svg" },
  },
  {
    id: "ground-zero",
    name: "零号地",
    width: 2921,
    height: 4096,
    rotation: 0,
    bounds: { minX: -99, maxX: 249, minZ: -124, maxZ: 364 },
    floors: [{ id: "ground", name: "地面", file: "ground-zero.webp" }, { id: "f1", name: "1 层", file: "ground-zero__f1.webp" }, { id: "f2", name: "2 层", file: "ground-zero__f2.webp" }, { id: "f3", name: "3 层", file: "ground-zero__f3.webp" }, { id: "underground", name: "地下", file: "ground-zero__underground.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/GroundZero.svg" },
  },
  {
    id: "interchange",
    name: "立交桥",
    width: 4096,
    height: 3448,
    rotation: 0,
    bounds: { minX: -433, maxX: 598, minZ: -442, maxZ: 426 },
    floors: [{ id: "ground", name: "地面", file: "interchange.webp" }, { id: "f1", name: "1 层", file: "interchange__f1.webp" }, { id: "f2", name: "2 层", file: "interchange__f2.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Interchange.svg" },
  },
  {
    id: "lighthouse",
    name: "灯塔",
    width: 2520,
    height: 4096,
    rotation: 0,
    bounds: { minX: -545, maxX: 515, minZ: -998, maxZ: 725 },
    floors: [{ id: "ground", name: "地面", file: "lighthouse.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Lighthouse.svg" },
  },
  {
    id: "reserve",
    name: "储备站",
    width: 4096,
    height: 3715,
    rotation: 0,
    bounds: { minX: -303, maxX: 289, minZ: -293, maxZ: 244 },
    floors: [{ id: "ground", name: "地面", file: "reserve.webp" }, { id: "bunkers", name: "掩体", file: "reserve__bunkers.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Reserve.svg" },
  },
  {
    id: "shoreline",
    name: "海岸线",
    width: 4096,
    height: 2712,
    rotation: 0,
    bounds: { minX: -1056, maxX: 504, minZ: -415, maxZ: 618 },
    floors: [{ id: "ground", name: "地面", file: "shoreline.webp" }, { id: "f1", name: "1 层", file: "shoreline__f1.webp" }, { id: "f2", name: "2 层", file: "shoreline__f2.webp" }, { id: "f3", name: "3 层", file: "shoreline__f3.webp" }, { id: "underground", name: "地下", file: "shoreline__underground.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Shoreline.svg" },
  },
  {
    id: "streets-of-tarkov",
    name: "塔科夫街区",
    width: 2987,
    height: 4096,
    rotation: 0,
    bounds: { minX: -280, maxX: 323, minZ: -295, maxZ: 532 },
    floors: [{ id: "ground", name: "地面", file: "streets-of-tarkov.webp" }, { id: "f1", name: "1 层", file: "streets-of-tarkov__f1.webp" }, { id: "f2", name: "2 层", file: "streets-of-tarkov__f2.webp" }, { id: "f3", name: "3 层", file: "streets-of-tarkov__f3.webp" }, { id: "f4", name: "4 层", file: "streets-of-tarkov__f4.webp" }, { id: "f5", name: "5 层", file: "streets-of-tarkov__f5.webp" }, { id: "underground", name: "地下", file: "streets-of-tarkov__underground.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/StreetsOfTarkov.svg" },
  },
  {
    id: "terminal",
    name: "终点站",
    width: 3479,
    height: 4096,
    rotation: 0,
    bounds: { minX: -433, maxX: 463, minZ: -580, maxZ: 475 },
    floors: [{ id: "ground", name: "地面", file: "terminal.webp" }, { id: "f1", name: "1 层", file: "terminal__f1.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Terminal.svg" },
  },
  {
    id: "woods",
    name: "森林",
    width: 4096,
    height: 3948,
    rotation: 0,
    bounds: { minX: -761, maxX: 646, minZ: -914, maxZ: 442 },
    floors: [{ id: "ground", name: "地面", file: "woods.webp" }],
    attribution: { author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/", svgPath: "https://assets.tarkov.dev/maps/svg/Woods.svg" },
  },
];
