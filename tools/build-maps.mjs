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

    const rotation = entry.coordinateRotation ?? 0;
    // 旋转 90/270 时，输出图的宽高要交换，才能让画面比例吻合世界包围盒
    const swapAxes = rotation % 180 !== 0;
    const aspect = worldWidth / worldHeight;
    const width = aspect >= 1 || swapAxes ? TARGET_LONG_SIDE : Math.round(TARGET_LONG_SIDE * aspect);
    const height = aspect >= 1 || swapAxes ? Math.round(TARGET_LONG_SIDE / aspect) : TARGET_LONG_SIDE;

    const pngPath = join(PNG_DIR, `${entry.key}.png`);
    jobs.push({
      key: entry.key,
      svgBase64: svgBuffer.toString("base64"),
      width,
      height,
      rotation,
      pngPath,
    });

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
    execFileSync("cwebp", [
      "-quiet",
      "-q",
      WEBP_QUALITY,
      "-metadata",
      "none",
      job.pngPath,
      "-o",
      join(PUBLIC_MAPS_DIR, `${job.key}.webp`),
    ]);
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
        const file = await readFile(join(PUBLIC_MAPS_DIR, `${map.key}.webp`));
        return file.byteLength;
      }),
    )
  ).reduce((sum, size) => sum + size, 0);
  console.log(`地图素材合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

await main();
