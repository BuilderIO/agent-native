import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The bridge JS that was previously inlined in DesignCanvas.tsx now lives in
// editor-chrome.bridge.ts (compiled to .generated/bridge/editor-chrome.generated.ts).
// These tests check the bridge source for required implementation details.
const source = readFileSync(
  fileURLToPath(new URL("./bridge/editor-chrome.bridge.ts", import.meta.url)),
  "utf8",
);

describe("DesignCanvas spacing overlay bridge", () => {
  it("injects editable spacing chrome instead of the old passive padding inset", () => {
    expect(source).toContain("data-agent-native-spacing-overlay");
    expect(source).toContain("data-agent-native-spacing-region");
    expect(source).toContain("data-agent-native-spacing-badge");
    expect(source).not.toContain("data-agent-native-padding-overlay");
  });

  it("persists dragged padding and gap values through visual style changes", () => {
    expect(source).toContain("function startSpacingDrag");
    // Quote style may be single or double depending on formatter; check property access only
    expect(source).toContain("styles[handle.property] = finalValue +");
    expect(source).toContain("styles[handle.oppositeProperty] = finalValue +");
    expect(source).toContain("addAxisGaps");
    expect(source).toContain("columnGap");
    expect(source).toContain("rowGap");
  });

  it("keeps selected-element spacing affordances mounted without hover gating", () => {
    expect(source).not.toContain(
      "!selectedSpacingHovered && !hoveredSpacingHandleKey && !spacingDrag",
    );
    expect(source).toContain(
      "var activeHandle = spacingDrag ? spacingDrag.handle : null",
    );
    expect(source).not.toContain("handle.key === hoveredSpacingHandleKey");
  });

  it("keeps spacing handles stable while their hit regions are hovered", () => {
    expect(source).toContain("var spacingOverlayRenderKey =");
    expect(source).toContain("function ensureEditorChromeStyle");
    expect(source).toContain("function runtimeHeadHtmlWithoutEditorChrome");
    expect(source).toContain("data-agent-native-editor-chrome-style");
    expect(source).toContain("ensureEditorChromeStyle();");
    expect(source).toContain('lineNode.style.position = "absolute"');
    expect(source).toContain('regionNode.style.position = "absolute"');
    expect(source).toContain("function handleSpacingOverlayPointerMove");
    expect(source).toContain("function scheduleSpacingHoverClear");
    expect(source).toMatch(/regionNode\.addEventListener\(\s*"pointerdown"/);
    expect(source).toContain("function selectedSpacingSurfaceContainsPoint");
    expect(source).toContain("function shouldKeepSpacingOverlayForLeave");
    expect(source).toContain(
      "var region = spacingRegionFromPoint(clientX, clientY)",
    );
    expect(source).toContain("activateSpacingHandle(spacingKey)");
    expect(source).toContain(
      "return selectedSpacingSurfaceContainsPoint(e.clientX, e.clientY)",
    );
    expect(source).toContain("data-agent-native-spacing-region");
    expect(source).toContain("handleSpacingOverlayPointerMove");
    expect(source).toContain("shouldKeepSpacingOverlayForLeave(e)");
    expect(source).not.toContain("regionNode.addEventListener('mouseenter'");
    expect(source).not.toContain("regionNode.addEventListener('mouseleave'");
  });

  it("hit-tests through editor chrome instead of selecting injected overlays", () => {
    expect(source).toContain("document.elementsFromPoint");
    expect(source).toContain("if (isOverlayElement(target)) continue");
  });

  it("clicks children inside a selected parent while drags still move the parent", () => {
    expect(source).toContain("var clickTarget = hitTarget");
    expect(source).toMatch(
      /selectTarget\(\s*clickTarget \|\| dragTarget\s*,\s*ev\s*\)/,
    );
    expect(source).toMatch(/selectTarget\(\s*dragTarget\s*,\s*ev\s*\)/);
  });
});

describe("DesignCanvas text editing bridge", () => {
  it("uses selection chrome instead of double outlines while text is focused", () => {
    expect(source).toContain("function updateTextEditingChrome");
    expect(source).toContain('target.style.outline = ""');
    expect(source).toContain('selectionOverlay.style.display = "none"');
    expect(source).toContain("setSelectionOverlayResizeChromeVisible(false)");
    expect(source).toContain('target.addEventListener("input", onInput');
    expect(source).not.toContain(
      'target.style.outline = "1.5px solid var(--design-editor-accent-color)"',
    );
  });

  it("treats Escape as an unfocus/commit gesture for inline text", () => {
    expect(source).toContain('if (ev.key === "Escape")');
    expect(source).toContain("finish(true)");
    expect(source).not.toContain("finish(false)");
  });

  it("lets forced document replacements bypass active inline text editing", () => {
    expect(source).toContain("forceFullDocument?: boolean");
    expect(source).toContain("if (activeTextEditEl && !forceFullDocument)");
    expect(source).toContain("Boolean(e.data.forceFullDocument)");
  });
});
