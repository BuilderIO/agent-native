import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  new URL("../DesignEditor.tsx", import.meta.url),
  "utf8",
);

function sourceSection(start: string, end: string): string {
  const startIndex = editorSource.indexOf(start);
  const endIndex = editorSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return editorSource.slice(startIndex, endIndex);
}

describe("DesignEditor runtime layer state handoff", () => {
  it.each([
    [
      "locked",
      "const handleToggleLayerLocked",
      "const handleToggleLayerHidden",
    ],
    [
      "hidden",
      "const handleToggleLayerHidden",
      "const handleToggleHiddenForSelection",
    ],
  ] as const)(
    "routes runtime-only %s toggles through the semantic handoff before applying the optimistic state",
    (state, start, end) => {
      const section = sourceSection(start, end);
      const handoffCall = `sendRuntimeLayerStateSemanticHandoff(layerId, "${state}", ${state})`;

      expect(section).toContain("if (owner?.runtimeOnly)");
      expect(section).toContain(handoffCall);
      expect(section).toContain("layerStateOverridesRef.current.set(layerId");
      expect(section.indexOf(handoffCall)).toBeLessThan(
        section.indexOf("layerStateOverridesRef.current.set(layerId"),
      );
      expect(section).not.toMatch(
        /if \(owner\?\.runtimeOnly\) \{\s*return;\s*\}/,
      );
    },
  );

  it("serializes the exact-anchor, consented CAS/HMR contract into the agent prompt", () => {
    const section = sourceSection(
      "const sendRuntimeLayerStateSemanticHandoff",
      "// Wrap the current multi-layer selection",
    );

    expect(section).toContain("buildRuntimeReactLayerStateHandoff");
    expect(section).toContain("reactSourceAnchorForPendingEdit");
    expect(section).toContain("expectedVersionHash");
    expect(section).toContain("requireExpectedVersionHash: true");
    expect(section).toContain("human write consent");
    expect(section).toContain("HMR confirms the source metadata");
    expect(section).toContain("Never apply a generic AST transform");
  });
});
