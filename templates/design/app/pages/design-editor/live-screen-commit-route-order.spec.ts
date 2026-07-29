/**
 * On a localhost screen the served document is a mount shell (verified: 3
 * projection nodes), so `absent` is the permanent normal state and every refusal
 * derived from that projection must sit BEHIND the localhost route. With the
 * runtime-only refusal first, an inspector edit returned before both the preview
 * and the queue: nothing visible, nothing sent to the agent, and a toast blaming
 * the element.
 *
 * Source-level assertions because these guards live in closures inside
 * DesignEditor.tsx (same approach as live-screen-url-preview-guard.spec.ts).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  new URL("../DesignEditor.tsx", import.meta.url),
  "utf8",
);

function commitVisualStylesSection(): string {
  const start = editorSource.indexOf("const commitVisualStyles = useCallback(");
  const end = editorSource.indexOf(
    "const commitStylesToSelectedLayers = useCallback(",
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return editorSource.slice(start, end);
}

describe("localhost style commit route order", () => {
  const LOCALHOST_ROUTE = 'if (activeCanvasSourceType === "localhost") {';
  const RESOLUTION_REFUSAL = "if (commitTargetCannotResolve) {";

  it("routes a localhost commit to the agent queue before the resolution refusal", () => {
    const section = commitVisualStylesSection();

    expect(section).toContain(LOCALHOST_ROUTE);
    expect(section).toContain(RESOLUTION_REFUSAL);
    expect(section.indexOf(LOCALHOST_ROUTE)).toBeLessThan(
      section.indexOf(RESOLUTION_REFUSAL),
    );
  });

  it("refuses an ambiguous target whether or not it is runtime-only", () => {
    const section = commitVisualStylesSection();
    const gate = section.slice(
      section.indexOf("const commitTargetCannotResolve ="),
      section.indexOf(RESOLUTION_REFUSAL),
    );

    // Gating solely on elementInfoIsRuntimeOnly let a source-backed element
    // with a repeated selector fall through to the writers, which both refuse
    // it anyway — after the preview had already painted the value.
    expect(gate).toContain('targetResolution.status === "ambiguous"');
    expect(gate).toContain("elementInfoIsRuntimeOnly(targetInfo)");
  });

  it("refuses before the runtime preview paints an edit that cannot persist", () => {
    const section = commitVisualStylesSection();

    expect(section.indexOf(RESOLUTION_REFUSAL)).toBeLessThan(
      section.indexOf("sendRuntimeStylePreview();"),
    );
  });

  it("previews and queues on the localhost route, then returns", () => {
    const section = commitVisualStylesSection();
    const route = section.slice(section.indexOf(LOCALHOST_ROUTE));
    const branch = route.slice(0, route.indexOf("\n      }") + 8);

    // Preview is what makes the edit visible; the queue is how it reaches
    // source. Losing either one reproduces the original bug in a new place.
    expect(branch).toContain("replayPendingVisualStyleRuntimePatch(");
    expect(branch).toContain("recordPendingVisualStyleEdit(");
    expect(branch).toContain("return;");
    // The document-patch machinery must not run for a screen with no
    // client-writable source.
    expect(branch).not.toContain("applyInlineStylesToHtml(");
  });

  it("keeps exactly one localhost route ahead of document projection", () => {
    const section = commitVisualStylesSection();

    // A second route after projection is unreachable and can drift from the
    // screen-scoped replay path used by canvas gestures.
    expect(section.split(LOCALHOST_ROUTE).length - 1).toBe(1);
    expect(section.indexOf(LOCALHOST_ROUTE)).toBeLessThan(
      section.indexOf("const baseContent ="),
    );
  });

  it("never blames the element when the projection is a mount shell", () => {
    const section = commitVisualStylesSection();
    const refusal = section.slice(section.indexOf(RESOLUTION_REFUSAL));

    // "no app markup to patch" and "element no longer exists" are different
    // facts with different remedies; a mount shell is the former.
    expect(refusal).toMatch(
      /isClientRenderedMountShell\(projection\)[\s\S]*?patchProof\.clientRenderedShell/,
    );
  });
});
