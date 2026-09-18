export type MapAsset = {
  id: string;
  name: string;
  /** 渲染进程可直接使用的图片地址（由 Vite 提供） */
  imageUrl: string;
  width: number;
  height: number;
  source: {
    name: string;
    license: string;
    url?: string;
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
 * 地图清单。
 *
 * 原始素材（9248×5399 PNG）不入库，这里放的是缩放到 4608 宽的无损 WebP，
 * 换算成世界坐标后约 0.2 米/像素，足够精确打点。
 */
export const MAPS: readonly MapAsset[] = [
  {
    id: "customs",
    name: "海关",
    imageUrl: assetUrl("maps/customs.webp"),
    width: 4608,
    height: 2691,
    source: {
      name: "玩家提供的社区地图",
      license: "待确认（见 docs/MAP_COORDINATES.md 资源清单）",
    },
  },
];

export const DEFAULT_MAP_ID = "customs";

export function findMap(mapId: string): MapAsset {
  const map = MAPS.find((item) => item.id === mapId);
  if (map === undefined) throw new Error(`未知地图：${mapId}`);
  return map;
}
