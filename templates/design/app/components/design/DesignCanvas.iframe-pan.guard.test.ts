import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignCanvas iframe pan bridge wiring", () => {
  const canvasSource = readFileSync(
    "app/components/design/DesignCanvas.tsx",
    "utf8",
  );
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const bridgeSource = readFileSync(
    "app/components/design/bridge/embedded-wheel.bridge.ts",
    "utf8",
  );

  it("hydrates every generated gesture placeholder and routes trusted pan packets", () => {
    expect(canvasSource).toContain('"__EMBEDDED_WHEEL_FORWARDING_ENABLED__"');
    expect(canvasSource).toContain(
      '"__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__"',
    );
    expect(canvasSource).toContain(
      'if (e.data.type === "embedded-canvas-pan")',
    );
    expect(canvasSource).toContain("forwardEmbeddedCanvasPanMessage({");
    expect(canvasSource).toContain(
      'type: "embedded-canvas-pan-mode",\n        leftButtonEnabled: handToolActive || spacePanActive',
    );
  });

  it("threads hand and temporary Space state through overview frames too", () => {
    expect(editorSource).toContain(
      'handToolActive={activeTool === "hand"}\n          spacePanActive={spacePanActive}',
    );
  });

  it("registers a keyed gesture-only localhost bridge before Interact renders", () => {
    expect(canvasSource).toContain(
      "includeLiveEditEditorChrome\n        ? MOTION_PREVIEW_BRIDGE_SCRIPT",
    );
    expect(canvasSource).toContain(": embeddedGestureBridgeForCurrentState");
    expect(canvasSource).toContain(
      "usesLiveEditInjectedBridge && !liveEditBridgeRegistered",
    );
  });

  it("cancels captured iframe pointers on top-level focus loss", () => {
    expect(bridgeSource).toContain(
      'window.addEventListener("blur", onWindowBlur)',
    );
    expect(canvasSource).toContain(
      'window.addEventListener("blur", handleHostWindowBlur)',
    );
    expect(canvasSource).toContain('{ type: "embedded-canvas-pan-cancel" }');
  });
});
