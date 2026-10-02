#!/usr/bin/env node
/**
 * 打包前的准备：把外部依赖复制到桌面端自己的 node_modules。
 *
 * npm workspaces 会把依赖提升到仓库根目录，而 electron-builder 只会打包
 * 应用目录下的 dependencies；桌面端的产物里因此缺 `ws`（服务端要用它）。
 * `ws` 没有任何运行时依赖，直接复制即可。
 *
 * 用法：node tools/prepare-package.mjs
 */

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "node_modules", "ws");
const TARGET = join(ROOT, "apps", "desktop", "node_modules", "ws");

if (!existsSync(SOURCE)) {
  console.error(`找不到 ${SOURCE}，请先运行 npm install`);
  process.exit(1);
}

await mkdir(dirname(TARGET), { recursive: true });
await rm(TARGET, { recursive: true, force: true });
await cp(SOURCE, TARGET, { recursive: true });

const info = await stat(join(TARGET, "package.json"));
console.log(`已把 ws 复制到 apps/desktop/node_modules（${info.size} 字节的 package.json）`);
