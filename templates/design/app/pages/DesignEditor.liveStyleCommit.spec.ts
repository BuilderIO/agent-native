/**
 * DesignEditor.liveStyleCommit.spec.ts
 *
 * An inspector style commit on a localhost screen never reached the running
 * app: commitVisualStyles went straight to the source/live-snapshot write
 * path, whose "content" for such a screen is only the bridged route URL. The
 * inspector showed the new value, the app rendered the old one, no pending
 * edit was queued (so the Apply CTA never appeared), and nothing failed
 * loudly — the value only surfaced later when an unrelated full-document
 * push replayed it.
 *
 * commitVisualStyles is the single funnel for inspector, hotkey and agent
 * style commits, so the localhost decision lives there and the canvas-gesture
 * handler delegates instead of repeating it. These are source-shape guards
 * (same idiom as DesignEditor.breakpoints.test.ts) — the file is one 30k-line
 * component with no importable seam for this branch.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./DesignEditor.tsx", import.meta.url),
  "utf8",
);

// commitVisualStyles now lives in its own command module; the whole file is
// the section these assertions used to slice out of DesignEditor.tsx.
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
    // The branch must return before the stored-content patch below it.
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
    const handler = source.slice(
      source.indexOf("const handleVisualStyleChange = useCallback"),
      source.indexOf("const handleVisualStructureChange = useCallback"),
    );
    expect(handler).toContain("commitVisualStyles(selector, styles, {");
    expect(handler).toContain("runtimeApplied: true");
    expect(handler).not.toContain("recordPendingVisualStyleEdit(");
  });
});
