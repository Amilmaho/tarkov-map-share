/**
 * 画布视图变换：图像像素 → 屏幕（CSS 像素）。
 *
 * ```text
 * sx = px * scale + offsetX
 * sy = py * scale + offsetY
 * ```
 */

import { type Matrix3, imageToWorld, worldToImage } from "./homography";

export type Viewport = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type ImagePoint = { px: number; py: number };
export type ScreenPoint = { sx: number; sy: number };

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) throw new Error("缩放倍数必须是有限数");
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function createViewport(overrides: Partial<Viewport> = {}): Viewport {
  return {
    scale: clampScale(overrides.scale ?? 1),
    offsetX: overrides.offsetX ?? 0,
    offsetY: overrides.offsetY ?? 0,
  };
}

export function imageToScreen(viewport: Viewport, point: ImagePoint): ScreenPoint {
  return {
    sx: point.px * viewport.scale + viewport.offsetX,
    sy: point.py * viewport.scale + viewport.offsetY,
  };
}

export function screenToImage(viewport: Viewport, point: ScreenPoint): ImagePoint {
  if (viewport.scale === 0) throw new Error("缩放倍数不能为 0");
  return {
    px: (point.sx - viewport.offsetX) / viewport.scale,
    py: (point.sy - viewport.offsetY) / viewport.scale,
  };
}

export function worldToScreen(
  viewport: Viewport,
  homography: Matrix3,
  world: { x: number; z: number },
): ScreenPoint {
  return imageToScreen(viewport, worldToImage(homography, world));
}

export function screenToWorld(
  viewport: Viewport,
  homography: Matrix3,
  screen: ScreenPoint,
): { x: number; z: number } {
  return imageToWorld(homography, screenToImage(viewport, screen));
}

/**
 * 以某个屏幕点为锚点缩放：该点下方的图像内容保持不动。
 *
 * 注意 `nextScale` 会先被限制在 [MIN_SCALE, MAX_SCALE]，
 * 因此当缩放已经到达上下限时返回的视图与传入视图一致。
 */
export function zoomAtPoint(viewport: Viewport, anchor: ScreenPoint, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const ratio = scale / viewport.scale;
  return {
    scale,
    offsetX: anchor.sx - (anchor.sx - viewport.offsetX) * ratio,
    offsetY: anchor.sy - (anchor.sy - viewport.offsetY) * ratio,
  };
}

/**
 * 让整张地图在给定画布尺寸内居中显示。
 *
 * 适配视图允许低于 `MIN_SCALE`（大图塞进小画布时是必要的），
 * 但不会超过 `MAX_SCALE`；`MIN_SCALE` 只约束用户手动缩放。
 */
export function fitToViewport(
  imageSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
): Viewport {
  if (imageSize.width <= 0 || imageSize.height <= 0) throw new Error("图像尺寸必须为正数");
  if (canvasSize.width <= 0 || canvasSize.height <= 0) throw new Error("画布尺寸必须为正数");

  const fitted = Math.min(canvasSize.width / imageSize.width, canvasSize.height / imageSize.height);
  const scale = Math.min(MAX_SCALE, fitted);
  return {
    scale,
    offsetX: (canvasSize.width - imageSize.width * scale) / 2,
    offsetY: (canvasSize.height - imageSize.height * scale) / 2,
  };
}
