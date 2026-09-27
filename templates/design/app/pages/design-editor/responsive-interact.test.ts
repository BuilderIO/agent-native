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

  it("keeps guided questions and Interact content clear of the absolute left rail", () => {
    expect(source).toContain("const leftChromeOverlayInset =");
    expect(source.match(/paddingLeft: leftChromeOverlayInset/g)).toHaveLength(
      2,
    );
    expect(source).toContain(
      "responsiveInteractActive && leftChromeOverlayInset",
    );
  });

  it("pins a squeeze-immune close beside the docked bar", () => {
    // Reported gap: a wide left rail (the Code panel is 640px) plus a
    // modest window squeezes the docked bar's canvas column enough that
    // its own Close gets clipped by overflow-hidden before anything else
    // in the row. The docked bar hides its own Close (showClose={floating}
    // is false when docked) and a pinned duplicate, anchored to the canvas
    // area's own right edge rather than the bar's shrunken one, takes over.
    expect(source).toContain("showClose={floating}");
    expect(source).toContain("ResponsiveInteractExitButton");
    const pinnedExitIndex = source.indexOf(
      "responsiveInteractActive && !minimalUi ? (",
    );
    expect(pinnedExitIndex).toBeGreaterThan(-1);
    const pinnedExit = source.slice(pinnedExitIndex, pinnedExitIndex + 400);
    expect(pinnedExit).toContain("<ResponsiveInteractExitButton");
    expect(pinnedExit).toContain("onClose={handleExitResponsiveInteract}");
    // Height/edge-matched to the bar's own row, with an opaque panel
    // background so scrollable dimensions cannot render through the exit.
    expect(pinnedExit).toContain(
      "flex h-12 items-center bg-[var(--design-editor-panel-bg)] pl-1 pr-3",
    );
  });

  it("uses focused embedded defaults and a separate minimal-mode floating bar", () => {
    expect(source).toContain(
      "embedded && !hostOwnsChrome && !embedChromeRequested",
    );
    // Minimal mode auto-opens the floating inspector from selection — no
    // manual right-rail toggle (the flipped LayoutSidebar icon was that control).
    expect(source).not.toContain(
      '<IconLayoutSidebar className="size-4 -scale-x-100" />',
    );
    expect(source).not.toContain('data-design-minimal-toggle="right"');
    expect(source).toContain('data-design-minimal-bar="interact"');
    expect(source).toContain(
      "grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)]",
    );
    expect(source).toContain(
      'className="pointer-events-none flex min-w-0 justify-center"',
    );
    expect(source).toContain(
      "isMobileViewport && minimalInspectorHasSelection",
    );
  });

  it("resets chrome mode when same-design navigation changes embed mode", () => {
    expect(source).toContain("setMinimalUi(minimalUiByDefault);");
    expect(source).toContain(
      "}, [minimalUiByDefault, embedChromeRequested, hostOwnsChrome]);",
    );
  });

  it("keeps the inline iframe document stable while switching interaction in place", () => {
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain(
      "const initialInteractModeRef = useRef(interactMode)",
    );
    expect(canvas).toContain(
      'initialInteractModeRef.current ? "false" : "true"',
    );
    expect(canvas).toContain("const editorChromeBridge =");
    expect(canvas).not.toContain("const editorChromeBridge = interactMode");
    expect(canvas).toContain("set-interaction-mode");
    expect(canvas).toContain("editingSafetyEnabled: !interactModeRef.current");
  });

  it("reports live router paths for every URL-backed frame", () => {
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain("data-agent-native-live-route-bridge");
    expect(canvas).toContain('type: "agent-native:live-route-path"');
    expect(canvas).toContain("window.history.pushState = function ()");
    expect(canvas).toContain("window.history.replaceState = function ()");
    expect(canvas).toContain(
      'if (e.data.type === "agent-native:live-route-path") {',
    );
    expect(canvas).toContain("LIVE_ROUTE_BRIDGE_SCRIPT +");
  });

  it("gates the visual-edit loop on edit access, never on sign-in", () => {
    // /visual-edit works without a login for a loopback caller, so anything on
    // that path keyed to `isSignedIn` fails for exactly the user it serves:
    // the write-consent dialog never opens (edits can't reach source) and
    // agent-driven navigate/select/zoom commands are dropped on the floor.
    const consentAnchor = "const key = `design-localhost-write-consent-request";
    const consentIndex = source.indexOf(consentAnchor);
    expect(consentIndex).toBeGreaterThan(0);
    const consent = source.slice(consentIndex - 900, consentIndex);
    expect(consent).toContain("!id || !canEditDesign");
    expect(consent).not.toContain("!id || !isSignedIn");

    const commandChannel = source.slice(
      source.indexOf("designEditorCommandFromSearchParams(\n") - 600,
      source.indexOf("designEditorCommandKey()];"),
    );
    expect(commandChannel).not.toContain("!id || !isSignedIn");
  });

  it("routes every Interact request into the responsive view", () => {
    expect(source).toContain(
      'handleModeChange("interact", { targetFileId: screenId })',
    );
    expect(source).toContain('handleModeChange("interact");');
    expect(source).toContain("enterSingleScreen(screenId, { mode });");
    expect(source).not.toContain("enterSingleScreenInteract");
    expect(editorSurface).toContain("resolveModeChangeView({");
    // Only an explicit mode from an embedding host differs; every other entry
    // into a focused screen is still Interact.
    expect(editorSurface).toContain('options?.mode ?? "interact"');
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
    expect(barMount).toContain("onModeChange={(next) => {");
    expect(barMount).toContain("setRuntimeLayerSnapshotRequest(");
    expect(barMount).toContain("canAnnotate={canEditDesign}");
    const bar = readFileSync(
      "app/components/design/ResponsiveInteractBar.tsx",
      "utf8",
    );
    expect(bar).toContain("onModeChange(exit.mode)");
    expect(bar).not.toContain("setMode(");
    expect(bar).not.toContain('"interact"');
  });

  it("refreshes live Layers when Interact returns to Edit", () => {
    const exitHandler = source.slice(
      source.indexOf("const handleExitResponsiveInteract ="),
      source.indexOf("// Escape is the standard"),
    );
    expect(exitHandler).toContain("setRuntimeLayerSnapshotRequest(");
    expect(source).toContain(
      "runtimeLayerSnapshotRequest={runtimeLayerSnapshotRequest}",
    );
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain('type: "request-runtime-layer-snapshot"');
  });

  it("keeps localhost bridge identity stable across Interact mode changes", () => {
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain("const includeLiveEditEditorChrome = !readOnly;");
    expect(canvas).toContain('type: "set-interaction-mode"');
    expect(canvas).toContain("interact: interactModeRef.current");
    expect(canvas).not.toContain(
      "const includeLiveEditEditorChrome = !interactMode && !readOnly;",
    );
    const bridge = readFileSync(
      "app/components/design/bridge/editor-chrome.bridge.ts",
      "utf8",
    );
    expect(bridge).toContain('e.data.type === "set-interaction-mode"');
    expect(bridge).toContain('shieldOverlay.style.pointerEvents = "none"');
    expect(bridge).toContain("scheduleRuntimeLayerSnapshot()");
  });

  it("keeps a focused localhost screen on its live route when returning to Edit", () => {
    const focusedCanvasStart = source.lastIndexOf("<DesignCanvas");
    const focusedCanvas = source.slice(
      focusedCanvasStart,
      source.indexOf("publicVisualEdit={", focusedCanvasStart),
    );
    const liveRouteOverride = source.slice(
      source.indexOf("previewUrlOverride={", focusedCanvasStart),
      source.indexOf("bridgeUrl={activeScreenBridgeUrl}", focusedCanvasStart),
    );
    expect(liveRouteOverride).toContain(
      'activeCanvasSourceType === "localhost"',
    );
    expect(liveRouteOverride).toContain("previewUrlAtLiveRoute(");
    expect(liveRouteOverride).toContain("liveRoutePathsByScreenIdRef.current[");
    expect(liveRouteOverride).toContain("activeFile.id");
    expect(focusedCanvas).toContain("onRoutePathChange={");
    expect(focusedCanvas).toContain("handleLiveRoutePathChange");
  });

  it("uses the selected screen size and the real canvas bounds", () => {
    expect(editorSurface).toContain("resolveInteractDeviceForScreen(");
    expect(source).toContain("container.clientWidth - 48");
    expect(source).toContain("new ResizeObserver(updateZoomToFit)");
    expect(source).toContain("responsiveInteractActive ? interactZoom : zoom");
    expect(source).toContain("responsiveInteractActive ? undefined : setZoom");
    expect(source).toContain("? interactDeviceSize.width");
    expect(source).toContain("? interactDeviceSize.height");
    const canvas = readFileSync(
      "app/components/design/DesignCanvas.tsx",
      "utf8",
    );
    expect(canvas).toContain("previewHeightPx?: number");
    expect(canvas).toContain("const resolvedHeight =");
    expect(canvas).toContain("enabled: Boolean(onZoomChange) && !interactMode");
    expect(canvas).toContain('if (e.data.type === "pinch-zoom-wheel") {');
    expect(canvas).toContain("if (interactMode) return;");
  });

  it("keeps the canvas-shell Escape handling inert, but exits Interact on Escape", () => {
    // The canvas shell's selection/drawing/breakpoint Escape handling must
    // not fire underneath the running prototype.
    expect(source).toContain(
      "onEscape: responsiveInteractActive ? undefined : handleEscapeHotkey",
    );
    // Reported gap: Interact had no keyboard way out at all, only the bar's
    // Close button. A dedicated window listener (not useDesignHotkeys, which
    // stays disabled above) now exits Interact on Escape whenever the event
    // reaches the parent window un-intercepted — i.e. never while a Radix
    // layer (the device Select) or the iframe itself has
    // already handled it, matching DesignColorPicker.escape.test.tsx's
    // documented ordering.
    const escapeExitEffect = source.slice(
      source.indexOf("const handleExitResponsiveInteract ="),
      source.indexOf("// Fit against the actual center canvas"),
    );
    expect(escapeExitEffect).toContain(
      "if (!responsiveInteractActive) return;",
    );
    expect(escapeExitEffect).toContain(
      'if (event.key !== "Escape" || event.defaultPrevented) return;',
    );
    expect(escapeExitEffect).toContain("handleExitResponsiveInteract();");
    expect(escapeExitEffect).toContain(
      'window.addEventListener("keydown", handleKeyDown);',
    );
  });

  it("keeps responsive chrome values readable", () => {
    const bar = readFileSync(
      "app/components/design/ResponsiveInteractBar.tsx",
      "utf8",
    );
    expect(bar).toContain("w-[88px]");
    expect(bar).toContain("appearance:textfield");
    expect(bar).not.toContain("zoomIn");
    expect(bar).not.toContain("zoomOut");
  });
});
