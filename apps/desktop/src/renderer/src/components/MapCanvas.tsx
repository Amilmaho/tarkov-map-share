import { useEffect, useRef, useState } from "react";

import {
  imageToScreen,
  screenToImage,
  screenToWorld,
  worldToScreen,
} from "@tarkov-map-share/shared";

import { findMap } from "../maps";
import { MARKER_KIND_COLORS, useMapStore } from "../store";

const MARKER_RADIUS = 7;
const PLAYER_RADIUS = 8;
const HEADING_PROBE_METERS = 12;
const CLICK_TOLERANCE_PX = 14;

type ScreenPoint = { sx: number; sy: number };

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.font = "12px system-ui, sans-serif";
  const width = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(8, 10, 14, 0.72)";
  ctx.fillRect(x - 3, y - 11, width + 8, 17);
  ctx.fillStyle = "#f2f5f9";
  ctx.fillText(text, x + 1, y + 1);
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  point: ScreenPoint,
  color: string,
  label: string,
  selected: boolean,
): void {
  ctx.beginPath();
  ctx.arc(point.sx, point.sy, selected ? MARKER_RADIUS + 1.5 : MARKER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeStyle = selected ? "#ffffff" : "rgba(6, 8, 12, 0.75)";
  ctx.stroke();
  drawLabel(ctx, point.sx + 12, point.sy + 4, label);
}

function drawPlayer(ctx: CanvasRenderingContext2D, point: ScreenPoint, ahead: ScreenPoint): void {
  const angle = Math.atan2(ahead.sy - point.sy, ahead.sx - point.sx);

  ctx.save();
  ctx.translate(point.sx, point.sy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(PLAYER_RADIUS + 11, 0);
  ctx.lineTo(PLAYER_RADIUS - 1, -6);
  ctx.lineTo(PLAYER_RADIUS - 1, 6);
  ctx.closePath();
  ctx.fillStyle = "#4c8dff";
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(point.sx, point.sy, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#4c8dff";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  drawLabel(ctx, point.sx + 14, point.sy - 8, "我");
}

function drawCalibrationPoint(
  ctx: CanvasRenderingContext2D,
  point: ScreenPoint,
  index: number,
  hasWorld: boolean,
): void {
  const size = 9;
  ctx.lineWidth = 2;
  ctx.strokeStyle = hasWorld ? "#3ecf8e" : "#f5a524";
  ctx.beginPath();
  ctx.moveTo(point.sx - size, point.sy);
  ctx.lineTo(point.sx + size, point.sy);
  ctx.moveTo(point.sx, point.sy - size);
  ctx.lineTo(point.sx, point.sy + size);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(point.sx, point.sy, 4, 0, Math.PI * 2);
  ctx.fillStyle = hasWorld ? "#3ecf8e" : "#f5a524";
  ctx.fill();

  drawLabel(ctx, point.sx + 12, point.sy + 4, `控制点 ${index}`);
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.sx - b.sx, a.sy - b.sy);
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const viewportRef = useRef(useMapStore.getState().viewport);

  const [imageReady, setImageReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mapId = useMapStore((state) => state.mapId);
  const viewport = useMapStore((state) => state.viewport);
  const canvasSize = useMapStore((state) => state.canvasSize);
  const fitted = useMapStore((state) => state.fitted);
  const markers = useMapStore((state) => state.markers);
  const selectedMarkerId = useMapStore((state) => state.selectedMarkerId);
  const self = useMapStore((state) => state.self);
  const homography = useMapStore((state) => state.homography);
  const mode = useMapStore((state) => state.mode);
  const markerKind = useMapStore((state) => state.markerKind);
  const draftPoints = useMapStore((state) => state.draftPoints);

  const map = findMap(mapId);
  viewportRef.current = viewport;

  // 地图图片只加载一次
  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      imageRef.current = image;
      setImageReady(true);
      setLoadError(null);
    };
    image.onerror = () => {
      setImageReady(false);
      setLoadError("地图图片加载失败");
    };
    image.src = map.imageUrl;

    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [map.imageUrl]);

  // 容器尺寸变化 → 更新画布尺寸
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) return;
      useMapStore.getState().setCanvasSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 首次加载完成后自动适配视图
  useEffect(() => {
    if (imageReady && !fitted && canvasSize.width > 0) useMapStore.getState().fitView();
  }, [imageReady, fitted, canvasSize.width]);

  // 重绘：仅在依赖变化时执行，避免无意义的逐帧渲染
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || canvasSize.width <= 1 || canvasSize.height <= 1) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasSize.width * ratio);
    canvas.height = Math.round(canvasSize.height * ratio);

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const image = imageRef.current;
    if (image !== null) {
      ctx.save();
      ctx.translate(viewport.offsetX, viewport.offsetY);
      ctx.scale(viewport.scale, viewport.scale);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, map.width, map.height);
      ctx.restore();
    }

    draftPoints.forEach((point, index) => {
      drawCalibrationPoint(
        ctx,
        imageToScreen(viewport, point.image),
        index + 1,
        point.world !== null,
      );
    });

    if (homography !== null) {
      for (const marker of markers) {
        drawMarker(
          ctx,
          worldToScreen(viewport, homography, marker.position),
          marker.color ?? MARKER_KIND_COLORS[marker.kind],
          marker.label,
          marker.id === selectedMarkerId,
        );
      }

      if (self !== null) {
        const headingRadians = (self.headingDegrees * Math.PI) / 180;
        const aheadWorld = {
          x: self.position.x + HEADING_PROBE_METERS * Math.sin(headingRadians),
          y: self.position.y,
          z: self.position.z + HEADING_PROBE_METERS * Math.cos(headingRadians),
        };
        drawPlayer(
          ctx,
          worldToScreen(viewport, homography, self.position),
          worldToScreen(viewport, homography, aheadWorld),
        );
      }
    }
  }, [canvasSize, viewport, markers, selectedMarkerId, self, homography, draftPoints, map, imageReady]);

  // 滚轮缩放需要非被动监听，才能在滚动时阻止页面滚动
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * 0.0016);
      useMapStore.getState().zoomBy(factor, anchor);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  const handlePlacement = (point: ScreenPoint): void => {
    const state = useMapStore.getState();
    const currentViewport = viewportRef.current;

    if (state.mode === "calibrate") {
      state.addDraftPoint({ image: screenToImage(currentViewport, point), world: null });
      return;
    }

    if (state.mode === "marker") {
      const homography = state.homography;
      if (homography === null) {
        state.setNotice("请先完成地图标定，再在地图上打点");
        return;
      }
      const world = screenToWorld(currentViewport, homography, point);
      state.addMarker(state.markerKind, { x: world.x, y: 0, z: world.z });
      return;
    }

    if (state.mode === "self") {
      const homography = state.homography;
      if (homography === null) {
        state.setNotice("请先完成地图标定，再设置自己的位置");
        return;
      }
      const world = screenToWorld(currentViewport, homography, point);
      state.setSelfManual({ x: world.x, y: 0, z: world.z });
      return;
    }

    // 选择模式：点击已有标记则选中，点空白处取消选中
    const homography = state.homography;
    if (homography !== null) {
      const hit = state.markers.find(
        (marker) => distance(worldToScreen(currentViewport, homography, marker.position), point) < CLICK_TOLERANCE_PX,
      );
      state.selectMarker(hit?.id ?? null);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;

    if (deltaX !== 0 || deltaY !== 0) {
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      useMapStore.getState().panBy(deltaX, deltaY);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (drag.moved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    handlePlacement({ sx: event.clientX - rect.left, sy: event.clientY - rect.top });
  };

  return (
    <div className="map-canvas" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`map-canvas__surface map-canvas__surface--${mode}`}
        style={{ width: canvasSize.width, height: canvasSize.height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />

      {loadError !== null ? <div className="map-canvas__error">{loadError}</div> : null}
      {imageReady && homography === null && mode !== "calibrate" ? (
        <div className="map-canvas__hint">
          地图还没有标定：先在地图上点 4 个能认出来的地标，填入它们的世界坐标。
          <button type="button" className="btn btn--primary" onClick={() => useMapStore.getState().setMode("calibrate")}>
            开始标定
          </button>
        </div>
      ) : null}
    </div>
  );
}
