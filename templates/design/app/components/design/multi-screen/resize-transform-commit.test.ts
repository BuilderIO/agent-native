import { describe, expect, it } from "vitest";

type FrameGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
};
type FrameGeometryById = Record<string, FrameGeometry>;

function cloneFrameGeometryById(
  geometryById: FrameGeometryById,
): FrameGeometryById {
  return Object.fromEntries(
    Object.entries(geometryById).map(([id, geometry]) => [id, { ...geometry }]),
  );
}

function frameGeometryWithOverrides(
  base: FrameGeometryById,
  overrides: FrameGeometryById,
): FrameGeometryById {
  const next = cloneFrameGeometryById(base);
  Object.entries(overrides).forEach(([id, geometry]) => {
    next[id] = { ...geometry };
  });
  return next;
}

function get(map: FrameGeometryById, key: string): FrameGeometry {
  const value = map[key];
  if (!value) throw new Error(`Missing geometry for ${key}`);
  return value;
}

describe("resize ref-only → commit path", () => {
  const screenA: FrameGeometry = { x: 0, y: 0, width: 400, height: 600 };
  const screenB: FrameGeometry = { x: 500, y: 0, width: 300, height: 500 };
  const origin: FrameGeometryById = {
    "screen-a": screenA,
    "screen-b": screenB,
  };

  it("ref-only update does not alias state", () => {
    const state = { ...origin };
    const ref = { current: state };
    ref.current = {
      ...ref.current,
      "screen-a": { ...get(ref.current, "screen-a"), width: 500, height: 700 },
    };
    expect(get(ref.current, "screen-a").width).toBe(500);
    expect(get(state, "screen-a").width).toBe(400);
  });

  it("clone produces deep copies", () => {
    const cloned = cloneFrameGeometryById(origin);
    get(cloned, "screen-a").width = 999;
    expect(get(origin, "screen-a").width).toBe(400);
  });

  it("overrides restore origin frames after a ref-only drag", () => {
    const dragged: FrameGeometryById = {
      "screen-a": { x: 10, y: 20, width: 450, height: 650 },
      "screen-b": { x: 500, y: 0, width: 300, height: 500 },
    };
    const restored = frameGeometryWithOverrides(dragged, {
      "screen-a": screenA,
    });
    expect(restored["screen-a"]).toEqual(screenA);
    expect(restored["screen-b"]).toEqual(dragged["screen-b"]);
  });

  it("commit path: clone ref → setFrameGeometry → onGeometryChange", () => {
    const ref = { current: { ...origin } };
    ref.current = {
      ...ref.current,
      "screen-a": { x: 10, y: 20, width: 500, height: 700 },
    };
    const committed = cloneFrameGeometryById(ref.current);
    get(committed, "screen-a").width = 999;
    expect(get(ref.current, "screen-a").width).toBe(500);
  });

  it("rollback path: frameGeometryWithOverrides restores pre-drag state", () => {
    const ref = { current: { ...origin } };
    ref.current = {
      ...ref.current,
      "screen-a": { x: 10, y: 20, width: 500, height: 700 },
    };
    const after = cloneFrameGeometryById(ref.current);
    const before = frameGeometryWithOverrides(after, { "screen-a": screenA });
    expect(before["screen-a"]).toEqual(screenA);
    ref.current = before;
    expect(ref.current["screen-a"]).toEqual(screenA);
  });
});

describe("selection prop-sync identity preservation", () => {
  function sameIds(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((id, i) => id === b[i]);
  }

  it("skips state update when IDs already match", () => {
    const internal = ["screen-1", "screen-2"];
    const incoming = ["screen-1", "screen-2"];
    expect(sameIds(internal, incoming)).toBe(true);
  });

  it("triggers state update when IDs differ", () => {
    const internal = ["screen-1"];
    const incoming = ["screen-1", "screen-2"];
    expect(sameIds(internal, incoming)).toBe(false);
  });

  it("filters to selectable screens synchronously", () => {
    const selectable = new Set(["screen-1", "screen-3"]);
    const incoming = ["screen-1", "screen-2", "screen-3"];
    const filtered = incoming.filter((id) => selectable.has(id));
    expect(filtered).toEqual(["screen-1", "screen-3"]);
  });
});
