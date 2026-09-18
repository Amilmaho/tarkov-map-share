import { z } from "zod";

import { MapIdSchema } from "./common";

/** 世界坐标（平面）与地图像素坐标的配对控制点 */
export const ControlPointSchema = z.object({
  world: z.object({
    x: z.number().finite(),
    z: z.number().finite(),
  }),
  image: z.object({
    px: z.number().finite(),
    py: z.number().finite(),
  }),
  label: z.string().max(64).optional(),
});

/** `maps/<mapId>/calibration.json` 的结构 */
export const CalibrationSchema = z.object({
  mapId: MapIdSchema,
  image: z.object({
    src: z.string().min(1).max(256),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  rotation: z.number().finite().min(-180).max(180).default(0),
  controlPoints: z.array(ControlPointSchema).min(4, "至少需要 4 个控制点").max(64),
  source: z.object({
    name: z.string().min(1).max(128),
    url: z.string().max(512).optional(),
    license: z.string().min(1).max(128),
  }),
});

export const MapDocSchema = z.object({
  id: MapIdSchema,
  name: z.string().min(1).max(32),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  calibration: CalibrationSchema,
  bounds: z.object({
    minX: z.number().finite(),
    maxX: z.number().finite(),
    minZ: z.number().finite(),
    maxZ: z.number().finite(),
  }),
});

export type ControlPoint = z.infer<typeof ControlPointSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type MapDoc = z.infer<typeof MapDocSchema>;
