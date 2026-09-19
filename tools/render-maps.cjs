/**
 * 用 Electron（Chromium）把 SVG 渲染成位图。
 *
 * 为什么不用 sips / rsvg：Chromium 是现成的、免费的、渲染质量最好的 SVG 渲染器，
 * 而且项目里已经有 Electron 依赖。这里把 SVG 作为 data: URL 画进 canvas，
 * 再按 coordinateRotation 旋转，最后导出 PNG（data: URL 不会污染 canvas）。
 *
 * 用法：electron tools/render-maps.cjs <spec.json>
 * spec: { jobs: [{ key, svgBase64, width, height, rotation, pngPath }] }
 */

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

async function renderJob(window, job) {
  const script = `
    (async () => {
      const canvas = document.createElement("canvas");
      canvas.width = ${job.width};
      canvas.height = ${job.height};
      const ctx = canvas.getContext("2d");
      const image = new Image();
      image.src = "data:image/svg+xml;base64,${job.svgBase64}";
      await image.decode();

      ctx.translate(${job.width} / 2, ${job.height} / 2);
      ctx.rotate((${job.rotation} * Math.PI) / 180);
      const rotated = ${job.rotation} % 180 !== 0;
      const drawWidth = rotated ? ${job.height} : ${job.width};
      const drawHeight = rotated ? ${job.width} : ${job.height};
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      return canvas.toDataURL("image/png");
    })()
  `;

  const dataUrl = await window.webContents.executeJavaScript(script, true);
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(job.pngPath, Buffer.from(base64, "base64"));
}

app.whenReady().then(async () => {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("缺少 spec 文件参数");
    app.exit(1);
    return;
  }

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  // 窗口尺寸与画布无关，只需要一个能跑脚本的页面
  const window = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { offscreen: true, contextIsolation: true },
  });
  await window.loadURL("data:text/html,<html><body></body></html>");

  try {
    for (const job of spec.jobs) {
      await renderJob(window, job);
      console.log(`已渲染 ${job.key} → ${job.width}×${job.height}`);
    }
  } catch (error) {
    console.error("渲染失败:", error);
    app.exit(1);
    return;
  }

  window.destroy();
  app.quit();
});
