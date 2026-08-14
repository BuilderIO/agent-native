import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  computeInteractZoomToFit,
  DEFAULT_INTERACT_DEVICE_PRESET,
  formatInteractZoom,
  resolveInteractDeviceForScreen,
} from "./responsive-interact";

describe("computeInteractZoomToFit", () => {
  it("keeps 100% when the device already fits the available space", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 1200,
        availableHeight: 1200,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });

  it("steps down to the nearest 5 when width is the constraint", () => {
    // widthScale = 500/402 ≈ 1.24 (fits); heightScale = 400/874 ≈ 0.4577 →
    // 45.77% → floored to 45.
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 400,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("uses the smaller of width/height scale", () => {
    // widthScale = 200/402 ≈ 0.4975 → 49.75%; heightScale = 900/874 ≈ 1.03
    // (fits) — the tighter width constraint wins, floored to 45.
    expect(
      computeInteractZoomToFit({
        availableWidth: 200,
        availableHeight: 900,
        deviceWidth: 402,
        deviceHeight: 874,
      }),
    ).toBe(45);
  });

  it("clamps to minZoom instead of going below it", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 50,
        availableHeight: 50,
        deviceWidth: 1440,
        deviceHeight: 900,
        minZoom: 10,
      }),
    ).toBe(10);
  });

  it("falls back to 100 for a degenerate device size", () => {
    expect(
      computeInteractZoomToFit({
        availableWidth: 500,
        availableHeight: 500,
        deviceWidth: 0,
        deviceHeight: 874,
      }),
    ).toBe(100);
  });
});

describe("responsive Interact defaults", () => {
  it("falls back to desktop and otherwise adopts the screen viewport", () => {
    expect(DEFAULT_INTERACT_DEVICE_PRESET.category).toBe("desktop");
    expect(resolveInteractDeviceForScreen()).toMatchObject({
      category: "desktop",
      width: 1440,
      height: 900,
    });
    expect(
      resolveInteractDeviceForScreen({ width: 1280, height: 720 }),
    ).toEqual({
      name: "Custom",
      category: "custom",
      width: 1280,
      height: 720,
    });
  });

  it("formats every displayed zoom with one decimal place", () => {
    expect(formatInteractZoom(73.33150562529376)).toBe("73.3");
    expect(formatInteractZoom(100)).toBe("100.0");
  });
});

// The bar is only worth building if it is actually mounted and the editor
// chrome steps aside for it — a component that renders nowhere was the
// original gap here. Source assertions match this file tree's existing
// wiring-guard convention (see DesignEditor.breakpoints.test.ts).
describe("responsive Interact wiring", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  // Editor behaviour that moved into command modules is still editor wiring.
  const editorSurface =
    source +
    readdirSync("app/pages/design-editor/commands")
      .map((f) => readFileSync(`app/pages/design-editor/commands/${f}`, "utf8"))
      .join("\n");

  it("activates only for a focused screen outside embedded hosts", () => {
    expect(source).toContain("const responsiveInteractActive =");
    expect(source).toContain(
      'mode === "interact" && viewMode === "single" && !!activeFile && !embedded',
    );
  });

  it("mounts the bar without disturbing either side rail", () => {
    expect(source).toContain("<ResponsiveInteractBar");
    expect(source).toContain("onClose={handleExitResponsiveInteract}");
    // Interact is a view of the editor, not a chrome-free takeover: the rails
    // stay mounted, so nothing may gate them on responsiveInteractActive.
    expect(source).not.toContain("!uiHidden && !responsiveInteractActive");
    expect(source).not.toContain(
      "!initialGenerationChromeLimited &&\n        !responsiveInteractActive",
    );
  });

  it("pushes editing safety live in addition to baking it", () => {
    // Editing safety stays BAKED into the gesture script (keyed on
    // interactMode). Un-baking it to keep the bridge key stable across
    // Interact toggles rendered the canvas frame completely blank —
    // verified by A/B: revert restored it immediately. The live
    // postMessage below is additive, so a mode change still reaches an
    // already-installed script without relying on a re-registration.
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain(
      '.replace("__EDITING_SAFETY_ENABLED__", interactMode ? "false" : "true")',
    );
    expect(canvas).toContain("editingSafetyEnabled: !interactMode");
  });

  it("gates the visual-edit loop on edit access, never on sign-in", () => {
    // /visual-edit works without a login for a loopback caller, so anything on
    // that path keyed to `isSignedIn` fails for exactly the user it serves:
    // the write-consent dialog never opens (edits can't reach source) and
    // agent-driven navigate/select/zoom commands are dropped on the floor.
    const consent = source.slice(
      source.indexOf("design-localhost-write-consent-request") - 900,
      source.indexOf("design-localhost-write-consent-request"),
    );
    expect(consent).toContain("!id || !canEditDesign");
    expect(consent).not.toContain("!id || !isSignedIn");

    const commandChannel = source.slice(
      source.indexOf("designEditorCommandFromSearchParams(\n") - 600,
      source.indexOf("designEditorCommandKey()];"),
    );
    expect(commandChannel).not.toContain("!id || !isSignedIn");
  });

  it("routes every Interact request into the responsive view", () => {
    expect(source).toContain("enterSingleScreen(screenId)");
    expect(source).toContain("enterSingleScreen(activeFileId)");
    expect(editorSurface).toContain("resolveModeChangeView({");
    // Interact is the only mode that lives on a focused screen, so the bottom
    // toolbar's tools and mode tabs are hidden while it owns the surface.
    expect(source).toContain("!responsiveInteractActive &&");
    const frames = readFileSync(
      "app/components/design/MultiScreenCanvas.tsx",
      "utf8",
    );
    expect(frames).not.toContain('t("multiScreenCanvas.fullView")');
  });

  it("keeps editor-shell editing paths inert while Interact owns the screen", () => {
    const hotkeys = source.slice(
      source.indexOf("useDesignHotkeys({"),
      source.indexOf("const startRetryGeneration"),
    );
    expect(hotkeys).toContain("!responsiveInteractActive");

    const selectionHydration = source.slice(
      source.indexOf("const selectedLayerIdsRef"),
      source.indexOf("initialUrlSelectionHydratedForIdRef.current !== id"),
    );
    expect(selectionHydration).toContain(
      'if (viewModeRef.current === "single")',
    );
    expect(selectionHydration).toContain(
      "initialUrlSelectionHydratedForIdRef.current = id",
    );

    const assetInsertion = source.slice(
      source.indexOf("const handleAssetInserted"),
      source.indexOf("const designExtensionContext"),
    );
    expect(assetInsertion).toContain('viewModeRef.current = "overview"');
    expect(assetInsertion).toContain('setViewMode("overview")');
  });

  it("keeps a way out of Interact into Edit/Annotate on the one canvas path", () => {
    // Hiding the bottom toolbar removed the mode tabs, so the bar carries the
    // exits instead. It must hand them to `handleModeChange` — the only
    // handler that consults `resolveModeChangeView` — or Edit/Annotate could
    // land on a focused screen, which is the state the toolbar rule exists to
    // prevent.
    const barMount = source.slice(
      source.indexOf("<ResponsiveInteractBar"),
      source.indexOf("onClose={handleExitResponsiveInteract}"),
    );
    expect(barMount).toContain("onModeChange={handleModeChange}");
    expect(barMount).toContain("canAnnotate={canEditDesign}");
    const bar = readFileSync(
      "app/components/design/ResponsiveInteractBar.tsx",
      "utf8",
    );
    expect(bar).toContain("onModeChange(exit.mode)");
    expect(bar).not.toContain("setMode(");
    expect(bar).not.toContain('"interact"');
  });

  it("uses the selected screen size and the real canvas bounds", () => {
    expect(editorSurface).toContain("resolveInteractDeviceForScreen(");
    expect(source).toContain("container.clientWidth - 48");
    expect(source).toContain("new ResizeObserver(updateZoomToFit)");
    expect(source).toContain("responsiveInteractActive ? interactZoom : zoom");
    expect(source).toContain(
      "responsiveInteractActive ? setInteractZoom : setZoom",
    );
    expect(source).toContain("? interactDeviceSize.width");
    expect(source).toContain("? interactDeviceSize.height");
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain("previewHeightPx?: number");
    expect(canvas).toContain("const resolvedHeight =");
  });

  it("leaves Escape entirely to the running app", () => {
    expect(source).toContain(
      "onEscape: responsiveInteractActive ? undefined : handleEscapeHotkey",
    );
  });

  it("keeps responsive chrome values readable", () => {
    const bar = readFileSync(
      "app/components/design/ResponsiveInteractBar.tsx",
      "utf8",
    );
    expect(bar).toContain("formatInteractZoom(zoom)");
    expect(bar).toContain("w-[88px]");
    expect(bar).toContain("appearance:textfield");
  });
});
