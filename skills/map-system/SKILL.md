---
name: map-system
description: >-
  Work on the map layer of tarkov-map-share: world/image/screen coordinate
  conversion, calibration files, pan and zoom viewport, marker rendering and map
  assets. Use when touching map rendering, coordinates, calibration, zoom/pan
  interaction, or adding a new map.
---

# 地图系统

## 铁律

1. 所有坐标换算只存在于 `packages/shared/src/map`；UI 只调用，不自己算。
2. 每张地图必须有校准数据与验证测试，否则不允许进入产品。
3. 世界坐标只使用 XZ 平面定位，`y`（高度）不参与地图定位。

## 三套坐标

```text
world  { x, y, z }   米         X 东为正、Z 北为正、Y 向上
image  { px, py }    图片像素    原点左上，py 向下
screen { sx, sy }    CSS 像素    画布左上
```

换算链：`world → (homography) → image → (viewport) → screen`

详细定义见 [../../docs/MAP_COORDINATES.md](../../docs/MAP_COORDINATES.md)。

## 共享层 API 契约

```ts
type Calibration = {
  mapId: string;
  image: { src: string; width: number; height: number };
  controlPoints: { world: { x: number; z: number }; image: { px: number; py: number } }[];
};

function solveHomography(cp: ControlPoint[]): Homography;   // 4 点，退化时报错
function worldToImage(h: Homography, p: { x: number; z: number }): { px: number; py: number };
function imageToWorld(h: Homography, p: { px: number; py: number }): { x: number; z: number };
function worldToScreen(vp: Viewport, h: Homography, p: { x: number; z: number }): { sx: number; sy: number };
function screenToWorld(vp: Viewport, h: Homography, p: { sx: number; sy: number }): { x: number; z: number };
function reprojectionError(h: Homography, cp: ControlPoint[]): number;
```

实现要点：

* 用 DLT 解 8 个未知量，`h33 = 1`。
* 控制点共线或重复 → 抛出可读错误（提示重新校准），不要返回 `NaN`。
* 结果缓存：同一地图只求解一次。

## 视图交互

```ts
type Viewport = { scale: number; offsetX: number; offsetY: number };
```

* 缩放范围 `0.2x ~ 8x`，滚轮缩放以鼠标为锚点：
  `offset' = cursor - (cursor - offset) * (scale' / scale)`
* 平移使用指针拖拽；拖拽中不要触发打点。
* 提供"复位视图"与"跟随队友"两种预设。
* Canvas 按 `devicePixelRatio` 放大后备缓冲，避免高分屏模糊。

## 渲染分层

```text
layer 0  地图位图（缓存为 ImageBitmap，缩放时重绘而非重新解码）
layer 1  路线与区域
layer 2  标记
layer 3  玩家与朝向
layer 4  悬浮信息 / 十字准星
```

性能规则：

* 每帧只重绘变化层；地图位图用离屏缓存。
* 玩家位置更新用 `requestAnimationFrame` 节流，不做逐消息重绘。
* 数量 > 500 的标记启用聚合或视口裁剪。

## 新增一张地图

```
Task Progress:
- [ ] 1. 准备地图图片，记录来源与许可（写入 docs/MAP_COORDINATES.md 资源清单）
- [ ] 2. 选 4 个易辨认地标，填写 maps/<mapId>/calibration.json
- [ ] 3. 运行校准校验，确认验证点误差 ≤ 2 像素
- [ ] 4. 在 shared 的地图注册表登记元数据（尺寸、包围盒、名称）
- [ ] 5. 增加坐标测试用例（含 1 个越界点）
- [ ] 6. 在桌面端确认标记落点与缩放平移正常
```

## 必须覆盖的测试

* 4 个控制点自洽误差 ≤ 0.01 像素。
* 额外验证点误差 ≤ 2 像素。
* 随机 1000 点往返误差 ≤ 0.5 米。
* 缩放锚点不漂移；缩放 + 平移结果与解析解一致。
* 共线/重复控制点抛错；越界坐标不产生 `NaN`。

## 反模式

| 反模式 | 问题 |
| --- | --- |
| 在组件里写 `px = (x + 300) * 2` 这类硬编码 | 换地图即错，且无法测试 |
| 用 3 点仿射却声明支持旋转地图 | 系统性偏移 |
| 每次 render 重新解码图片 | 卡顿、内存暴涨 |
| 直接用第三方坐标约定 | 与项目约定冲突，产生隐性偏移 |
