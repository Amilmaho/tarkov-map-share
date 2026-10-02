import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

/**
 * 验证**打包产物**本身能跑：启动 .app、创建房间。
 *
 * 需要先 `npm run build:mac`；没构建时自动跳过。
 * 这一步能抓出"开发模式正常、打包后崩溃"的问题——比如依赖没被正确打进包里。
 */
const PACKAGED_APP = join(
  process.cwd(),
  "release",
  "mac-arm64",
  "tarkov-map-share.app",
  "Contents",
  "MacOS",
  "tarkov-map-share",
);

test.skip(!existsSync(PACKAGED_APP), "未构建 macOS 产物，跳过");

test("打包产物能启动并创建房间", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tms-e2e-packaged-"));
  const app = await electron.launch({
    executablePath: PACKAGED_APP,
    args: [`--user-data-dir=${userData}`],
  });

  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle("塔科夫地图共享", { timeout: 20_000 });

    // 地图渲染正常
    await expect(window.locator("canvas")).toBeVisible();
    await expect(window.getByRole("heading", { name: "联机" })).toBeVisible();

    // 内嵌服务端能在打包环境里跑起来
    await window.getByLabel("昵称").fill("阿飞");
    await window.getByRole("button", { name: "创建房间（我是主机）" }).click();
    await expect(window.locator(".room-code")).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/, { timeout: 15_000 });
    await expect(window.getByText("阿飞（我）")).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
