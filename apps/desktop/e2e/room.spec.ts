import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Phase 4 的端到端验证：应用内创建房间（本机当主机），
 * 走通「内嵌服务端 + WebSocket 客户端 + 界面」这条链路。
 */
test("创建房间后能看到房间码，自己出现在成员列表里", async () => {
  const userData = await mkdtemp(join(tmpdir(), "tms-e2e-room-"));
  const app = await electron.launch({ args: [".", `--user-data-dir=${userData}`] });

  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("heading", { name: "联机" })).toBeVisible();

    await window.getByLabel("昵称").fill("阿飞");
    await window.getByRole("button", { name: "创建房间（我是主机）" }).click();

    // 房间码是 6 位大写字母/数字
    await expect(window.locator(".room-code")).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/, { timeout: 10_000 });
    await expect(window.getByText("已连接")).toBeVisible();
    await expect(window.getByText("阿飞（我）")).toBeVisible();
    await expect(window.getByRole("button", { name: "复制邀请" })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
