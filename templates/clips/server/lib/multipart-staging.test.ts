import { describe, expect, it } from "vitest";

import { joinContiguous } from "./multipart-staging.js";

const b = (...n: number[]) => new Uint8Array(n);

describe("joinContiguous", () => {
  it("joins chunks that exactly cover the range, in offset order", () => {
    expect([
      ...joinContiguous(
        [
          { offset: 12, bytes: b(3) },
          { offset: 10, bytes: b(1, 2) },
        ],
        10,
        13,
      )!,
    ]).toEqual([1, 2, 3]);
  });

  it("returns null for a gap, an overlap, a short or a long cover", () => {
    expect(joinContiguous([{ offset: 11, bytes: b(1) }], 10, 12)).toBeNull();
    expect(
      joinContiguous(
        [
          { offset: 10, bytes: b(1, 2) },
          { offset: 11, bytes: b(3) },
        ],
        10,
        13,
      ),
    ).toBeNull();
    expect(joinContiguous([{ offset: 10, bytes: b(1) }], 10, 12)).toBeNull();
    expect(
      joinContiguous([{ offset: 10, bytes: b(1, 2, 3) }], 10, 12),
    ).toBeNull();
    expect(joinContiguous([], 10, 12)).toBeNull();
  });

  it("treats an empty range as empty only when nothing is staged", () => {
    expect(joinContiguous([], 5, 5)?.byteLength).toBe(0);
  });
});
