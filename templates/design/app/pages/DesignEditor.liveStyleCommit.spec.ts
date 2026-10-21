import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

const source = readDesignEditorSource();

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
