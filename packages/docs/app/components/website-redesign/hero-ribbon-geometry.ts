export interface RibbonSheet {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface RibbonSheetOptions {
  size?: number;
  columns?: number;
  rows?: number;
}

const BEND_HALF_WIDTH = 16;

/**
 * Radius of the hairpin bend at a point along the ribbon's length: 4 at both
 * ends, narrowing to 2 through the middle.
 */
export function bendRadius(v: number): number {
  return 4 - 2 * (4 * v * (1 - v)) ** 9.5;
}

/**
 * Folds a flat grid coordinate around a half-cylinder so the left and right
 * halves of the sheet lie on top of each other, then shifts the fold so both
 * halves cover the same span.
 */
export function foldPoint(
  x: number,
  v: number,
  size: number,
): [x: number, z: number] {
  const radius = bendRadius(v);
  let foldedX = x;
  let z: number;
  if (x < -BEND_HALF_WIDTH) {
    z = radius;
  } else if (x < BEND_HALF_WIDTH) {
    const t = (x + BEND_HALF_WIDTH) / (2 * BEND_HALF_WIDTH);
    z = Math.cos(t * Math.PI) * radius;
    foldedX = Math.cos(t * Math.PI - Math.PI / 2) * radius - BEND_HALF_WIDTH;
  } else {
    z = -radius;
    foldedX = -x;
  }
  return [foldedX + size / 4, z];
}

/**
 * Builds the folded ribbon sheet. Each vertex is folded in its own plane and
 * then turned a quarter turn about X and a quarter turn about Y (both
 * clockwise), which maps (x, y, z) to (y, z, x).
 */
export function buildRibbonSheet({
  size = 400,
  columns = 128,
  rows = 256,
}: RibbonSheetOptions = {}): RibbonSheet {
  const stride = columns + 1;
  const vertexCount = stride * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const cellWidth = size / columns;
  const cellHeight = size / rows;

  for (let row = 0; row <= rows; row += 1) {
    const y = size / 2 - row * cellHeight;
    const v = 1 - row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const index = row * stride + column;
      const [x, z] = foldPoint(column * cellWidth - size / 2, v, size);
      positions[index * 3] = y;
      positions[index * 3 + 1] = z;
      positions[index * 3 + 2] = x;
      uvs[index * 2] = column / columns;
      uvs[index * 2 + 1] = v;
    }
  }

  const indices = new Uint32Array(columns * rows * 6);
  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * stride + column;
      const bottomLeft = topLeft + stride;
      indices.set(
        [
          topLeft,
          bottomLeft,
          topLeft + 1,
          bottomLeft,
          bottomLeft + 1,
          topLeft + 1,
        ],
        cursor,
      );
      cursor += 6;
    }
  }

  return { positions, uvs, indices };
}
