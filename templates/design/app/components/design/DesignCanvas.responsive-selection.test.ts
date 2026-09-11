import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(
  new URL("./bridge/editor-chrome.bridge.ts", import.meta.url),
  "utf8",
);
const canvasSource = readFileSync(
  new URL("./DesignCanvas.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../pages/DesignEditor.tsx", import.meta.url),
  "utf8",
);

describe("responsive mirrored selection chrome", () => {
  it("uses soft passive chrome only for unclicked responsive peers", () => {
    expect(editorSource).toContain("passiveSelectionStyle={");
    expect(editorSource).toContain(
      "screen.breakpointWidths?.length && !screenIsActive",
    );
    expect(canvasSource).toContain(
      'passiveSelectionStyle?: "default" | "soft"',
    );
    expect(canvasSource).toContain("passiveSelectionStyle,");
    expect(canvasSource).toContain(
      'passiveSelectionStyle,\n      },\n      "*",',
    );
    expect(canvasSource).toContain("hoverStyle: passiveSelectionStyle");
  });

  it("keeps mirrored responsive overlays handle-free and visually softer", () => {
    expect(bridgeSource).toContain('style === "soft"');
    expect(bridgeSource).toContain(
      "color-mix(in srgb,var(--design-editor-accent-color) 64%,transparent)",
    );
    // Handles live on the combined multi-selection bounds box, so no
    // per-element passive overlay — soft or default — grows its own.
    expect(bridgeSource).not.toContain(
      'if (style !== "soft") appendPassiveSelectionHandles(overlay);',
    );
    expect(
      bridgeSource.split("appendPassiveSelectionHandles(overlay)").length - 1,
      "handles must be appended only to the combined bounds overlay",
    ).toBe(1);
    expect(bridgeSource).toContain(
      'e.data.passiveSelectionStyle === "soft" ? "soft" : "default"',
    );
    expect(bridgeSource).toContain(
      'highlightOverlayStyle === "soft" ? 1 : 1.5',
    );
    expect(bridgeSource).toContain('data-agent-native-soft-chrome", "true"');
    expect(bridgeSource).toContain(
      'e.data.hoverStyle === "soft" || e.data.hoverStyle === "default"',
    );
  });
});
