import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireNativeMeshGrid, nativeMeshGridBytes } from "./native-mesh-grid";

afterEach(() => vi.unstubAllGlobals());

describe("native mesh grid", () => {
  it("shares one indexed grid per device and releases it after the final renderer", () => {
    vi.stubGlobal("GPUBufferUsage", { INDEX: 1, COPY_DST: 2 });
    const buffer = { destroy: vi.fn() };
    const device = {
      queue: { writeBuffer: vi.fn() },
      createBuffer: vi.fn(() => buffer),
    } as unknown as GPUDevice;
    const mesh = { columns: 16, rows: 16 };
    const first = acquireNativeMeshGrid(device, mesh);
    const second = acquireNativeMeshGrid(device, mesh);
    expect(first.buffer).toBe(second.buffer);
    expect(first.indexCount).toBe(16 * 16 * 6);
    expect(first.bytes).toBe(nativeMeshGridBytes(mesh));
    expect(device.createBuffer).toHaveBeenCalledTimes(1);
    expect(device.queue.writeBuffer).toHaveBeenCalledTimes(1);
    const indices = vi.mocked(device.queue.writeBuffer).mock.calls[0]?.[2];
    expect(Array.from(indices as Uint32Array).slice(0, 6)).toEqual([
      0, 1, 17, 1, 18, 17,
    ]);
    first.release();
    expect(buffer.destroy).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(buffer.destroy).toHaveBeenCalledTimes(1);
    const third = acquireNativeMeshGrid(device, mesh);
    expect(device.createBuffer).toHaveBeenCalledTimes(2);
    third.release();
  });

  it("rejects unbounded and malformed grids before creating GPU buffers", () => {
    expect(() => nativeMeshGridBytes({ columns: 256, rows: 256 })).toThrow(
      "Invalid native mesh grid",
    );
    expect(() => nativeMeshGridBytes({ columns: 16.5, rows: 16 })).toThrow(
      "Invalid native mesh grid",
    );
  });
});
