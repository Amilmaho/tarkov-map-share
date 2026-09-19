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
  const userData = await mkdtemp(join(tmpdir(), "tms-e2e-userdata-"));
  const app = await electron.launch({
    args: [".", `--user-data-dir=${userData}`],
    env: { ...process.env, TMS_SCREENSHOT_DIR: directory },
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("heading", { name: "截图目录" })).toBeVisible();
    await expect(window.getByText("监听中")).toBeVisible();
    await expect(window.getByText("还没有位置。")).toBeVisible();

    await writeFile(join(directory, SAMPLE), "png");

    // 轮询间隔 1 秒，给足余量
    // 等地图画出来，再记录整块画布的指纹，稍后确认"点真的画上去了"
    await expect.poll(async () => await canvasSignature(window), { timeout: 10_000 }).toBeGreaterThan(0);
    const canvasBefore = await canvasSignature(window);

    // 精确匹配侧栏里那行坐标（提示条里也会出现同样的数字）
    await expect(window.getByText("(-323.7, -225.6)", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText("游戏截图")).toBeVisible();

    // 预置标定已经生效，所以画布应当被重绘（多出"我"的点、朝向箭头与标签）
    await expect
      .poll(async () => (await canvasSignature(window)) !== canvasBefore, {
        message: "收到位置后画布应当重绘",
        timeout: 10_000,
      })
      .toBe(true);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

/** 整块画布的指纹，用来判断画布内容是否发生变化 */
async function canvasSignature(window: import("@playwright/test").Page): Promise<number> {
  return await window.evaluate(() => {
    const element = document.querySelector("canvas");
    if (element === null) return 0;
    const ctx = element.getContext("2d");
    if (ctx === null) return 0;
    const data = ctx.getImageData(0, 0, element.width, element.height).data;
    let sum = 0;
    for (let index = 0; index < data.length; index += 16) {
      sum = (sum + (data[index] ?? 0) + (data[index + 3] ?? 0)) % 2_147_483_647;
    }
    return sum;
  });
}
