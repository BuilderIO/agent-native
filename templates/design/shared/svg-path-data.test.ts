import { describe, expect, it } from "vitest";

import { serializePenPath } from "./pen-path";
import { parseSvgPathData } from "./svg-path-data";

describe("parseSvgPathData", () => {
  it("reads absolute and relative lines and folds a closing duplicate", () => {
    const [square] = parseSvgPathData("M0 0 h10 v10 H0 L0 0 Z")!;
    expect(square!.closed).toBe(true);
    expect(square!.nodes.map((node) => node.point)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("keeps several subpaths apart", () => {
    const paths = parseSvgPathData("M0 0 L5 0 L5 5 Z M10 10 l5 0 l0 5 z")!;
    expect(paths).toHaveLength(2);
    expect(paths[1]!.nodes[0]!.point).toEqual({ x: 10, y: 10 });
  });

  it("round-trips cubic data through the pen model", () => {
    const d = "M 0 0 C 10 0 20 10 20 20 L 0 20 Z";
    const [path] = parseSvgPathData(d)!;
    expect(serializePenPath(path!)).toBe(
      "M 0 0 C 10 0 20 10 20 20 L 0 20 L 0 0 Z",
    );
  });

  it("turns quadratics and arcs into cubics that end where they should", () => {
    const [q] = parseSvgPathData("M0 0 Q 10 10 20 0")!;
    expect(q!.nodes[1]!.point).toEqual({ x: 20, y: 0 });
    expect(q!.nodes[0]!.handleOut).toEqual({ x: 20 / 3, y: 20 / 3 });
    const [a] = parseSvgPathData("M0 0 A 10 10 0 0 1 20 0")!;
    expect(a!.nodes[a!.nodes.length - 1]!.point).toEqual({ x: 20, y: 0 });
  });

  it("rejects malformed data instead of returning part of it", () => {
    expect(parseSvgPathData("M 0 0 L 10")).toBeNull();
    expect(parseSvgPathData("10 10")).toBeNull();
  });
});
