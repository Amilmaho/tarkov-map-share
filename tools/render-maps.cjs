/**
 * 用 Electron（Chromium）把 SVG 渲染成位图，支持按图层（楼层）渲染。
 *
 * 为什么不用 sips / rsvg：Chromium 是现成的、渲染质量最好的 SVG 渲染器，
 * 而且项目里已经有 Electron 依赖。
 *
 * 按图层渲染的原因是多楼层地图：把 SVG 内联进页面 → 只保留目标楼层的 <g>、
 * 把地面层压暗当底图 → 序列化回 SVG → 画进 canvas。
 * 用 <img> 直接加载 SVG 是控制不了分组的。
 *
 * 用法：electron tools/render-maps.cjs <spec.json>
 * spec: { jobs: [{ key, svgBase64, width, height, rotation, pngPath,
 *                  floors?: [{ key, visible, dimmed?, pngPath }] }] }
 * 不传 floors 时按原样渲染整张图。
 */

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

/** 只有这些 id 才当作"楼层"处理，其余分组原样保留 */
const FLOOR_GROUP_IDS = [
  "Ground_Level",
  "Ground_Floor",
  "First_Floor",
  "Second_Floor",
  "Third_Floor",
  "Fourth_Floor",
  "Fifth_Floor",
  "Underground_Level",
  "Basement",
  "Bunkers",
];

function buildScript(job) {
  const floors = job.floors === undefined ? null : job.floors;

  return `
    (async () => {
      const FLOOR_IDS = new Set(${JSON.stringify(FLOOR_GROUP_IDS)});
      const decodeBase64 = (base64) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
      };
      const encodeBase64 = (text) => {
        const bytes = new TextEncoder().encode(text);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      };

      const svgText = decodeBase64("${job.svgBase64}");
      const container = document.createElement("div");
      document.body.appendChild(container);

      const loadImage = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("SVG 渲染失败"));
          image.src = src;
        });

      const drawToPng = async (svgMarkup) => {
        const canvas = document.createElement("canvas");
        canvas.width = ${job.width};
        canvas.height = ${job.height};
        const ctx = canvas.getContext("2d");
        const image = await loadImage("data:image/svg+xml;base64," + encodeBase64(svgMarkup));

        ctx.translate(${job.width} / 2, ${job.height} / 2);
        ctx.rotate((${job.rotation} * Math.PI) / 180);
        const rotated = ${job.rotation} % 180 !== 0;
        const drawWidth = rotated ? ${job.height} : ${job.width};
        const drawHeight = rotated ? ${job.width} : ${job.height};
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        return canvas.toDataURL("image/png");
      };

      const floors = ${JSON.stringify(floors)};
      if (floors === null) {
        return [{ key: ${JSON.stringify(job.key)}, dataUrl: await drawToPng(svgText) }];
      }

      const results = [];
      for (const floor of floors) {
        container.innerHTML = svgText;
        const root = container.querySelector("svg");
        if (root === null) throw new Error("SVG 解析失败");
        if (container.querySelector("#" + floor.visible) === null) {
          throw new Error("找不到图层 " + floor.visible);
        }

        // 只保留目标楼层；dimmed（一般是地面层）压暗作底图，保留方位参考
        for (const group of root.querySelectorAll(":scope > g[id]")) {
          const id = group.getAttribute("id");
          if (id === floor.visible) continue;
          if (floor.dimmed !== undefined && id === floor.dimmed) {
            group.setAttribute("opacity", "0.22");
          } else if (id !== null && FLOOR_IDS.has(id)) {
            group.setAttribute("display", "none");
          }
        }

        results.push({ key: floor.key, dataUrl: await drawToPng(new XMLSerializer().serializeToString(root)) });
      }
      return results;
    })()
  `;
}

app.whenReady().then(async () => {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("缺少 spec 文件参数");
    app.exit(1);
    return;
  }

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const window = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { offscreen: true, contextIsolation: true },
  });
  await window.loadURL("data:text/html,<html><body></body></html>");

  try {
    for (const job of spec.jobs) {
      const results = await window.webContents.executeJavaScript(buildScript(job), true);

      for (const item of results) {
        const target =
          job.floors === undefined
            ? job.pngPath
            : (job.floors.find((floor) => floor.key === item.key)?.pngPath ?? job.pngPath);
        const base64 = String(item.dataUrl).replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(target, Buffer.from(base64, "base64"));
      }
      console.log(`已渲染 ${job.key}（${results.length} 张）`);
    }
  } catch (error) {
    console.error("渲染失败:", error);
    app.exit(1);
    return;
  }

  window.destroy();
  app.quit();
});
