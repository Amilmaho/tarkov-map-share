#!/usr/bin/env node
/**
 * 由 apps/desktop/build/icon.svg 生成应用图标：
 *  - build/icon.png（1024，electron-builder 用于 macOS/通用）
 *  - build/icon.ico（Windows，内含 256/128/64/48/32/16 六个尺寸）
 *
 * 渲染用 Electron（Chromium）完成，尺寸缩放用 sips。
 * 用法：node tools/build-icon.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "apps", "desktop", "build");
const SVG_PATH = join(BUILD_DIR, "icon.svg");
const PNG_PATH = join(BUILD_DIR, "icon.png");
const ICO_PATH = join(BUILD_DIR, "icon.ico");
/** 运行时窗口图标：主进程从 out/renderer/icon.png 读取 */
const PUBLIC_PATH = join(ROOT, "apps", "desktop", "src", "renderer", "public", "icon.png");
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

if (!existsSync(SVG_PATH)) {
  console.error(`找不到 ${SVG_PATH}`);
  process.exit(1);
}

await mkdir(BUILD_DIR, { recursive: true });

// 1) 渲染 1024 的 PNG
const specPath = join(BUILD_DIR, "icon-render-spec.json");
await writeFile(
  specPath,
  JSON.stringify({
    jobs: [
      {
        key: "icon",
        svgBase64: (await readFile(SVG_PATH)).toString("base64"),
        width: 1024,
        height: 1024,
        rotation: 0,
        pngPath: PNG_PATH,
      },
    ],
  }),
  "utf8",
);

const electron = join(ROOT, "node_modules", ".bin", "electron");
execFileSync(electron, [join(ROOT, "tools", "render-maps.cjs"), specPath], { stdio: "inherit" });

// 2) 由 PNG 生成各尺寸，再封装成 ICO（ICO 允许直接内嵌 PNG 数据）
const entries = [];
for (const size of ICO_SIZES) {
  const target = join(BUILD_DIR, `icon-${size}.png`);
  execFileSync("sips", ["-z", String(size), String(size), PNG_PATH, "--out", target], { stdio: "ignore" });
  entries.push({ size, data: await readFile(target) });
}

const headerSize = 6 + entries.length * 16;
let offset = headerSize;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(entries.length, 4);

entries.forEach((entry, index) => {
  const base = 6 + index * 16;
  const dimension = entry.size >= 256 ? 0 : entry.size; // 256 用 0 表示
  header.writeUInt8(dimension, base);
  header.writeUInt8(dimension, base + 1);
  header.writeUInt8(0, base + 2); // 调色板数
  header.writeUInt8(0, base + 3); // reserved
  header.writeUInt16LE(1, base + 4); // color planes
  header.writeUInt16LE(32, base + 6); // bits per pixel
  header.writeUInt32LE(entry.data.byteLength, base + 8);
  header.writeUInt32LE(offset, base + 12);
  offset += entry.data.byteLength;
});

await writeFile(ICO_PATH, Buffer.concat([header, ...entries.map((entry) => entry.data)]));

// 3) 复制一份给渲染进程的静态资源，供主进程设置窗口/任务栏图标
await writeFile(PUBLIC_PATH, await readFile(PNG_PATH));

console.log(`已生成 ${PNG_PATH}`);
console.log(`已生成 ${ICO_PATH}（含 ${ICO_SIZES.join("/")} 六个尺寸）`);
console.log(`已生成 ${PUBLIC_PATH}`);
