import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("DesignEditor composer design system picker", () => {
  const source = readDesignEditorSource();
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
