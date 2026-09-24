import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The composer used to host an always-visible design system picker. That
 * chrome is gone — systems are still choosable from the prompt dialog and
 * first-run flows, just not above the chat input.
 */
describe("DesignEditor composer design system picker", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const slot = source.slice(
    source.indexOf("composerSlot={"),
    source.indexOf("composerSlot={") >= 0
      ? source.indexOf("</>", source.indexOf("composerSlot={")) + 3
      : 0,
  );

  it("does not render the design system picker above chat", () => {
    expect(slot).not.toContain("DesignSystemPickerControl");
    expect(slot).not.toContain("showComposerDesignSystem");
    expect(slot).not.toContain("data-design-system-picker");
  });

  it("still keeps Figma link detection in the composer slot", () => {
    expect(slot).toContain("detectedFigmaComposerLink");
    expect(slot).toContain("FigmaLinkComposerBubble");
  });
});
