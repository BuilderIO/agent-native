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
  });

  it("keeps mirrored responsive overlays handle-free and visually softer", () => {
    expect(bridgeSource).toContain('style === "soft"');
    expect(bridgeSource).toContain(
      "color-mix(in srgb,var(--design-editor-accent-color) 64%,transparent)",
    );
    expect(bridgeSource).toContain(
      'if (style !== "soft") appendPassiveSelectionHandles(overlay);',
    );
    expect(bridgeSource).toContain(
      'e.data.passiveSelectionStyle === "soft" ? "soft" : "default"',
    );
  });
});
