import {
  isEffectMeshSpec,
  type EffectMeshSpec,
} from "../../../../shared/effect-graph";

declare const GPUBufferUsage: Readonly<{ INDEX: number; COPY_DST: number }>;

const MAX_GRIDS_PER_DEVICE = 32;

type SharedGrid = {
  buffer: GPUBuffer;
  indexCount: number;
  bytes: number;
  references: number;
};

export type NativeMeshGridLease = Readonly<
  Pick<SharedGrid, "buffer" | "indexCount" | "bytes"> & {
    release: () => void;
  }
>;

const deviceGrids = new WeakMap<GPUDevice, Map<string, SharedGrid>>();

export function nativeMeshGridBytes(mesh: EffectMeshSpec): number {
  if (!isEffectMeshSpec(mesh)) throw new TypeError("Invalid native mesh grid");
  return mesh.columns * mesh.rows * 6 * Uint32Array.BYTES_PER_ELEMENT;
}

export function acquireNativeMeshGrid(
  device: GPUDevice,
  mesh: EffectMeshSpec,
): NativeMeshGridLease {
  const bytes = nativeMeshGridBytes(mesh);
  let grids = deviceGrids.get(device);
  if (!grids) {
    grids = new Map();
    deviceGrids.set(device, grids);
  }
  const key = `${mesh.columns}x${mesh.rows}`;
  let grid = grids.get(key);
  if (!grid) {
    if (grids.size >= MAX_GRIDS_PER_DEVICE)
      throw new RangeError("Native mesh grid cache is full");
    const indices = new Uint32Array(bytes / Uint32Array.BYTES_PER_ELEMENT);
    const stride = mesh.columns + 1;
    let offset = 0;
    for (let row = 0; row < mesh.rows; row++) {
      for (let column = 0; column < mesh.columns; column++) {
        const first = row * stride + column;
        const next = first + stride;
        indices.set(
          [first, first + 1, next, first + 1, next + 1, next],
          offset,
        );
        offset += 6;
      }
    }
    const buffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    try {
      device.queue.writeBuffer(buffer, 0, indices);
    } catch (error) {
      buffer.destroy();
      throw error;
    }
    grid = { buffer, indexCount: indices.length, bytes, references: 0 };
    grids.set(key, grid);
  }
  grid.references++;
  const acquired = grid;
  let released = false;
  return {
    buffer: acquired.buffer,
    indexCount: acquired.indexCount,
    bytes: acquired.bytes,
    release: () => {
      if (released) return;
      released = true;
      acquired.references--;
      if (acquired.references === 0) {
        acquired.buffer.destroy();
        grids.delete(key);
        if (grids.size === 0) deviceGrids.delete(device);
      }
    },
  };
}
