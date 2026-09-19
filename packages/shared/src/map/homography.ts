/**
 * 世界坐标 (x, z) ↔ 地图像素坐标 (px, py) 的单应变换。
 *
 * 实现要点：
 * 1. 先用 Hartley 归一化把两组点平移到原点、缩放到平均距离 √2，避免像素量级
 *    （数千）与米级坐标混在一起导致求解精度丢失。
 * 2. 在归一化空间内用最小二乘（正规方程 + 高斯消元）解出 8 个参数。
 * 3. 再反归一化回原始坐标空间。
 *
 * 控制点共线或重复时矩阵秩亏，会抛出可读错误，由调用方提示重新校准。
 */

/** 行优先的 3×3 矩阵 */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export type MappingPoint = {
  world: { x: number; z: number };
  image: { px: number; py: number };
};

const MIN_CONTROL_POINTS = 4;
const MIN_SIMILARITY_POINTS = 2;
const MIN_AFFINE_POINTS = 3;
const SINGULAR_TOLERANCE = 1e-12;

function at(matrix: Matrix3, index: number): number {
  const value = matrix[index];
  if (value === undefined) throw new Error(`矩阵索引越界: ${index}`);
  return value;
}

function cell(matrix: number[][], row: number, column: number): number {
  const targetRow = matrix[row];
  if (targetRow === undefined) throw new Error(`矩阵行越界: ${row}`);
  const value = targetRow[column];
  if (value === undefined) throw new Error(`矩阵列越界: ${column}`);
  return value;
}

function setCell(matrix: number[][], row: number, column: number, value: number): void {
  const targetRow = matrix[row];
  if (targetRow === undefined) throw new Error(`矩阵行越界: ${row}`);
  targetRow[column] = value;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} 必须是有限数`);
}

/** 行优先 3×3 矩阵乘法 */
export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const result: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        sum += at(a, row * 3 + k) * at(b, k * 3 + column);
      }
      result.push(sum);
    }
  }
  return result as unknown as Matrix3;
}

/** 3×3 矩阵求逆；奇异时抛错 */
export function invertMatrix3(matrix: Matrix3): Matrix3 {
  const a = at(matrix, 0);
  const b = at(matrix, 1);
  const c = at(matrix, 2);
  const d = at(matrix, 3);
  const e = at(matrix, 4);
  const f = at(matrix, 5);
  const g = at(matrix, 6);
  const h = at(matrix, 7);
  const i = at(matrix, 8);

  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15) {
    throw new Error("矩阵不可逆：行列式接近 0");
  }

  const inverse: number[] = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
  return inverse as unknown as Matrix3;
}

/** 齐次投影：输入 (u, v)，输出 (a, b)；分母接近 0 时抛错 */
function project(matrix: Matrix3, u: number, v: number): { a: number; b: number } {
  const denominator = at(matrix, 6) * u + at(matrix, 7) * v + at(matrix, 8);
  if (Math.abs(denominator) < 1e-12) {
    throw new Error("单应变换退化：齐次分母接近 0");
  }
  return {
    a: (at(matrix, 0) * u + at(matrix, 1) * v + at(matrix, 2)) / denominator,
    b: (at(matrix, 3) * u + at(matrix, 4) * v + at(matrix, 5)) / denominator,
  };
}

/**
 * 归一化矩阵：把 (x, y) 平移到原点并按 scale 缩放。
 *
 * 注意两个轴都要减各自的中心——只减一个轴会让反归一化后的单应矩阵带上一个常量偏移，
 * 结果就是"控制点自洽但整体错位"。世界坐标与像素坐标共用这一份实现。
 */
function makeTranslationScale(centerX: number, centerY: number, scale: number): Matrix3 {
  return [scale, 0, -scale * centerX, 0, scale, -scale * centerY, 0, 0, 1];
}

/** 高斯消元（列主元）求解 n 元线性方程组 */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const augmented: number[][] = [];
  for (let row = 0; row < size; row += 1) {
    const sourceRow = matrix[row];
    if (sourceRow === undefined) throw new Error(`矩阵行越界: ${row}`);
    augmented.push([...sourceRow, rhs[row] ?? 0]);
  }

  let maxAbs = 0;
  for (const row of augmented) {
    for (const value of row) maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  const tolerance = maxAbs * SINGULAR_TOLERANCE;

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotValue = Math.abs(cell(augmented, column, column));
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(cell(augmented, row, column));
      if (candidate > pivotValue) {
        pivotValue = candidate;
        pivotRow = row;
      }
    }

    if (pivotValue <= tolerance) {
      throw new Error("控制点退化：无法求解单应矩阵（控制点共线、重复或数量不足）");
    }

    if (pivotRow !== column) {
      const temp = augmented[column];
      const swap = augmented[pivotRow];
      if (temp === undefined || swap === undefined) throw new Error("矩阵行越界");
      augmented[column] = swap;
      augmented[pivotRow] = temp;
    }

    const pivot = cell(augmented, column, column);
    for (let row = column + 1; row < size; row += 1) {
      const factor = cell(augmented, row, column) / pivot;
      if (factor === 0) continue;
      for (let k = column; k <= size; k += 1) {
        setCell(augmented, row, k, cell(augmented, row, k) - factor * cell(augmented, column, k));
      }
    }
  }

  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = cell(augmented, row, size);
    for (let column = row + 1; column < size; column += 1) {
      sum -= cell(augmented, row, column) * (solution[column] ?? 0);
    }
    solution[row] = sum / cell(augmented, row, row);
  }
  return solution;
}

/**
 * 由控制点求解单应矩阵。
 *
 * @throws 控制点少于 4 个、坐标非有限数、或控制点退化时抛错
 */
export function solveHomography(points: readonly MappingPoint[]): Matrix3 {
  if (points.length < MIN_CONTROL_POINTS) {
    throw new Error(`单应变换至少需要 ${MIN_CONTROL_POINTS} 个控制点，当前只有 ${points.length} 个`);
  }

  for (const point of points) {
    assertFinite(point.world.x, "控制点 world.x");
    assertFinite(point.world.z, "控制点 world.z");
    assertFinite(point.image.px, "控制点 image.px");
    assertFinite(point.image.py, "控制点 image.py");
  }

  const worldCenterX = points.reduce((sum, p) => sum + p.world.x, 0) / points.length;
  const worldCenterZ = points.reduce((sum, p) => sum + p.world.z, 0) / points.length;
  const worldDistance =
    points.reduce((sum, p) => sum + Math.hypot(p.world.x - worldCenterX, p.world.z - worldCenterZ), 0) /
    points.length;
  if (worldDistance < 1e-9) {
    throw new Error("控制点退化：所有世界坐标几乎重合");
  }
  const worldScale = Math.SQRT2 / worldDistance;
  const worldTransform = makeTranslationScale(worldCenterX, worldCenterZ, worldScale);

  const imageCenterX = points.reduce((sum, p) => sum + p.image.px, 0) / points.length;
  const imageCenterY = points.reduce((sum, p) => sum + p.image.py, 0) / points.length;
  const imageDistance =
    points.reduce((sum, p) => sum + Math.hypot(p.image.px - imageCenterX, p.image.py - imageCenterY), 0) /
    points.length;
  if (imageDistance < 1e-9) {
    throw new Error("控制点退化：所有像素坐标几乎重合");
  }
  const imageScale = Math.SQRT2 / imageDistance;
  const imageTransform = makeTranslationScale(imageCenterX, imageCenterY, imageScale);

  const normalized: MappingPoint[] = points.map((point) => ({
    world: {
      x: worldScale * (point.world.x - worldCenterX),
      z: worldScale * (point.world.z - worldCenterZ),
    },
    image: {
      px: imageScale * (point.image.px - imageCenterX),
      py: imageScale * (point.image.py - imageCenterY),
    },
  }));

  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const point of normalized) {
    const { x, z } = point.world;
    const { px, py } = point.image;
    rows.push([x, z, 1, 0, 0, 0, -px * x, -px * z]);
    rhs.push(px);
    rows.push([0, 0, 0, x, z, 1, -py * x, -py * z]);
    rhs.push(py);
  }

  // 正规方程：AᵀA · h = Aᵀb（控制点多于 4 个时自动变成最小二乘）
  const parameters = 8;
  const normal: number[][] = [];
  for (let row = 0; row < parameters; row += 1) {
    normal.push(new Array<number>(parameters).fill(0));
  }
  const normalRhs = new Array<number>(parameters).fill(0);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const target = rhs[index] ?? 0;
    for (let i = 0; i < parameters; i += 1) {
      const left = row[i] ?? 0;
      if (left === 0) continue;
      normalRhs[i] = (normalRhs[i] ?? 0) + left * target;
      for (let j = 0; j < parameters; j += 1) {
        setCell(normal, i, j, cell(normal, i, j) + left * (row[j] ?? 0));
      }
    }
  }

  const solution = solveLinearSystem(normal, normalRhs);
  const normalizedHomography: Matrix3 = [
    solution[0] ?? 0,
    solution[1] ?? 0,
    solution[2] ?? 0,
    solution[3] ?? 0,
    solution[4] ?? 0,
    solution[5] ?? 0,
    solution[6] ?? 0,
    solution[7] ?? 0,
    1,
  ];

  const denormalizeImage = invertMatrix3(imageTransform);
  return multiplyMatrix3(multiplyMatrix3(denormalizeImage, normalizedHomography), worldTransform);
}

/**
 * 由 2 个及以上控制点求解**相似变换**（等比缩放 + 旋转 + 平移）。
 *
 * 适合"地图素材等比绘制、没有透视畸变"的情况（本项目用的矢量图正是如此）：
 * 只要两个点就能定出来，比四点单应省事得多。
 *
 * 模型：px = a·x − b·z + tx，py = b·x + a·z + ty
 */
export function solveSimilarity(points: readonly MappingPoint[]): Matrix3 {
  if (points.length < MIN_SIMILARITY_POINTS) {
    throw new Error(`相似变换至少需要 ${MIN_SIMILARITY_POINTS} 个控制点，当前只有 ${points.length} 个`);
  }
  assertFinitePoints(points);

  const count = points.length;
  const worldMeanX = points.reduce((sum, point) => sum + point.world.x, 0) / count;
  const worldMeanZ = points.reduce((sum, point) => sum + point.world.z, 0) / count;
  const imageMeanX = points.reduce((sum, point) => sum + point.image.px, 0) / count;
  const imageMeanY = points.reduce((sum, point) => sum + point.image.py, 0) / count;

  let squares = 0;
  let sumA = 0;
  let sumB = 0;
  for (const point of points) {
    const dx = point.world.x - worldMeanX;
    const dz = point.world.z - worldMeanZ;
    const dpx = point.image.px - imageMeanX;
    const dpy = point.image.py - imageMeanY;
    squares += dx * dx + dz * dz;
    sumA += dx * dpx + dz * dpy;
    sumB += dx * dpy - dz * dpx;
  }

  if (squares < 1e-12) {
    throw new Error("控制点退化：所有世界坐标几乎重合");
  }

  const a = sumA / squares;
  const b = sumB / squares;
  const tx = imageMeanX - (a * worldMeanX - b * worldMeanZ);
  const ty = imageMeanY - (b * worldMeanX + a * worldMeanZ);

  return [a, -b, tx, b, a, ty, 0, 0, 1];
}

/**
 * 由 3 个及以上控制点求解**仿射变换**（允许 x、z 两轴比例不同）。
 *
 * 介于相似变换与单应之间：能吸收素材被非等比拉伸的情况，3 个点即可。
 */
export function solveAffine(points: readonly MappingPoint[]): Matrix3 {
  if (points.length < MIN_AFFINE_POINTS) {
    throw new Error(`仿射变换至少需要 ${MIN_AFFINE_POINTS} 个控制点，当前只有 ${points.length} 个`);
  }
  assertFinitePoints(points);

  const fitAxis = (target: (point: MappingPoint) => number): number[] => {
    const normal = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const rhs = [0, 0, 0];

    for (const point of points) {
      const row = [point.world.x, point.world.z, 1];
      const value = target(point);
      for (let i = 0; i < 3; i += 1) {
        const left = row[i] ?? 0;
        rhs[i] = (rhs[i] ?? 0) + left * value;
        for (let j = 0; j < 3; j += 1) {
          setCell(normal, i, j, cell(normal, i, j) + left * (row[j] ?? 0));
        }
      }
    }

    return solveLinearSystem(normal, rhs);
  };

  const forX = fitAxis((point) => point.image.px);
  const forY = fitAxis((point) => point.image.py);

  return [
    forX[0] ?? 0,
    forX[1] ?? 0,
    forX[2] ?? 0,
    forY[0] ?? 0,
    forY[1] ?? 0,
    forY[2] ?? 0,
    0,
    0,
    1,
  ];
}

export type MappingModel = "similarity" | "affine" | "homography";

/**
 * 按控制点数量自动选择模型：
 * 2 点 → 相似变换；3 点 → 仿射；4 点及以上 → 单应（最准，能吃透视）。
 */
export function solveMapping(points: readonly MappingPoint[]): { model: MappingModel; matrix: Matrix3 } {
  if (points.length >= MIN_CONTROL_POINTS) {
    return { model: "homography", matrix: solveHomography(points) };
  }
  if (points.length >= MIN_AFFINE_POINTS) {
    return { model: "affine", matrix: solveAffine(points) };
  }
  if (points.length >= MIN_SIMILARITY_POINTS) {
    return { model: "similarity", matrix: solveSimilarity(points) };
  }
  throw new Error(`标定至少需要 ${MIN_SIMILARITY_POINTS} 个控制点，当前只有 ${points.length} 个`);
}

function assertFinitePoints(points: readonly MappingPoint[]): void {
  for (const point of points) {
    assertFinite(point.world.x, "控制点 world.x");
    assertFinite(point.world.z, "控制点 world.z");
    assertFinite(point.image.px, "控制点 image.px");
    assertFinite(point.image.py, "控制点 image.py");
  }
}

/** 世界坐标 → 地图像素坐标 */
export function worldToImage(
  homography: Matrix3,
  point: { x: number; z: number },
): { px: number; py: number } {
  const projected = project(homography, point.x, point.z);
  return { px: projected.a, py: projected.b };
}

/** 地图像素坐标 → 世界坐标（仅平面 x、z；高度由调用方保留） */
export function imageToWorld(
  homography: Matrix3,
  point: { px: number; py: number },
): { x: number; z: number } {
  const projected = project(invertMatrix3(homography), point.px, point.py);
  return { x: projected.a, z: projected.b };
}

/** 控制点重投影误差（像素，均方根） */
export function reprojectionError(homography: Matrix3, points: readonly MappingPoint[]): number {
  if (points.length === 0) throw new Error("计算重投影误差至少需要一个控制点");

  let sum = 0;
  for (const point of points) {
    const projected = worldToImage(homography, point.world);
    sum += (projected.px - point.image.px) ** 2 + (projected.py - point.image.py) ** 2;
  }
  return Math.sqrt(sum / points.length);
}
