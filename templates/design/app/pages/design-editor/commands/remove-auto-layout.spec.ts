import { describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError }),
}));

import type {
  FrameMeasurement,
  MeasuredFrame,
} from "@/pages/design-editor/measure-child-rects";

import { runRemoveAutoLayout } from "./remove-auto-layout";

const SOURCE = { kind: "design-file" as const, fileId: "screen" };

const ROWS = `<body>
<div data-agent-native-node-id="row" style="display: flex; gap: 8px"><div data-agent-native-node-id="a">A</div><div data-agent-native-node-id="b">B</div></div>
<div data-agent-native-node-id="empty" style="display: flex; flex-direction: column; width: 120px; height: 80px"></div>
<div data-agent-native-node-id="free" style="position: relative"></div>
</body>`;

function frame(
  display: string,
  size: { width: number; height: number },
  children: Record<string, MeasuredFrame["children"][number]["rect"]> = {},
): MeasuredFrame {
  return {
    status: "measured",
    display,
    boxSizing: "content-box",
    size,
    paddingBox: size,
    children: Object.entries(children).map(([id, rect]) => ({
      id,
      rect,
      position: "static",
      transformed: false,
      box: { sizing: "content-box", edges: { width: 0, height: 0 } },
    })),
    unidentifiedChildren: 0,
  };
}

const GEOMETRY: Record<string, FrameMeasurement> = {
  row: frame(
    "flex",
    { width: 88, height: 20 },
    {
      a: { x: 0, y: 0, width: 40, height: 20 },
      b: { x: 48, y: 0, width: 40, height: 20 },
    },
  ),
  empty: frame("flex", { width: 120, height: 80 }),
  free: frame("block", { width: 0, height: 0 }),
};

function remove(nodeIds: string[], measure = (id: string) => GEOMETRY[id]!) {
  const published: string[] = [];
  const status = runRemoveAutoLayout({
    applyLocalContentUpdate: (next) => {
      published.push(next);
      return { status: "accepted" } as never;
    },
    baseContent: ROWS,
    measure,
    nodeIds,
    source: SOURCE,
    t: (key) => key,
  });
  return { status, published };
}

const styleOf = (content: string, id: string) =>
  new RegExp(`data-agent-native-node-id="${id}"[^>]*style="([^"]*)"`).exec(
    content,
  )?.[1] ?? "";

describe("runRemoveAutoLayout", () => {
  it("freezes every selected auto layout frame in one update", () => {
    const { status, published } = remove(["row", "empty"]);
    expect(status).toBe("applied");
    expect(published).toHaveLength(1);
    const next = published[0]!;
    expect(styleOf(next, "row")).toMatch(/display:\s*block/);
    expect(styleOf(next, "b")).toMatch(/position:\s*absolute/);
    expect(styleOf(next, "b")).toMatch(/left:\s*48px/);
    expect(styleOf(next, "empty")).toMatch(/display:\s*block/);
  });

  it("skips layers that already lay out freeform", () => {
    expect(remove(["free"])).toEqual({ status: "nothing", published: [] });
  });

  it("refuses visibly when a frame was never measured", () => {
    toastError.mockClear();
    const { status, published } = remove(["row"], (nodeId) => ({
      status: "unmeasurable",
      nodeId,
      reason: "not-found",
    }));
    expect(status).toBe("failed");
    expect(published).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("refuses a frame whose children cannot all be addressed", () => {
    toastError.mockClear();
    const { status, published } = remove(["row"], () => ({
      ...(GEOMETRY.row as MeasuredFrame),
      unidentifiedChildren: 1,
    }));
    expect(status).toBe("failed");
    expect(published).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
