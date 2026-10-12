#!/usr/bin/env node
/**
 * 从 tarkov.dev 的开源数据构建地图素材与预置标定。
 *
 * 数据来源：the-hideout/tarkov-dev（MIT 许可）的 `src/data/maps.json` 与
 * assets.tarkov.dev 上的矢量地图（作者见各图 author 字段）。
 *
 * 关于朝向：地图矢量图的朝向与游戏世界坐标轴不一致，`coordinateRotation`
 * 描述了这个差值。已用宽高比验证（工厂图 rot=90，viewBox 宽高比正好是世界包围盒的倒数），
 * 因此渲染时按该角度旋转，使输出图与 tarkov.dev 网页上看到的方向一致。
 *
 * 用法：node tools/build-maps.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "tools", ".cache");
const SVG_DIR = join(CACHE_DIR, "svg");
const PNG_DIR = join(CACHE_DIR, "png");
const PUBLIC_MAPS_DIR = join(ROOT, "apps", "desktop", "src", "renderer", "public", "maps");
const GENERATED_FILE = join(ROOT, "apps", "desktop", "src", "renderer", "src", "maps.generated.ts");

const MAPS_JSON_URL =
  "https://cdn.jsdelivr.net/gh/the-hideout/tarkov-dev@main/src/data/maps.json";

/** 输出长边像素：4096 在 8 倍缩放下仍够用，同时控制仓库体积 */
const TARGET_LONG_SIDE = 4096;
/** WebP 质量：地图是大色块 + 细线，90 基本看不出损失 */
const WEBP_QUALITY = "90";

/** 只收录有矢量地面层的常规对局地图 */
const MAP_NAMES = {
  "customs": "海关",
  "woods": "森林",
  "interchange": "立交桥",
  "shoreline": "海岸线",
  "reserve": "储备站",
  "lighthouse": "灯塔",
  "streets-of-tarkov": "塔科夫街区",
  "ground-zero": "零号地",
  "factory": "工厂",
  "terminal": "终点站",
};

/**
 * 楼层图层：id 是 SVG 里的分组名，name 是界面显示名，slug 用于文件名。
 * 顺序即界面上的顺序（地面在前，往上/往下依次排列）。
 */
const FLOOR_LAYERS = [
  { id: "Ground_Level", name: "地面", slug: "ground", ground: true },
  { id: "Ground_Floor", name: "地面", slug: "ground", ground: true },
  { id: "First_Floor", name: "1 层", slug: "f1" },
  { id: "Second_Floor", name: "2 层", slug: "f2" },
  { id: "Third_Floor", name: "3 层", slug: "f3" },
  { id: "Fourth_Floor", name: "4 层", slug: "f4" },
  { id: "Fifth_Floor", name: "5 层", slug: "f5" },
  { id: "Basement", name: "地下室", slug: "basement" },
  { id: "Underground_Level", name: "地下", slug: "underground" },
  { id: "Bunkers", name: "掩体", slug: "bunkers" },
];

async function download(url, target) {
  if (existsSync(target)) return await readFile(target);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return buffer;
}

function parseViewBox(svgText) {
  const match = /viewBox="([^"]+)"/.exec(svgText);
  if (match === null || match[1] === undefined) throw new Error("SVG 缺少 viewBox");
  const parts = match[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4) throw new Error(`viewBox 格式异常: ${match[1]}`);
  const [minX, minY, width, height] = parts;
  return { minX, minY, width, height };
}

async function main() {
  await mkdir(SVG_DIR, { recursive: true });
  await mkdir(PNG_DIR, { recursive: true });
  await mkdir(PUBLIC_MAPS_DIR, { recursive: true });

  const mapsJson = JSON.parse(
    (await download(MAPS_JSON_URL, join(CACHE_DIR, "maps.json"))).toString("utf8"),
  );

  // 收集带矢量地面层的地图
  const entries = [];
  for (const group of mapsJson) {
    for (const map of group.maps ?? []) {
      if (typeof map.svgPath !== "string" || map.svgPath === "") continue;
      if (map.bounds === undefined) continue;
      const name = MAP_NAMES[map.key];
      if (name === undefined) continue;
      entries.push({ ...map, name });
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  console.log(`待处理地图 ${entries.length} 张：${entries.map((e) => e.key).join(", ")}`);

  const jobs = [];
  const metadata = [];

  for (const entry of entries) {
    const svgFile = join(SVG_DIR, `${entry.key}.svg`);
    const svgBuffer = await download(entry.svgPath, svgFile);
    const viewBox = parseViewBox(svgBuffer.toString("utf8"));

    // 世界包围盒（bounds 的两个角，顺序不保证，取 min/max）
    const [[ax, az], [bx, bz]] = entry.bounds;
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minZ = Math.min(az, bz);
    const maxZ = Math.max(az, bz);
    const worldWidth = maxX - minX;
    const worldHeight = maxZ - minZ;

    // 上游矢量图的朝向与玩家习惯相反：直接渲染出来是"北在下"。
    // 统一再转 180°，让所有地图都是北朝上（coordinateRotation 描述的是素材自身的朝向差）。
    const rotation = ((entry.coordinateRotation ?? 0) + 180) % 360;
    // 旋转 90/270 时，输出图的宽高要交换，才能让画面比例吻合世界包围盒
    const swapAxes = rotation % 180 !== 0;
    const aspect = worldWidth / worldHeight;
    const width = aspect >= 1 || swapAxes ? TARGET_LONG_SIDE : Math.round(TARGET_LONG_SIDE * aspect);
    const height = aspect >= 1 || swapAxes ? Math.round(TARGET_LONG_SIDE / aspect) : TARGET_LONG_SIDE;

    // 这张图的 SVG 里有哪些楼层分组
    const svgText = svgBuffer.toString("utf8");
    const availableFloors = FLOOR_LAYERS.filter((floor) => svgText.includes(`id="${floor.id}"`));
    const groundLayer = availableFloors.find((floor) => floor.ground === true);

    /** 每张输出图：id / 显示名 / 输出文件（webp 名） */
    const floors =
      availableFloors.length === 0
        ? [{ id: "default", name: "地图", file: `${entry.key}.webp` }]
        : availableFloors.map((floor) => ({
            id: floor.slug,
            name: floor.name,
            file: floor.ground === true ? `${entry.key}.webp` : `${entry.key}__${floor.slug}.webp`,
          }));

    const pngPath = join(PNG_DIR, `${entry.key}.png`);
    const job = {
      key: entry.key,
      svgBase64: svgBuffer.toString("base64"),
      width,
      height,
      rotation,
      pngPath,
    };

    if (availableFloors.length > 0) {
      job.floors = availableFloors.map((floor) => ({
        key: floor.ground === true ? "base" : floor.slug,
        visible: floor.id,
        // 站在楼上时把地面压暗当底图；地面层自己不需要
        ...(floor.ground === true || groundLayer === undefined ? {} : { dimmed: groundLayer.id }),
        pngPath: floor.ground === true ? pngPath : join(PNG_DIR, `${entry.key}__${floor.slug}.png`),
      }));
    }
    jobs.push(job);

    metadata.push({
      key: entry.key,
      name: entry.name,
      width,
      height,
      rotation,
      viewBox,
      bounds: { minX, maxX, minZ, maxZ },
      author: entry.author ?? "",
      authorLink: entry.authorLink ?? "",
      svgPath: entry.svgPath,
      floors,
    });
  }

  // 1) 渲染 SVG → PNG
  const specPath = join(CACHE_DIR, "render-spec.json");
  await writeFile(specPath, JSON.stringify({ jobs }, null, 2), "utf8");
  const electron = join(ROOT, "node_modules", ".bin", "electron");
  console.log("开始渲染（Chromium）…");
  execFileSync(electron, [join(ROOT, "tools", "render-maps.cjs"), specPath], { stdio: "inherit" });

  // 2) PNG → WebP
  console.log("转换 WebP…");
  for (const job of jobs) {
    const outputs =
      job.floors === undefined
        ? [{ pngPath: job.pngPath, webp: `${job.key}.webp` }]
        : job.floors.map((floor) => ({
            pngPath: floor.pngPath,
            webp: floor.key === "base" ? `${job.key}.webp` : `${job.key}__${floor.key}.webp`,
          }));

    for (const output of outputs) {
      execFileSync("cwebp", [
        "-quiet",
        "-q",
        WEBP_QUALITY,
        "-metadata",
        "none",
        output.pngPath,
        "-o",
        join(PUBLIC_MAPS_DIR, output.webp),
      ]);
    }
  }

  // 3) 生成 TypeScript 元数据
  const lines = [];
  lines.push("// 该文件由 tools/build-maps.mjs 自动生成，请勿手改。");
  lines.push("// 数据来源：the-hideout/tarkov-dev（MIT）与 assets.tarkov.dev 上的矢量地图。");
  lines.push("");
  lines.push("export type GeneratedMap = {");
  lines.push("  id: string;");
  lines.push("  name: string;");
  lines.push("  width: number;");
  lines.push("  height: number;");
  lines.push("  rotation: number;");
  lines.push("  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };");
  lines.push("  floors: readonly { id: string; name: string; file: string }[];");
  lines.push("  attribution: { author: string; authorLink: string; svgPath: string };");
  lines.push("};");
  lines.push("");
  lines.push("export const GENERATED_MAPS: readonly GeneratedMap[] = [");
  for (const map of metadata) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(map.key)},`);
    lines.push(`    name: ${JSON.stringify(map.name)},`);
    lines.push(`    width: ${map.width},`);
    lines.push(`    height: ${map.height},`);
    lines.push(`    rotation: ${map.rotation},`);
    lines.push(
      `    bounds: { minX: ${map.bounds.minX}, maxX: ${map.bounds.maxX}, minZ: ${map.bounds.minZ}, maxZ: ${map.bounds.maxZ} },`,
    );
    lines.push(
      `    floors: [${map.floors.map((floor) => `{ id: ${JSON.stringify(floor.id)}, name: ${JSON.stringify(floor.name)}, file: ${JSON.stringify(floor.file)} }`).join(", ")}],`,
    );
    lines.push(
      `    attribution: { author: ${JSON.stringify(map.author)}, authorLink: ${JSON.stringify(map.authorLink)}, svgPath: ${JSON.stringify(map.svgPath)} },`,
    );
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");

  await writeFile(GENERATED_FILE, lines.join("\n"), "utf8");
  console.log(`已生成 ${GENERATED_FILE}`);

  const totalBytes = (
    await Promise.all(
      metadata.map(async (map) => {
        const sizes = await Promise.all(
          map.floors.map(async (floor) => {
            const file = await readFile(join(PUBLIC_MAPS_DIR, floor.file));
            return file.byteLength;
          }),
        );
        return sizes.reduce((sum, size) => sum + size, 0);
      }),
    )
  ).reduce((sum, size) => sum + size, 0);
  console.log(`地图素材合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

await main();
