import { describe, expect, it, vi } from "vitest";

import { runScreenVisualStyleChange } from "./screen-visual-style-change";

describe("selected live screen relative style handoff", () => {
  it("records batched relative intent for a non-active localhost screen", () => {
    const recordPendingVisualStyleEdit = vi.fn();
    const args = {
      activeBreakpointUpperBoundPx: null,
      activeBreakpointWidthStateRef: { current: undefined },
      activeFile: { id: "settings", filename: "settings.html" },
      applyFileContentUpdate: vi.fn(),
      canEditDesign: false,
      canEditLiveScreen: vi.fn(() => true),
      designSourceType: "localhost" as const,
      getScreenContent: vi.fn(),
      handleVisualStyleChange: vi.fn(),
      overviewScreens: [
        {
          id: "library",
          sourceType: "localhost",
          heightPinned: false,
        },
      ],
      recordPendingVisualStyleEdit,
      responsiveEditScopeRef: { current: "all" as const },
      t: (key: string) => key,
    } as unknown as Parameters<typeof runScreenVisualStyleChange>[0];
    const relativeOperations = {
      marginLeft: { kind: "delta" as const, delta: 2 },
      marginRight: {
        kind: "expression" as const,
        expression: "+2",
        unit: "px",
      },
    };

    runScreenVisualStyleChange(
      args,
      "library",
      ".toolbar",
      { marginLeft: "calc(4px + var(--space-step))", marginRight: "10px" },
      undefined,
      {
        phase: "commit",
        routePath: "/library",
        relativeOperations,
      },
    );

    expect(recordPendingVisualStyleEdit).toHaveBeenCalledWith(
      "library",
      ".toolbar",
      { marginLeft: "calc(4px + var(--space-step))", marginRight: "10px" },
      undefined,
      { routePath: "/library", relativeOperations },
    );
    expect(args.applyFileContentUpdate).not.toHaveBeenCalled();
  });
});
