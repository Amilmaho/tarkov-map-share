import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

const SAMPLE =
  "2026-09-19[10-30]_-323.69, 2.44, -225.63_0.02332, 0.54903, -0.01533, 0.83534_15.72 (0).png";

/**
 * 端到端验证「截图文件名 → 界面」这条链路：
 * 主进程扫描目录 → 解析 → IPC → 渲染进程状态 → 侧栏显示坐标。
 *
 * 用 TMS_SCREENSHOT_DIR 把监听目录指到临时目录，避免碰真实游戏目录。
 */
test("截图目录里出现新文件后，界面上能看到坐标", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tms-e2e-screenshots-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, TMS_SCREENSHOT_DIR: directory },
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("heading", { name: "截图目录" })).toBeVisible();
    await expect(window.getByText("监听中")).toBeVisible();
    await expect(window.getByText("还没有位置。")).toBeVisible();

    await writeFile(join(directory, SAMPLE), "png");

    // 轮询间隔 1 秒，给足余量
    // 精确匹配侧栏里那行坐标（提示条里也会出现同样的数字）
    await expect(window.getByText("(-323.7, -225.6)", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText("游戏截图")).toBeVisible();

    // 还没标定，必须明确告诉用户"坐标有，但画不到图上"
    await expect(window.getByText(/已读到坐标/)).toBeVisible();
    await expect(window.getByText(/地图还没有标定/)).toBeVisible();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
