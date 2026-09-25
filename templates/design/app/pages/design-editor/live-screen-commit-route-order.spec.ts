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

const commitVisualStylesSource = readFileSync(
  new URL("./commands/commit-visual-styles.ts", import.meta.url),
  "utf8",
);

function commitVisualStylesSection(): string {
  expect(commitVisualStylesSource).toContain(
    "export function runCommitVisualStyles(",
  );
  return commitVisualStylesSource;
}

describe("localhost style commit route order", () => {
  const LOCALHOST_ROUTE =
    "if (isRunningAppSourceType(activeCanvasSourceType)) {";
  const RUNTIME_ONLY_REFUSAL =
    "if (!targetNode && elementInfoIsRuntimeOnly(targetInfo)) {";

  it("routes a localhost commit to the agent queue before the runtime-only refusal", () => {
    const section = commitVisualStylesSection();

    expect(section).toContain(LOCALHOST_ROUTE);
    expect(section).toContain(RUNTIME_ONLY_REFUSAL);
    expect(section.indexOf(LOCALHOST_ROUTE)).toBeLessThan(
      section.indexOf(RUNTIME_ONLY_REFUSAL),
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
    const refusal = section.slice(section.indexOf(RUNTIME_ONLY_REFUSAL));

    // "no app markup to patch" and "element no longer exists" are different
    // facts with different remedies; a mount shell is the former.
    expect(refusal).toMatch(
      /isClientRenderedMountShell\(projection\)[\s\S]*?patchProof\.clientRenderedShell/,
    );
  });
});
