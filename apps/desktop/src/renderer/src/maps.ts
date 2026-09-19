import { GENERATED_MAPS } from "./maps.generated";

export type MapBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type MapAsset = {
  id: string;
  name: string;
  /** 渲染进程可直接使用的图片地址 */
  imageUrl: string;
  width: number;
  height: number;
  /** 素材在渲染时已经按该角度旋正，这里保留原值仅作记录 */
  rotation: number;
  /** 本图覆盖的世界坐标范围（米） */
  bounds: MapBounds;
  source: {
    name: string;
    license: string;
    url?: string | undefined;
  };
  attribution: {
    author: string;
    authorLink: string;
    svgPath: string;
  };
};

/**
 * 把静态资源路径解析成当前环境可用的绝对 URL。
 *
 * 开发时页面来自 http://localhost:5173，打包后来自 file://.../out/renderer/index.html，
 * 直接写 `/maps/x.webp` 在 file:// 下会被解析到文件系统根目录，因此必须基于 document 解析。
 */
function assetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), document.baseURI).href;
}

/**
 * 地图清单：素材由 tools/build-maps.mjs 从 tarkov.dev 的开源数据生成
 * （MIT 许可，矢量图作者见各图 attribution.author）。
 */
export const MAPS: readonly MapAsset[] = GENERATED_MAPS.map((map) => ({
  id: map.id,
  name: map.name,
  imageUrl: assetUrl(`maps/${map.id}.webp`),
  width: map.width,
  height: map.height,
  rotation: map.rotation,
  bounds: map.bounds,
  source: {
    name: `tarkov.dev 矢量地图（作者 ${map.attribution.author}）`,
    license: "MIT",
    url: map.attribution.authorLink,
  },
  attribution: map.attribution,
}));

export const DEFAULT_MAP_ID = "customs";

export function findMapOrNull(mapId: string): MapAsset | null {
  return MAPS.find((item) => item.id === mapId) ?? null;
}

export function findMap(mapId: string): MapAsset {
  const map = findMapOrNull(mapId);
  if (map === null) throw new Error(`未知地图：${mapId}`);
  return map;
}
