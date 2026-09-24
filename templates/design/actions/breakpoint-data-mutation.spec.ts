import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  mutateDesignData: vi.fn(),
  assertAccess: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: state.assertAccess,
}));

vi.mock("../server/db/index.js", () => ({}));

vi.mock("nanoid", () => ({ nanoid: state.nanoid }));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: state.mutateDesignData,
}));

import addBreakpoint from "./add-breakpoint.js";
import removeBreakpoint from "./remove-breakpoint.js";
import updateBreakpoint from "./update-breakpoint.js";

beforeEach(() => {
  vi.clearAllMocks();
  state.data = {};
  state.nanoid
    .mockReturnValueOnce("generated-breakpoint")
    .mockReturnValueOnce("generated-set");
  state.mutateDesignData.mockImplementation(
    async (options: {
      mutate: (
        current: Record<string, unknown>,
        context: { updatedAt: string },
      ) => Record<string, unknown>;
      isApplied: (current: Record<string, unknown>) => boolean;
    }) => {
      const updatedAt = "2026-07-09T12:00:00.000Z";
      state.data = options.mutate(state.data, { updatedAt });
      expect(options.isApplied(state.data)).toBe(true);
      return { data: state.data, updatedAt };
    },
  );
});

describe("breakpoint designs.data mutations", () => {
  it("adds a breakpoint against the latest record without dropping sibling keys", async () => {
    state.data = { concurrentCanvasWrite: { keep: true } };

    const result = await addBreakpoint.run({
      designId: "design_1",
      label: "Tablet",
      widthPx: 810,
    });

    expect(result).toMatchObject({
      added: { id: "generated-breakpoint", label: "Tablet", widthPx: 810 },
    });
    expect(state.data.concurrentCanvasWrite).toEqual({ keep: true });
  });

  it("treats a concurrently-added width as a duplicate instead of overwriting it", async () => {
    state.data = {
      breakpointSet: {
        id: "existing-set",
        breakpoints: [
          { id: "rival", label: "Rival tablet", widthPx: 810, prefix: "md" },
        ],
      },
      concurrentCanvasWrite: { keep: true },
    };

    const result = await addBreakpoint.run({
      designId: "design_1",
      label: "Tablet",
      widthPx: 810,
    });

    expect(result).toMatchObject({ ignored: true });
    expect(state.data.concurrentCanvasWrite).toEqual({ keep: true });
  });

  it("removes only the requested breakpoint from the latest set", async () => {
    state.data = {
      breakpointSet: {
        id: "set-1",
        breakpoints: [
          { id: "remove-me", label: "Phone", widthPx: 390, prefix: "sm" },
          { id: "keep-me", label: "Desktop", widthPx: 1200, prefix: "xl" },
        ],
      },
      concurrentCanvasWrite: { keep: true },
    };

    const result = await removeBreakpoint.run({
      designId: "design_1",
      breakpointId: "remove-me",
    });

    expect(result).toMatchObject({
      removed: true,
      breakpointSet: { breakpoints: [{ id: "keep-me" }] },
    });
    expect(state.data.concurrentCanvasWrite).toEqual({ keep: true });
  });

  it("updates a breakpoint in place without dropping sibling data", async () => {
    state.data = {
      breakpointSet: {
        id: "set-1",
        breakpoints: [
          { id: "phone", label: "Phone", widthPx: 360, prefix: "base" },
          { id: "tablet", label: "Tablet", widthPx: 810, prefix: "md" },
        ],
      },
      concurrentCanvasWrite: { keep: true },
    };

    const result = await updateBreakpoint.run({
      designId: "design_1",
      breakpointId: "phone",
      label: "Mobile",
      widthPx: 375,
    });

    expect(result).toMatchObject({
      updated: true,
      breakpoint: {
        id: "phone",
        label: "Mobile",
        widthPx: 375,
        prefix: "base",
      },
      breakpointSet: {
        id: "set-1",
        breakpoints: [
          { id: "phone", widthPx: 375 },
          { id: "tablet", widthPx: 810 },
        ],
      },
    });
    expect(state.data.concurrentCanvasWrite).toEqual({ keep: true });
  });

  it("leaves the set unchanged when the new width already exists", async () => {
    state.data = {
      breakpointSet: {
        id: "set-1",
        breakpoints: [
          { id: "phone", label: "Phone", widthPx: 360, prefix: "base" },
          { id: "tablet", label: "Tablet", widthPx: 810, prefix: "md" },
        ],
      },
    };
    const before = structuredClone(state.data);

    const result = await updateBreakpoint.run({
      designId: "design_1",
      breakpointId: "phone",
      widthPx: 810,
    });

    expect(result).toMatchObject({
      updated: false,
      reason: "A breakpoint with width 810px already exists.",
    });
    expect(state.data).toEqual(before);
  });

  it("refuses malformed breakpoint members without overwriting the set", async () => {
    state.data = {
      breakpointSet: {
        id: "set-1",
        breakpoints: [{ id: "phone", widthPx: 360 }],
      },
    };
    const before = structuredClone(state.data);

    const result = await updateBreakpoint.run({
      designId: "design_1",
      breakpointId: "phone",
      widthPx: 375,
    });

    expect(result).toEqual({
      updated: false,
      reason: "Breakpoint set is invalid; refusing update.",
    });
    expect(state.data).toEqual(before);
  });

  it("reports a missing breakpoint set separately from invalid metadata", async () => {
    const result = await updateBreakpoint.run({
      designId: "design_1",
      breakpointId: "phone",
      widthPx: 375,
    });

    expect(result).toEqual({
      updated: false,
      reason: "Breakpoint 'phone' not found in the set.",
    });
  });
});
