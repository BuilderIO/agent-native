import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The design system the composer picker sets is stored on the design and read
 * by every later generation. Gating it on the empty-design start row meant
 * applying a template — which fills the design — took the control away with it.
 */
describe("DesignEditor composer design system picker", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const slot = source.slice(
    source.indexOf("composerSlot={"),
    source.indexOf("detectedFigmaComposerLink ? ("),
  );

  it("outlives the first-run start row", () => {
    expect(slot).toContain("showComposerDesignSystem ?");
    expect(slot).not.toContain("showFirstRunStart");
  });

  it("stays out of the composer when there is nothing to pick", () => {
    expect(source).toContain(
      "designSystemsLoading || designSystemOptions.length > 0",
    );
  });
});
