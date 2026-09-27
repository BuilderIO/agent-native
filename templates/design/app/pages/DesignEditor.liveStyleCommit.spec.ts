import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./DesignEditor.tsx", import.meta.url),
  "utf8",
);

const commitVisualStyles = readFileSync(
  new URL("./design-editor/commands/commit-visual-styles.ts", import.meta.url),
  "utf8",
);

describe("commitVisualStyles on a localhost screen", () => {
  it("queues a pending edit instead of writing the screen's stored content", () => {
    expect(commitVisualStyles).toContain(
      "if (isRunningAppSourceType(activeCanvasSourceType))",
    );
    const branch = commitVisualStyles.slice(
      commitVisualStyles.indexOf(
        "if (isRunningAppSourceType(activeCanvasSourceType))",
      ),
    );
    expect(branch.indexOf("recordPendingVisualStyleEdit(")).toBeGreaterThan(-1);
    expect(branch.indexOf("recordPendingVisualStyleEdit(")).toBeLessThan(
      branch.indexOf("applyInlineStylesToHtml("),
    );
  });

  it("pushes the value into the live frame unless the gesture already did", () => {
    expect(commitVisualStyles).toContain(
      'typeof (window as any).__designCanvasSendStyleForScreen === "function"',
    );
    expect(commitVisualStyles).toContain(
      "replayPendingVisualStyleRuntimePatch(",
    );
    expect(commitVisualStyles).toContain("!options.runtimeApplied &&");
    expect(commitVisualStyles).toContain(
      "activeBreakpointUpperBoundPx == null &&",
    );
  });
});

describe("handleVisualStyleChange (canvas gestures)", () => {
  it("delegates to commitVisualStyles rather than repeating the localhost branch", () => {
    const start = source.indexOf("const handleVisualStyleChange = useCallback");
    const handler = source.slice(
      start,
      source.indexOf("\n  const ", start + 1),
    );
    expect(handler).toContain("commitVisualStyles(gestureTarget, styles, {");
    expect(handler).toContain(
      "runtimeApplied: metadata?.runtimeApplied ?? !affectsEveryRow",
    );
    expect(handler).not.toContain("recordPendingVisualStyleEdit(");
  });
});
