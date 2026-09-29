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

    expect(branch).toContain("replayPendingVisualStyleRuntimePatch(");
    expect(branch).toContain("recordPendingVisualStyleEdit(");
    expect(branch).toContain("return;");
    expect(branch).not.toContain("applyInlineStylesToHtml(");
  });

  it("keeps exactly one localhost route ahead of document projection", () => {
    const section = commitVisualStylesSection();

    expect(section.split(LOCALHOST_ROUTE).length - 1).toBe(1);
    expect(section.indexOf(LOCALHOST_ROUTE)).toBeLessThan(
      section.indexOf("const baseContent ="),
    );
  });

  it("never blames the element when the projection is a mount shell", () => {
    const section = commitVisualStylesSection();
    const refusal = section.slice(section.indexOf(RUNTIME_ONLY_REFUSAL));

    expect(refusal).toMatch(
      /isClientRenderedMountShell\(projection\)[\s\S]*?patchProof\.clientRenderedShell/,
    );
  });
});
