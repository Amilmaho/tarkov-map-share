import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Electron 冒烟测试：真的把应用启动起来，确认界面渲染成功。
 *
 * 运行前需要先构建：`npm run build -w @tarkov-map-share/desktop`。
 */
test("启动后渲染出地图画布并画出地图内容", async () => {
  // 独立的 userData 目录，避免读到上一轮测试留下的标定
  const userData = await mkdtemp(join(tmpdir(), "tms-e2e-userdata-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${userData}`] });
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle("塔科夫地图共享");

    // 侧栏与工具栏都在
    await expect(window.getByRole("heading", { name: "我的位置" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "截图目录" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "地图标定" })).toBeVisible();

    // 默认不套用未经核实的预置标定，而是提示先标定，并提供"试用预置标定"入口
    await expect(window.getByText(/地图还没有标定/)).toBeVisible();
    await expect(window.getByRole("button", { name: "试用预置标定" })).toBeVisible();

    // 地图选择器包含全部地图
    await expect(window.getByLabel("选择地图")).toBeVisible();
    await expect(window.getByLabel("选择地图").locator("option")).toHaveCount(10);

    // 海关是多楼层地图，工具栏应当出现楼层切换
    const floorGroup = window.getByRole("group", { name: "楼层" });
    await expect(floorGroup).toBeVisible();
    await expect(floorGroup.getByRole("button", { name: "2 层" })).toBeVisible();
    await floorGroup.getByRole("button", { name: "2 层" }).click();
    await expect(floorGroup.getByRole("button", { name: "2 层" })).toHaveAttribute("aria-pressed", "true");

    const canvas = window.locator("canvas");
    await expect(canvas).toBeVisible();

    // 画布中点的像素不透明 → 说明地图图片真的被画上去了
    await expect
      .poll(
        async () =>
          await window.evaluate(() => {
            const element = document.querySelector("canvas");
            if (element === null) return -1;
            const ctx = element.getContext("2d");
            if (ctx === null) return -1;
            const data = ctx.getImageData(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1).data;
            return data[3] ?? -1;
          }),
        { message: "地图像素应当被绘制到画布上", timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
