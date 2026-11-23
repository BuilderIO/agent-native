import { RIBBON_SHEET } from "./presets";

export interface RibbonSheet {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

/**
 * A square grid folded back on itself like a hairpin: the left part sits in
 * front, the right part is mirrored behind it, and a half-cylinder joins the
 * two. The result is turned so the grid's u axis runs along depth.
 */
export function buildRibbonSheet(): RibbonSheet {
  const { size, columns, rows, foldHalfWidth, foldGap, foldPinch } =
    RIBBON_SHEET;
  const stride = columns + 1;
  const vertexCount = stride * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let row = 0; row <= rows; row++) {
    const v = 1 - row / rows;
    const y = size / 2 - (row / rows) * size;
    const pinch = Math.pow(4 * v * (1 - v), foldPinch);
    const gap = foldGap - (foldGap / 2) * pinch;

    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      let x = -size / 2 + u * size;
      let z = 0;

      if (x < -foldHalfWidth) {
        z = gap;
      } else if (x < foldHalfWidth) {
        const t = (x + foldHalfWidth) / (2 * foldHalfWidth);
        z = Math.cos(t * Math.PI) * gap;
        x = Math.cos((t - 0.5) * Math.PI) * gap - foldHalfWidth;
      } else {
        z = -gap;
        x = -x;
      }
      x += size / 4;

      const i = row * stride + col;
      // Quarter turn about X, then about Y: (x, y, z) -> (y, z, x).
      positions[i * 3] = y;
      positions[i * 3 + 1] = z;
      positions[i * 3 + 2] = x;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
  }

  const indices = new Uint16Array(columns * rows * 6);
  let k = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const topLeft = row * stride + col;
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
        k,
      );
      k += 6;
    }
  }

  return { positions, uvs, indices };
}
