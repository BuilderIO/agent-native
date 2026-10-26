import { describe, expect, it, vi } from "vitest";

import {
  NativePackedUniformArena,
  NativePackedUniformArenaError,
} from "./native-packed-uniform-arena";

function fixture(capacityBytes = 1024, alignment = 256) {
  const buffer = {};
  const uploads: Uint8Array[] = [];
  const upload = vi.fn((_buffer: object, bytes: Uint8Array) => {
    uploads.push(bytes.slice());
  });
  return {
    arena: new NativePackedUniformArena({
      buffer,
      capacityBytes,
      alignment,
      upload,
    }),
    buffer,
    uploads,
    upload,
  };
}

describe("packed native uniforms", () => {
  it("uploads multiple aligned draws together with independent values and zero padding", () => {
    const { arena, buffer, upload, uploads } = fixture();
    const frame = arena.beginFrame();
    const first = arena.write(
      frame,
      "mount-a:pass:0",
      new Float32Array([1, 2]),
    );
    const source = new Float32Array([99, 3, 4, 99]);
    const second = arena.write(frame, "mount-b:pass:0", source.subarray(1, 3));
    expect(first).toEqual({ buffer, offset: 0, size: 16 });
    expect(second).toEqual({ buffer, offset: 256, size: 16 });
    expect(upload).not.toHaveBeenCalled();
    arena.upload(frame);
    expect(upload).toHaveBeenCalledTimes(1);
    const values = new Float32Array(uploads[0]!.buffer);
    expect([...values.slice(0, 4)]).toEqual([1, 2, 0, 0]);
    expect([...values.slice(64, 68)]).toEqual([3, 4, 0, 0]);
    expect(uploads[0]!.byteLength).toBe(272);
    expect(() => arena.upload(frame)).toThrow("uniform-arena-frame-closed");
  });

  it("preserves binding identities across frames and encoding order changes", () => {
    const { arena, uploads } = fixture();
    const a = arena.beginFrame();
    const first = arena.write(a, "a", new Float32Array([1]));
    const second = arena.write(a, "b", new Float32Array([2]));
    arena.upload(a);
    arena.finishFrame(a);
    const b = arena.beginFrame();
    expect(arena.write(b, "b", new Float32Array([4]))).toBe(second);
    expect(arena.write(b, "a", new Float32Array([3]))).toBe(first);
    arena.upload(b);
    expect(new Float32Array(uploads[0]!.buffer)[0]).toBe(1);
    expect(new Float32Array(uploads[1]!.buffer)[0]).toBe(3);
  });

  it("rejects duplicate draw aliases, changed binding sizes and capacity overflow without dropping draws", () => {
    const { arena } = fixture(272);
    const frame = arena.beginFrame();
    arena.write(frame, "a", new Float32Array([1]));
    expect(() => arena.write(frame, "a", new Float32Array([2]))).toThrow(
      "uniform-arena-duplicate-draw",
    );
    arena.write(frame, "b", new Float32Array([3]));
    expect(() => arena.write(frame, "c", new Float32Array([4]))).toThrow(
      "uniform-arena-capacity-exceeded",
    );
    arena.upload(frame);
    arena.finishFrame(frame);
    const next = arena.beginFrame();
    expect(() => arena.write(next, "a", new Float32Array([1, 2]))).toThrow(
      "uniform-arena-binding-size-changed",
    );
    expect(arena.write(next, "a", new Float32Array([5])).offset).toBe(0);
  });

  it("requires exclusive frame ownership and rejects stale tokens after completion or abort", () => {
    const { arena } = fixture();
    const frame = arena.beginFrame();
    expect(() => arena.beginFrame()).toThrow("uniform-arena-frame-active");
    expect(() => arena.finishFrame(frame)).toThrow(
      "uniform-arena-frame-closed",
    );
    expect(() => arena.upload(frame)).toThrow("uniform-arena-empty-frame");
    arena.abortFrame(frame);
    const next = arena.beginFrame();
    expect(() => arena.write(frame, "a", new Float32Array([1]))).toThrow(
      "uniform-arena-frame-stale",
    );
    arena.write(next, "a", new Float32Array([1]));
    arena.upload(next);
    expect(() => arena.write(next, "b", new Float32Array([1]))).toThrow(
      "uniform-arena-frame-closed",
    );
    arena.abortFrame(next);
    expect(() => arena.finishFrame(next)).toThrow("uniform-arena-frame-stale");
  });

  it("keeps concurrent frame slots on distinct buffers and staging storage", () => {
    const first = fixture();
    const second = fixture();
    const a = first.arena.beginFrame();
    const b = second.arena.beginFrame();
    expect(first.arena.write(a, "draw", new Float32Array([1])).buffer).not.toBe(
      second.arena.write(b, "draw", new Float32Array([2])).buffer,
    );
    first.arena.upload(a);
    second.arena.upload(b);
    expect(new Float32Array(first.uploads[0]!.buffer)[0]).toBe(1);
    expect(new Float32Array(second.uploads[0]!.buffer)[0]).toBe(2);
    expect(() => first.arena.write(b, "other", new Float32Array([1]))).toThrow(
      "uniform-arena-frame-stale",
    );
  });

  it("preserves upload failures and requires abort before reuse", () => {
    const failure = new Error("device-write-failed");
    const arena = new NativePackedUniformArena({
      buffer: {},
      capacityBytes: 256,
      alignment: 256,
      upload: () => {
        throw failure;
      },
    });
    const frame = arena.beginFrame();
    arena.write(frame, "a", new Float32Array([1]));
    expect(() => arena.upload(frame)).toThrow(failure);
    expect(() => arena.upload(frame)).toThrow("uniform-arena-frame-closed");
    expect(() => arena.finishFrame(frame)).toThrow(
      "uniform-arena-frame-closed",
    );
    arena.abortFrame(frame);
    expect(arena.beginFrame()).not.toBe(frame);
  });

  it.each([
    [0, 256],
    [255, 256],
    [256, 0],
    [256, 3],
    [256, NaN],
  ])("rejects invalid capacity/alignment %s/%s", (capacityBytes, alignment) => {
    expect(() => fixture(capacityBytes, alignment)).toThrow(
      NativePackedUniformArenaError,
    );
  });
});
