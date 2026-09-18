import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Electron 冒烟测试：真的把应用启动起来，确认界面渲染成功。
 *
 * 运行前需要先构建：`npm run build -w @tarkov-map-share/desktop`。
 */
test("启动后渲染出地图画布并画出地图内容", async () => {
  const app = await electron.launch({ args: ["."] });
  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle("塔科夫地图共享");

    // 侧栏与工具栏都在
    await expect(window.getByRole("heading", { name: "我的位置" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "截图目录" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "地图标定" })).toBeVisible();

    // 未标定时应提示先做标定
    await expect(window.getByText(/地图还没有标定/)).toBeVisible();

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
  }
});
