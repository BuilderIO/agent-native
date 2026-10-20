import { describe, expect, it } from "vitest";

import { decodeNativeFloat16 } from "./native-linear-golden";
import {
  buildNativeReceiverDistanceField,
  buildNativeReceiverInteriorField,
  packNativeReceiverFloat16,
} from "./native-receiver-distance";

describe("receiver signed distance geometry", () => {
  it("points outward at the boundary and retains interior depth", () => {
    const field = buildNativeReceiverDistanceField(
      new Uint8Array(25).fill(255),
      5,
      5,
      5,
      5,
    );
    expect(field[12 * 4]).toBe(2.5);
    expect(field[10 * 4]).toBe(0.5);
    expect(field[10 * 4 + 1]).toBe(-1);
    expect(field[14 * 4 + 1]).toBe(1);
    expect(field[2 * 4 + 2]).toBe(-1);
  });

  it("keeps holes empty and bends toward their interior edges", () => {
    const alpha = new Uint8Array(49).fill(255);
    alpha[24] = 0;
    const field = buildNativeReceiverDistanceField(alpha, 7, 7, 7, 7);
    expect(field[24 * 4]).toBe(-0.5);
    expect(field[24 * 4 + 3]).toBe(0);
    expect(field[23 * 4 + 1]).toBe(1);
  });

  it("measures anisotropic pixels in logical units without treating partial alpha as a hole", () => {
    const field = buildNativeReceiverDistanceField(
      new Uint8Array(25).fill(51),
      5,
      5,
      10,
      5,
    );
    expect(field[12 * 4]).toBe(2.5);
    expect(field[10 * 4]).toBe(1.5);
    expect(field[12 * 4 + 3]).toBeCloseTo(0.2);
    expect(packNativeReceiverFloat16(field).length).toBe(field.length);
  });

  it("normalizes disconnected SVG interiors independently while retaining holes", () => {
    const width = 512;
    const height = 60;
    const alpha = new Uint8Array(width * height);
    for (let y = 5; y <= 54; y += 1)
      for (let x = 10; x <= 190; x += 1) alpha[y * width + x] = 255;
    for (let y = 15; y <= 44; y += 1)
      for (let x = 50; x <= 150; x += 1) alpha[y * width + x] = 0;
    for (let y = 10; y <= 49; y += 1)
      for (let x = 250; x <= 500; x += 1) alpha[y * width + x] = 255;
    const field = buildNativeReceiverInteriorField(
      alpha,
      width,
      height,
      128,
      15,
    );
    expect(field[(30 * width + 100) * 4]).toBe(0);
    expect(field[(30 * width + 100) * 4 + 3]).toBe(1);
    const firstMaximum = Math.max(
      ...Array.from({ length: 181 * 50 }, (_, index) => {
        const x = 10 + (index % 181);
        const y = 5 + Math.floor(index / 181);
        return field[(y * width + x) * 4];
      }),
    );
    const secondMaximum = Math.max(
      ...Array.from({ length: 251 * 40 }, (_, index) => {
        const x = 250 + (index % 251);
        const y = 10 + Math.floor(index / 251);
        return field[(y * width + x) * 4];
      }),
    );
    expect(firstMaximum).toBe(1);
    expect(secondMaximum).toBe(1);
    expect(field[0]).toBe(0);
    expect(field[3]).toBe(1);
  });

  it("keeps one-pixel diagonals and two-pixel strokes as connected interiors", () => {
    const width = 24;
    const height = 8;
    const alpha = new Uint8Array(width * height);
    for (let value = 1; value <= 6; value += 1)
      alpha[value * width + value] = 255;
    for (let y = 1; y <= 6; y += 1)
      for (let x = 7; x <= 8; x += 1) alpha[y * width + x] = 255;
    for (let y = 1; y <= 6; y += 1)
      for (let x = 13; x <= 22; x += 1) alpha[y * width + x] = 255;
    for (let y = 3; y <= 4; y += 1)
      for (let x = 15; x <= 20; x += 1) alpha[y * width + x] = 0;
    const field = buildNativeReceiverInteriorField(
      alpha,
      width,
      height,
      width,
      height,
    );
    for (let value = 1; value <= 6; value += 1)
      expect(field[(value * width + value) * 4]).toBeGreaterThan(0);
    expect(field[(3 * width + 7) * 4]).toBe(1);
    const ringMaximum = Math.max(
      ...Array.from({ length: 10 * 6 }, (_, index) => {
        const x = 13 + (index % 10);
        const y = 1 + Math.floor(index / 10);
        return field[(y * width + x) * 4];
      }),
    );
    expect(ringMaximum).toBe(1);
    expect(field[(3 * width + 17) * 4]).toBe(0);
    expect(field[(3 * width + 17) * 4 + 3]).toBe(1);
  });

  it("returns finite empty geometry and rejects unbounded work", () => {
    const empty = buildNativeReceiverDistanceField(
      new Uint8Array(12),
      4,
      3,
      4,
      3,
    );
    expect([...empty].every(Number.isFinite)).toBe(true);
    expect(empty[0]).toBeLessThan(0);
    expect(() =>
      buildNativeReceiverDistanceField(new Uint8Array(513), 513, 1, 513, 1),
    ).toThrow("bounded");
    const packed = packNativeReceiverFloat16(
      new Float32Array([0, 1, -1, 0.5, 12.25, 0.00001]),
    );
    expect([...packed].map(decodeNativeFloat16)).toEqual([
      0,
      1,
      -1,
      0.5,
      12.25,
      expect.closeTo(0.00001, 7),
    ]);
  });
});
