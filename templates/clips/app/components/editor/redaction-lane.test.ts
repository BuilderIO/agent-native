import { describe, expect, it } from "vitest";

import type { VideoRedaction } from "@/lib/video-redactions";

import { packRedactionRows, redactionLaneHeight } from "./redaction-lane";

const at = (id: string, startMs: number, endMs: number): VideoRedaction => ({
  id,
  kind: "redact",
  style: "solid",
  startMs,
  endMs,
  keys: [{ atMs: startMs, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
});

describe("laying redactions out in the lane", () => {
  it("keeps everything on one row when nothing overlaps", () => {
    const { rows, rowOf } = packRedactionRows([
      at("a", 0, 1_000),
      at("b", 2_000, 3_000),
    ]);
    expect(rows).toBe(1);
    expect([rowOf.get("a"), rowOf.get("b")]).toEqual([0, 0]);
  });

  it("gives an overlapping one its own row, so both can be clicked", () => {
    const { rows, rowOf } = packRedactionRows([
      at("a", 0, 5_000),
      at("b", 1_000, 6_000),
    ]);
    expect(rows).toBe(2);
    expect(rowOf.get("a")).not.toBe(rowOf.get("b"));
  });

  it("reuses a row once the one before it has finished", () => {
    const { rows } = packRedactionRows([
      at("a", 0, 5_000),
      at("b", 1_000, 2_000),
      at("c", 6_000, 7_000),
    ]);
    expect(rows).toBe(2);
  });

  it("stops growing rather than swallowing the timeline", () => {
    const many = Array.from({ length: 9 }, (_, i) => at(`r${i}`, 0, 5_000));
    expect(packRedactionRows(many).rows).toBe(4);
  });

  it("grows the lane with the rows it needs", () => {
    expect(redactionLaneHeight(2)).toBeGreaterThan(redactionLaneHeight(1));
  });
});
