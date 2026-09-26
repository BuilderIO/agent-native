import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseBreakpointWidthInput } from "@/components/design/BreakpointBar";

import { shouldPopToOverviewOnZoomOut } from "./design-editor/overview-camera";
import {
  applyScopedVisualStyleEdit,
  formatPendingVisualStylePrompt,
} from "./design-editor/pending-edits";

const html = `<html><head></head><body><section data-agent-native-node-id="hero" class="text-sm p-4">Hello</section></body></html>`;

describe("applyScopedVisualStyleEdit (§6.4 single write path)", () => {
  it("base scope (null bound) writes a plain inline style", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("left: 137px");
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("Tailwind-utility values become width-scoped classes", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "fontSize",
      value: "text-lg",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("max-[809px]:text-lg");
    expect(patch.content).toContain("text-sm");
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("raw CSS values become managed @media rules", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain("left: 137px;");
    expect(patch.content).not.toContain('style="');
  });

  it("bounds breakpoint-only edits to the selected responsive range", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      lowerBoundPx: 390,
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(
      "@media (min-width: 390px) and (max-width: 809px)",
    );
    expect(patch.content).toContain("data-agent-native-breakpoint-range");
    expect(patch.content).not.toContain("@media (max-width: 809px)");
  });

  it("replaces an exact-range property when switching back to the normal cascade", () => {
    const exact = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "left",
      value: "137px",
      lowerBoundPx: 390,
      upperBoundPx: 809,
    });
    const cascade = applyScopedVisualStyleEdit({
      content: exact.content,
      target: { nodeId: "hero" },
      property: "left",
      value: "144px",
      upperBoundPx: 809,
    });
    expect(cascade.result.status).toBe("applied");
    expect(cascade.content).not.toContain("data-agent-native-breakpoint-range");
    expect(cascade.content).toContain("@media (max-width: 809px)");
    expect(cascade.content).toContain("left: 144px");
  });

  it("scoped failures do not silently fall back to base writes", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "display",
      value: "url(bad)",
      upperBoundPx: 809,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(html);
  });

  it("a fill (backgroundImage) commit with a breakpoint active becomes a width-scoped @media write, not a base inline style", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: 'url("https://example.com/fill.png") center / cover no-repeat',
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain(
      'background-image: url("https://example.com/fill.png") center / cover no-repeat;',
    );
    expect(patch.content).not.toContain('style="');
  });

  it("tolerates the image-fill fit marker comment in a scoped backgroundImage write", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value:
        'url("https://example.com/fill.png") /* agent-native-image-fit:fill */',
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("agent-native-image-fit:fill");
  });

  it("still rejects an unsafe url() scheme on backgroundImage even though url() is now allowed", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: "url(javascript:alert(1))",
      upperBoundPx: 809,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(html);
  });

  it("still rejects url() on the base scope for an unsafe scheme", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: "url(javascript:alert(1))",
      upperBoundPx: null,
    });
    expect(patch.result.status).not.toBe("applied");
    expect(patch.content).toBe(html);
  });

  it("a safe backgroundImage url() at the base scope still writes a plain inline style", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundImage",
      value: 'url("https://example.com/fill.png")',
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain(
      'style="background-image: url(&quot;https://example.com/fill.png&quot;)"',
    );
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });
});

describe("Fill 'Add layer' single-property commit with a breakpoint active", () => {
  // ...) call — not a multi-property patch — must still scope through
  it("a single backgroundColor commit scopes to the active breakpoint's @media block", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundColor",
      value: "#ffffff",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain("background-color: #ffffff;");
    expect(patch.content).not.toContain('style="');
  });

  it("the same backgroundColor commit at the base scope still writes a plain inline style (byte-identical base behavior)", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "backgroundColor",
      value: "#ffffff",
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('style="background-color: #ffffff"');
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });

  it("the 'mixed fill' Add-layer patch (color + backgroundColor + backgroundImage: none) scopes every property, none silently falls back to base", () => {
    const properties: Array<[string, string]> = [
      ["color", "#000000"],
      ["backgroundColor", "#ffffff"],
      ["backgroundImage", "none"],
    ];
    let content = html;
    for (const [property, value] of properties) {
      const patch = applyScopedVisualStyleEdit({
        content,
        target: { nodeId: "hero" },
        property,
        value,
        upperBoundPx: 809,
      });
      expect(patch.result.status).toBe("applied");
      content = patch.content;
    }
    expect(content).toContain("<style data-agent-native-breakpoints>");
    expect(content).toContain("color: #000000;");
    expect(content).toContain("background-color: #ffffff;");
    expect(content).toContain("background-image: none;");
    expect(content).not.toContain('style="');
  });
});

describe("pending visual edit breakpoint stamping (gesture parity)", () => {
  const edit = {
    screenId: "screen-1",
    filename: "home.html",
    screenName: "Home",
    selector: ".hero",
    classes: [],
    styles: { left: "137px" },
    originalStyles: { left: "120px" },
    updatedAt: 1,
    breakpoint: { activeWidthPx: 390, upperBoundPx: 809 },
  };

  it("includes the breakpoint scope in the agent prompt payload", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      designTitle: "Test",
      activeFileId: "screen-1",
      activeFilename: "home.html",
      edits: [edit],
    });
    expect(prompt).toContain('"activeWidthPx": 390');
    expect(prompt).toContain('"upperBoundPx": 809');
    expect(prompt).toContain("activeFrameWidthPx");
    expect(prompt).toContain("width-scoped overrides");
  });

  it("omits the scoped-edit instruction for base-only edits", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      designTitle: "Test",
      activeFileId: "screen-1",
      activeFilename: "home.html",
      edits: [{ ...edit, breakpoint: undefined }],
    });
    expect(prompt).not.toContain("width-scoped overrides");
  });
});

describe("delete-to-display:none at an active breakpoint (item 7b)", () => {
  it("scopes a display:none delete override to the active breakpoint's @media block, leaving the base element intact", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "display",
      value: "none",
      upperBoundPx: 809,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain("<style data-agent-native-breakpoints>");
    expect(patch.content).toContain("@media (max-width: 809px)");
    expect(patch.content).toContain("display: none;");
    expect(patch.content).toContain(
      '<section data-agent-native-node-id="hero" class="text-sm p-4">Hello</section>',
    );
  });

  it("at the base scope (no active breakpoint), a display:none write is a plain inline style — callers must route base deletes through structural removal instead", () => {
    const patch = applyScopedVisualStyleEdit({
      content: html,
      target: { nodeId: "hero" },
      property: "display",
      value: "none",
      upperBoundPx: null,
    });
    expect(patch.result.status).toBe("applied");
    expect(patch.content).toContain('style="display: none"');
    expect(patch.content).not.toContain("data-agent-native-breakpoints");
  });
});

describe("DesignEditor breakpoint wiring (source assertions)", () => {
  const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const commandSource = (file: string) =>
    readFileSync(`app/pages/design-editor/commands/${file}`, "utf8");
  const editorSurface =
    source +
    readdirSync("app/pages/design-editor/commands")
      .map((f) => commandSource(f))
      .join("\n");
  const canvasSource = readFileSync(
    "app/components/design/MultiScreenCanvas.tsx",
    "utf8",
  );

  it("mounts a full editable DesignCanvas in every responsive overview frame", () => {
    expect(source).toContain(
      "renderBreakpointContent={renderBreakpointContent}",
    );
    expect(source).toContain("previewFrameId={");
    expect(source).toContain("breakpointWidthPx,");
    expect(canvasSource).toContain("const editableContent = bootDeferred");
    expect(canvasSource).toContain(
      "renderBreakpointContent?.(screen, metadata, {",
    );
    expect(canvasSource).toContain("editableContent ? (");
    expect(source).toContain(
      "handleIframeContextMenu({ ...payload, breakpointWidthPx })",
    );
    expect(source).toContain(
      "commentPinsHidden={commentsHidden || !screenIsActive}",
    );
  });

  it("keeps the current responsive scope visible and offers a bounded-only option", () => {
    expect(source).toContain('value="cascade-smaller"');
    expect(source).toContain('value="only"');
    expect(source).toContain("handleResponsiveEditScopeChange");
  });

  it("keeps the responsive scope control inline in Screen settings", () => {
    expect(source).toContain("const screenBreakpointControls = (");
    expect(source).toContain('className="design-sidebar-property-group"');
    expect(source).toContain('className="flex min-w-0 items-center gap-1"');
    expect(source).toContain(
      'className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"',
    );
    expect(source).toContain(
      'className="size-7 shrink-0 justify-center p-0 [&>svg:last-child]:hidden"',
    );
    expect(source).toContain("IconArrowsDown");
    expect(source).not.toContain("w-[190px] max-w-full shrink-0 !text-[11px]");
  });

  it("deletes selected screens without an editor-open-only confirmation flow", () => {
    expect(source).not.toContain("PendingScreenDeletionDialog");
    expect(source).not.toContain("screenDeletion");
    expect(source).toContain("recordDeletionHistory: true");
  });

  it("routes every style-commit path through the scoped write helper", () => {
    const calls = editorSurface.match(/applyScopedVisualStyleEdit\(\{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("BP-DEEP v2: breakpoint targeting lives ONLY in Screen settings — no canvas bar, no chrome row", () => {
    expect(source).toContain('from "@/components/design/BreakpointBar"');
    expect(source.match(/<BreakpointBar\b/g) ?? []).toHaveLength(0);
    const mounts = source.match(/<BreakpointDeviceControl\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(source).toContain("screenBreakpointControls");
    expect(source).not.toContain('t("designEditor.devicePreview")');
  });

  it("switches the editing viewport AND the persisted edit scope on segment click", () => {
    const handler = source.slice(
      source.indexOf("const handleBreakpointBarSelect"),
      source.indexOf("// Item 9 — agent→UI breakpoint sync"),
    );
    expect(handler).toContain("setActiveBreakpointWidthState(widthPx)");
    expect(handler).toContain("persistActiveBreakpoint");
  });

  it("keeps a newer local responsive target ahead of an older app-state echo", () => {
    const persistence = source.slice(
      source.indexOf("const persistActiveBreakpoint"),
      source.indexOf('// §6.4 — "show all breakpoints" toggle'),
    );
    expect(persistence).toContain(
      "activeBreakpointWriteQueueRef.current?.enqueue",
    );

    const sync = source.slice(
      source.indexOf("// Item 9 — agent→UI breakpoint sync"),
      source.indexOf("// Agent→UI: open the write-consent dialog"),
    );
    expect(
      sync.match(/activeBreakpointWriteQueueRef\.current\?\.hasPending\(\)/g),
    ).toHaveLength(2);
  });

  it("BP-DEEP item 5: every overview click-to-target path returns the edit scope to Base", () => {
    const resets =
      editorSurface.match(/handleBreakpointBarSelect\(undefined\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(5);
    const escape = commandSource("escape-hotkey.ts");
    expect(escape).toContain(
      "activeBreakpointWidthStateRef.current !== undefined",
    );
    expect(escape).toContain("handleBreakpointBarSelect(undefined)");
  });

  it("BP-DEEP v2 item 6: change-width uses one same-id update mutation", () => {
    const handler = source.slice(
      source.indexOf("const handleBreakpointChangeWidth"),
      source.indexOf("const handleOverviewAddBreakpoint"),
    );
    expect(handler).toMatch(/updateBreakpointMutation\s*\.mutateAsync/);
    expect(handler).not.toContain("removeBreakpointMutation.mutateAsync");
    expect(handler).not.toContain("addBreakpointMutation.mutateAsync");
    expect(handler).toContain(
      "activeBreakpointWidthStateRef.current === existing.widthPx",
    );
    expect(handler).toContain(
      "handleBreakpointBarSelect(widthPx, breakpointId)",
    );
    expect(handler).toContain("if (!result?.updated)");
    expect(handler).toContain("result?.reason");
    expect(handler).toContain("collabReconcilePending");
    expect(handler).toContain("visualEditor.changesSaveWhenReconnected");
    const updateIndex = handler.search(
      /updateBreakpointMutation\s*\.mutateAsync/,
    );
    const retargetIndex = handler.indexOf(
      "handleBreakpointBarSelect(widthPx, breakpointId)",
    );
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(retargetIndex).toBeGreaterThan(updateIndex);
  });

  it("keeps Enter handling local in the overview breakpoint width input", () => {
    const menuStart = canvasSource.indexOf("onChangeBreakpointWidth ? (");
    const widthInput = canvasSource.slice(
      menuStart,
      canvasSource.indexOf("</DropdownMenuContent>", menuStart),
    );

    expect(menuStart).toBeGreaterThanOrEqual(0);
    expect(widthInput).toContain("onKeyDownCapture");
  });

  it("BP-DEEP v2 item 6: an update failure surfaces without a second breakpoint mutation", () => {
    const handler = source.slice(
      source.indexOf("const handleBreakpointChangeWidth"),
      source.indexOf("const handleOverviewAddBreakpoint"),
    );
    expect(handler).toMatch(/updateBreakpointMutation\s*\.mutateAsync/);
    expect(handler).toContain(".catch((error) => {");
    expect(handler).toContain("toast.error");
    expect(handler).not.toContain("removeBreakpointMutation.mutateAsync");
  });

  it("gates overview side-by-side frames on the show-all toggle", () => {
    const overviewScreensSource = readFileSync(
      "app/pages/design-editor/derive/overview-screens.ts",
      "utf8",
    );
    expect(overviewScreensSource).toContain("!breakpointFramesHidden &&");
    expect(source).toContain("breakpointFramesHidden,");
  });

  it("optimistically patches breakpointSet and shows pending feedback on add/remove/update", () => {
    expect(source).toContain("optimisticAddBreakpointData");
    expect(source).toContain("optimisticRemoveBreakpointData");
    expect(source).toContain("beginOptimisticBreakpointSetPatch");
    expect(source).toContain("breakpointMutationPending={");
    expect(source).toContain("addBreakpointMutation.isPending");
    expect(source).toContain("removeBreakpointMutation.isPending");
    expect(source).toContain("updateBreakpointMutation.isPending");
    const addHandler = source.slice(
      source.indexOf("const addDesignBreakpoint"),
      source.indexOf("const handleBreakpointBarAdd"),
    );
    expect(addHandler).toContain("beginOptimisticBreakpointSetPatch");
    expect(addHandler.indexOf("optimisticAddBreakpointData")).toBeLessThan(
      addHandler.indexOf("addBreakpointMutation"),
    );
    expect(addHandler).toContain("id: optimisticId");
    const removeHandler = source.slice(
      source.indexOf("const handleBreakpointBarRemove"),
      source.indexOf("const handleBreakpointChangeWidth"),
    );
    expect(removeHandler).toContain("optimisticRemoveBreakpointData");
    expect(
      removeHandler.indexOf("optimisticRemoveBreakpointData"),
    ).toBeLessThan(removeHandler.indexOf("removeBreakpointMutation"));
  });

  it("stamps the active breakpoint scope onto pending gesture edits", () => {
    const recorder = commandSource("record-pending-visual-style-edit.ts");
    expect(recorder).toContain("breakpoint: {");
    expect(recorder).toContain("activeWidthPx: activeBreakpointWidthState");
    expect(recorder).toContain("upperBoundPx: activeBreakpointUpperBoundPx");
  });

  it("derives the Framer bound from breakpoints + the base frame width", () => {
    expect(source).toContain("const activeBreakpointUpperBoundPx");
    expect(source).toContain("breakpointUpperBoundPx(");
    expect(source).toContain("activeScreenBaseWidthPx");
  });

  it("never falls back to a base inline write while a breakpoint is active", () => {
    const commitVisualStylesSource = readFileSync(
      "app/pages/design-editor/commands/commit-visual-styles.ts",
      "utf8",
    );
    const start = commitVisualStylesSource.indexOf(
      "const commitResolution = resolveVisualStyleCommitContent",
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const fallback = commitVisualStylesSource.slice(start, start + 400);
    expect(fallback).toContain(
      "breakpointScoped: activeBreakpointUpperBoundPx != null",
    );
  });

  it("item 7b: Delete routes through a display:none scoped write, not structural removal, while a breakpoint is active", () => {
    const handler = readFileSync(
      "app/pages/design-editor/commands/delete-selection.ts",
      "utf8",
    );
    expect(handler).toContain("useBreakpointScopedDelete");
    expect(handler).toContain('property: "display"');
    expect(handler).toContain('value: "none"');
    expect(handler).toContain("applyScopedVisualStyleEdit");
    expect(handler).toContain("removeCodeLayerNodeFromHtml");
    expect(handler).toContain("removeElementFromHtml");

    const singleElementStart = handler.indexOf(
      "// Item 7b — same breakpoint-scoped display:none routing",
    );
    const multiElementBranch = handler.slice(0, singleElementStart);
    expect(multiElementBranch).toContain(
      "file.id === activeFile?.id && !useBreakpointScopedDelete",
    );
    expect(multiElementBranch).toContain(
      "if (updated && useBreakpointScopedDelete)",
    );
    expect(multiElementBranch).toContain(
      "syncLiveScreenSnapshotPreview(file.id, content)",
    );
    expect(multiElementBranch).toMatch(
      /if \(shouldDeleteActiveLiveDom\) \{\s*deleteFromLiveDom\(activeRuntimeSelectors\);/,
    );
    const singleElementEnd = handler.indexOf(
      "const nextContent = removeElementFromHtml",
      singleElementStart,
    );
    const singleElementBranch = handler.slice(
      singleElementStart,
      singleElementEnd,
    );
    expect(singleElementStart).toBeGreaterThanOrEqual(0);
    expect(singleElementEnd).toBeGreaterThan(singleElementStart);
    expect(singleElementBranch).not.toContain("deleteFromLiveDom(");
    expect(singleElementBranch).toContain(
      "syncLiveScreenSnapshotPreview(activeFile!.id, patch.content)",
    );
  });

  it("item 8b: overview breakpoint frame '…' menu and full-view callbacks are wired to MultiScreenCanvas", () => {
    expect(source).toContain("onRemoveBreakpoint={");
    expect(source).toContain("onChangeBreakpointWidth={");
    expect(source).toContain("onEditBreakpoint={handleOverviewEditBreakpoint}");
    const remover = source.slice(
      source.indexOf("const handleOverviewRemoveBreakpoint"),
      source.indexOf("const handleOverviewChangeBreakpointWidth"),
    );
    expect(remover).toContain("handleBreakpointBarRemove(bp.id)");
    const changer = source.slice(
      source.indexOf("const handleOverviewChangeBreakpointWidth"),
      source.indexOf("const handleOverviewEditBreakpoint"),
    );
    expect(changer).toContain(
      "handleBreakpointChangeWidth(bp.id, nextWidthPx)",
    );
    const editor = source.slice(
      source.indexOf("const handleOverviewEditBreakpoint"),
      source.indexOf("// Hooks must not be called conditionally"),
    );
    expect(editor).toContain("handleOverviewFrameAction(screenId)");
  });

  it("restores the focused responsive view while keeping the overview iframe mounted", () => {
    const modeHandler = commandSource("mode-change.ts");
    expect(modeHandler).toContain("resolveModeChangeView({");
    expect(modeHandler).toContain('if (routing === "enter-single-interact")');
    expect(modeHandler).toContain("enterSingleScreen(nextActiveFile?.id)");
    expect(modeHandler).toContain('if (routing === "enter-overview")');
    expect(modeHandler).toContain("enterOverviewFromZoom(next)");
    expect(source).toContain(
      'mode === "interact" && !overviewInteractScreenId',
    );
    expect(modeHandler).toContain(
      "setOverviewInteractScreenId(nextActiveFile!.id)",
    );
    expect(source).toContain("focusedInteractViewport={");
    expect(source).toContain("overviewInteractScreenId === activeFileId) ? (");
    expect(canvasSource).toContain("focusedInteractViewport");
    expect(source).toContain(
      'currentMode === "annotate" ? "annotate" : "edit"',
    );

    const frameActionStart = source.indexOf(
      "const handleOverviewFrameAction = useCallback",
    );
    const frameAction = source.slice(
      frameActionStart,
      source.indexOf("  useEffect(() => {", frameActionStart),
    );
    expect(frameAction).toContain(
      'handleModeChange("interact", { targetFileId: screenId })',
    );
  });

  it("item 8b: single-view already renders at the active breakpoint's width on entry", () => {
    const propStart = source.indexOf("previewWidthPx={");
    expect(propStart).toBeGreaterThan(-1);
    const propExpression = source.slice(propStart, propStart + 240);
    expect(propExpression).toContain("activeBreakpointWidthState");
  });
});

describe("shouldPopToOverviewOnZoomOut (BP-DEEP v2 item 2 — focused-view flicker)", () => {
  const threshold = 60;

  it("never pops on entry (no previously observed single-view zoom)", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: null, zoom: 16, threshold }),
    ).toBe(false);
  });

  it("pops when the user crosses the threshold from above in single view", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 62, zoom: 48, threshold }),
    ).toBe(true);
  });

  it("does not pop while zooming further below an already-sub-threshold zoom", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 30, zoom: 25, threshold }),
    ).toBe(false);
  });

  it("does not pop at or above the threshold", () => {
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 100, zoom: 60, threshold }),
    ).toBe(false);
    expect(
      shouldPopToOverviewOnZoomOut({ previousZoom: 40, zoom: 100, threshold }),
    ).toBe(false);
  });

  it("ignores non-finite zoom values", () => {
    expect(
      shouldPopToOverviewOnZoomOut({
        previousZoom: 100,
        zoom: Number.NaN,
        threshold,
      }),
    ).toBe(false);
  });
});

describe("parseBreakpointWidthInput (BP-DEEP v2 item 6 — add/change width)", () => {
  it("parses an in-range integer width", () => {
    expect(parseBreakpointWidthInput("810", [390])).toBe(810);
  });

  it("rejects non-numeric, out-of-range, and duplicate widths", () => {
    expect(parseBreakpointWidthInput("", [])).toBeNull();
    expect(parseBreakpointWidthInput("abc", [])).toBeNull();
    expect(parseBreakpointWidthInput("100", [])).toBeNull();
    expect(parseBreakpointWidthInput("5000", [])).toBeNull();
    expect(parseBreakpointWidthInput("390", [390, 810])).toBeNull();
  });

  it("accepts a width equal to the one being changed when the caller excludes it", () => {
    expect(parseBreakpointWidthInput("810", [390])).toBe(810);
  });
});
