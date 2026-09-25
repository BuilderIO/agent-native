import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function commandSource(file: string): string {
  return readFileSync(new URL(`./commands/${file}`, import.meta.url), "utf8");
}

describe("DesignEditor runtime layer state handoff", () => {
  it.each([
    ["locked", "toggle-layer-locked.ts"],
    ["hidden", "toggle-layer-hidden.ts"],
  ] as const)(
    "routes runtime-only %s toggles through the semantic handoff before applying the optimistic state",
    (state, file) => {
      const section = commandSource(file);
      const handoffCall = `sendRuntimeLayerStateSemanticHandoff(layerId, "${state}", ${state})`;
      const previewCall = `applyLayerStatePreview(layerScreenId, layerId, "${state}", ${state})`;

      expect(section).toContain("if (owner?.runtimeOnly)");
      expect(section).toContain(handoffCall);
      expect(section).toContain(previewCall);
      expect(section.indexOf(handoffCall)).toBeLessThan(
        section.lastIndexOf(previewCall),
      );
      expect(section).not.toMatch(
        /if \(owner\?\.runtimeOnly\) \{\s*return;\s*\}/,
      );
      // A target with no React source to write into returns "preview-only",
      // which must still apply the visual layer state — only an outright
      // false (source exists but the anchor is unresolvable) may bail.
      expect(section).toMatch(
        new RegExp(
          `sendRuntimeLayerStateSemanticHandoff\\(\\s*layerId,\\s*"${state}",\\s*${state},?\\s*\\)\\s*===\\s*false`,
        ),
      );
    },
  );

  it("serializes the exact-anchor, consented CAS/HMR contract into the agent prompt", () => {
    const section = commandSource(
      "send-runtime-layer-state-semantic-handoff.ts",
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
