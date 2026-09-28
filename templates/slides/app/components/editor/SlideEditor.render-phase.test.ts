import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);
describe("SlideEditor render-phase safety", () => {
  it("never passes an updater function to setEditingEl", () => {
    const updaterCalls = source.match(
      /setEditingEl\(\s*(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/g,
    );
    expect(updaterCalls).toBeNull();
  });

  it("never flushes onUpdateSlide from inside a setState updater", () => {
    const offenders = [
      ...source.matchAll(
        /set[A-Z][\w$]*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      ),
    ].filter((match) => {
      const body = source.slice(match.index, match.index + 600);
      return /onUpdateSlideRef/i.test(body);
    });
    expect(offenders.map((m) => m[0])).toEqual([]);
  });

  it("flushes an active inline draft before browser teardown", () => {
    expect(source).toContain("flushPendingSaves");
    expect(source).toContain(
      'window.addEventListener("beforeunload", flushInlineEditDraft',
    );
    expect(source).toContain(
      'window.addEventListener("pagehide", flushInlineEditDraft',
    );
    expect(source).toContain(
      'document.addEventListener("visibilitychange", flushWhenHidden',
    );
  });

  it("keeps the live draft ref across lifecycle flushes", () => {
    const start = source.indexOf("const flushInlineEditDraft");
    const end = source.indexOf("const flushWhenHidden", start);
    const flushBody = source.slice(start, end);
    expect(flushBody).toContain("flushPendingSaves();");
    expect(flushBody).not.toContain("inlineEditDraftRef.current = null");
    expect(flushBody).not.toContain("onUpdateSlideRef.current");
  });

  it("promotes every selected root before a shared keyboard nudge", () => {
    const nudgeStart = source.indexOf(
      "const nudge = resolveSlidesCanvasNudge(e);",
    );
    const singleNudgeStart = source.indexOf(
      "// Arrow nudging is also a first-class way to move flow-layout text",
      nudgeStart,
    );
    const multiNudgeBody = source.slice(nudgeStart, singleNudgeStart);

    expect(multiNudgeBody).toContain(
      "freezeElementForFreeformSelection(element)",
    );
    expect(multiNudgeBody).toContain(
      "applySlideObjectMoveDelta(members, dx, dy, applyObjectGeometry)",
    );
    expect(multiNudgeBody).toContain(
      "commitMultiObjectChange(\n          members.map((member) => member.objectId),\n          html,",
    );
    expect(multiNudgeBody).not.toContain(
      "elements.some((element) => !isPersistedFreeformObject(element))",
    );
  });

  it("queues the latest draft before ending the text session", () => {
    const start = source.indexOf("const endTextSession");
    const end = source.indexOf("const flushInlineEditDraft", start);
    const endBody = source.slice(start, end);

    expect(endBody).toContain("session.text.end();");
    expect(endBody).toContain(
      "persistInlineEditDraft(session.slideId, content)",
    );
    expect(endBody.indexOf("session.text.end();")).toBeLessThan(
      endBody.indexOf("persistInlineEditDraft"),
    );
  });

  it("edits the element in place and never touches document.body", () => {
    const enterStart = source.indexOf("const enterInlineEdit");
    const enterEnd = source.indexOf("// Exit edit mode", enterStart);
    const enterBody = source.slice(enterStart, enterEnd);

    expect(enterBody).toContain("startInPlaceTextSession(el,");
    expect(enterBody).not.toContain("document.body");
    expect(enterBody).not.toContain("cloneNode");
    expect(enterBody).not.toContain("visibility");
    expect(enterBody).not.toContain("createRoot");
    expect(source).not.toContain("slide-rich-editor");
    expect(source).not.toContain("@tiptap");
  });

  it("serializes the live slide root the element is edited in", () => {
    const readStart = source.indexOf("const readCurrentSlideContentHtml");
    const readEnd = source.indexOf(
      "const readCurrentSlideContentHtmlRef",
      readStart,
    );
    const endStart = source.indexOf("const endTextSession");
    const endEnd = source.indexOf("const flushInlineEditDraft", endStart);

    expect(source.slice(readStart, readEnd)).toContain(
      "getRenderedSlideSource(slideContent)",
    );
    expect(source.slice(endStart, endEnd)).toContain(
      "slideContent.contains(element)",
    );
  });

  it("saves raw slides by merging into the stored source, never the rendered DOM", () => {
    const serializeStart = source.indexOf("const serializeSlideContentHtml");
    const serializeEnd = source.indexOf(
      "const readCurrentSlideContentHtml",
      serializeStart,
    );
    const serializeBody = source.slice(serializeStart, serializeEnd);
    const mergeAt = serializeBody.indexOf("mergeRenderedEdits(");
    const domAt = serializeBody.indexOf("stripBuilderIds(clone.innerHTML)");

    expect(mergeAt).toBeGreaterThan(-1);
    expect(
      serializeBody.slice(serializeBody.lastIndexOf("if (", domAt), domAt),
    ).toContain('hasAttribute("data-slide-autofit-root")');
    expect(serializeBody).toContain("return null;");
    expect(source).toContain("stampSource\n");
  });

  it("writes nothing for a click in and out", () => {
    const enterStart = source.indexOf("const enterInlineEdit");
    const enterEnd = source.indexOf("// Exit edit mode", enterStart);
    const enterBody = source.slice(enterStart, enterEnd);

    expect(enterBody).not.toContain("captureInlineEditDraft(");
    const baselineAt = enterBody.indexOf(
      "const entryContent = readCurrentSlideContentHtml();",
    );
    expect(baselineAt).toBeGreaterThan(-1);
    expect(enterBody.indexOf("startInPlaceTextSession(")).toBeGreaterThan(
      baselineAt,
    );

    const exitStart = source.indexOf("const exitInlineEdit = useCallback");
    const exitEnd = source.indexOf("const commitInlineEditForAgent", exitStart);
    const exitBody = source.slice(exitStart, exitEnd);
    const gateAt = exitBody.indexOf(
      "if (shouldPersistInlineEditContent(initial, current)) {",
    );
    expect(gateAt).toBeGreaterThan(-1);
    const writes = [...exitBody.matchAll(/OnUpdateSlideRef\.current\(/g)];
    expect(writes).toHaveLength(1);
    expect(writes[0].index).toBeGreaterThan(gateAt);

    const captureStart = source.indexOf("const captureInlineEditDraft");
    const captureEnd = source.indexOf(
      "const scheduleInlineEditDraftCapture",
      captureStart,
    );
    expect(source.slice(captureStart, captureEnd)).toContain(
      "!textSessionRef.current.text.changed",
    );
  });

  it("commits an open edit before any other content write or slide swap", () => {
    expect(source).toContain(
      "if (textSessionRef.current) exitInlineEditRef.current();",
    );
    const persistStart = source.indexOf("const persistInlineEditDraft");
    const persistEnd = source.indexOf(
      "const captureInlineEditDraft",
      persistStart,
    );
    expect(source.slice(persistStart, persistEnd)).toContain(
      "rawOnUpdateSlideRef.current({ content }, slideId, {",
    );
  });

  it("keeps the replacement listener mounted across Excalidraw-to-HTML swaps", () => {
    const boundaryRefAt = source.indexOf("ref={contentReplaceBoundaryRef}");
    const canvasBranchAt = source.indexOf(
      "{slide.excalidrawData ? (",
      boundaryRefAt,
    );
    expect(boundaryRefAt).toBeGreaterThan(-1);
    expect(canvasBranchAt).toBeGreaterThan(boundaryRefAt);

    const effectStart = source.indexOf("// Another slide's HTML");
    const effectEnd = source.indexOf(
      "// Keep canvas gesture handlers",
      effectStart,
    );
    const listenerEffect = source.slice(effectStart, effectEnd);
    expect(listenerEffect).toContain("contentReplaceBoundaryRef.current");
    expect(listenerEffect).toContain(
      "boundary.addEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);",
    );
    expect(listenerEffect).toContain(
      "boundary.removeEventListener(SLIDE_CONTENT_REPLACE_EVENT, commit);",
    );
    expect(listenerEffect).not.toContain("containerRef.current");
  });

  it("never lets a slide link on the editing canvas navigate", () => {
    expect(source).toMatch(
      /onClickCapture=\{\s*readOnly \? undefined : preventSlideLinkNavigation\s*\}/,
    );
    expect(source).toMatch(
      /onAuxClickCapture=\{\s*readOnly \? undefined : preventSlideLinkNavigation\s*\}/,
    );
  });

  it("edits a bullet row as part of its list", () => {
    const enterStart = source.indexOf("const enterInlineEdit");
    const enterEnd = source.indexOf("// Exit edit mode", enterStart);
    const enterBody = source.slice(enterStart, enterEnd);
    expect(enterBody).toContain("findEnclosingList(block, slideContent)");
    expect(enterBody).toMatch(
      /const el =\s+list &&\s+isRichTextBlock\(list\) &&\s+!holdsPaintedTextBox\(list, slideContent\)\s+\? list\s+: block;/,
    );
  });

  it("leaves an element under edit to its text session", () => {
    const start = source.indexOf("function stampBuilderIds");
    const end = source.indexOf("function layerLabel", start);
    expect(source.slice(start, end)).toContain(
      'if (element.getAttribute("contenteditable") === "true") return;',
    );
  });

  it("marks and strips only the outer rich-text layer", () => {
    expect(source).toContain(
      'element.setAttribute("data-slide-text-block", "true")',
    );
    expect(source).toContain(
      'element.querySelectorAll<HTMLElement>("[data-slide-text-block]")',
    );
    expect(source).toContain(
      'element.removeAttribute("data-slide-text-block")',
    );
    expect(source).toContain(
      '.replace(/\\s*data-slide-text-block="[^"]*"/g, "")',
    );
  });

  it("cancels stale draft capture before a slide switch can read the new DOM", () => {
    expect(source).toContain("const currentSlideIdRef = useRef(slide.id);");
    expect(source).toContain("currentSlideIdRef.current = slide.id;");
    expect(source).toContain("currentSlideIdRef.current !== slideId");
    expect(source).toContain("session?.slideId !== slideId");
  });

  it("selects persisted text boxes on plain click while keeping double-click editing", () => {
    const clickStart = source.indexOf("const handleSlideClick");
    const clickEnd = source.indexOf("const handleSlideDoubleClick", clickStart);
    const clickBody = source.slice(clickStart, clickEnd);
    expect(clickBody).toContain("includeTextBoxes: false");
    expect(clickBody).toContain("setSelectedImg(null);");
    expect(clickBody).toContain("setImageOverlay(null);");
    expect(clickBody).not.toContain("showImageOverlay");
    const doubleClickStart = source.indexOf("const handleSlideDoubleClick");
    const doubleClickEnd = source.indexOf(
      "const slideElementSelected =",
      doubleClickStart,
    );
    const doubleClickBody = source.slice(doubleClickStart, doubleClickEnd);
    expect(doubleClickBody).toContain(
      "findPersistedImageObject(resolvedTarget, slideContent)",
    );
    expect(doubleClickBody).toContain(
      'imageOwner?.querySelector<HTMLElement>("img")',
    );
    expect(doubleClickBody).not.toContain(
      'resolvedTarget.querySelector<HTMLElement>("img")',
    );
    expect(doubleClickBody).toContain(
      "showImageOverlay(imageTarget ?? imagePlaceholder ?? resolvedTarget);",
    );
    expect(doubleClickBody.indexOf("const resolvedTarget")).toBeLessThan(
      doubleClickBody.indexOf("const imageTarget"),
    );
    expect(source).toContain(
      "const block = findSmartBlock(resolvedTarget, slideContent);",
    );
  });

  it("keeps standalone transparent text boxes as canvas hit targets", () => {
    const helperStart = source.indexOf("function resolveSlideCanvasHitTarget");
    const helperEnd = source.indexOf(
      "const PASTED_TEXT_STYLE_PROPERTIES",
      helperStart,
    );
    const helperBody = source.slice(helperStart, helperEnd);

    expect(helperBody).toContain("candidate instanceof HTMLElement");
    expect(helperBody).toContain("candidate = candidate.parentElement;");
    expect(helperBody).toContain("element !== slideContent");
    expect(helperBody).toContain("return underlying ?? target;");
  });

  it("preserves wrapped images for double-click overlays", () => {
    const doubleClickStart = source.indexOf("const handleSlideDoubleClick");
    const doubleClickEnd = source.indexOf(
      "const slideElementSelected =",
      doubleClickStart,
    );
    const doubleClickBody = source.slice(doubleClickStart, doubleClickEnd);

    expect(doubleClickBody).toContain(
      "findPersistedImageObject(resolvedTarget, slideContent)",
    );
    expect(doubleClickBody).not.toContain(
      'resolvedTarget.querySelector<HTMLElement>("img")',
    );
    expect(doubleClickBody).toContain(
      "showImageOverlay(imageTarget ?? imagePlaceholder ?? resolvedTarget);",
    );
  });

  it("keeps nested rich-text ranges in observer selection snapshots", () => {
    const effectStart = source.indexOf(
      "const editingElement = editingElRef.current;",
    );
    const effectEnd = source.indexOf(
      "const positioningLayer = observedElement?.closest(",
      effectStart,
    );
    const effectBody = source.slice(effectStart, effectEnd);

    expect(effectBody).toContain(
      "resolveSlideTextSelectionTarget(editingElement, slideContent)",
    );
    expect(effectBody).toContain(
      "editingElement && resolvedEditingElement === element",
    );
  });

  it("drops an image overlay when reconciliation replaces its target", () => {
    const start = source.indexOf("// Content reconciliation can replace");
    const end = source.indexOf("// Stamp all elements", start);
    const body = source.slice(start, end);
    expect(body).toContain("target.isConnected");
    expect(body).toContain('target.getAttribute("src") === imageOverlay.src');
    expect(body).toContain("setImageOverlay(null);");
  });

  it("records arrange selection before replacing the live slide DOM", () => {
    const start = source.indexOf("const handleArrangeSelected");
    const end = source.indexOf("const handleToggleList", start);
    const arrangeBody = source.slice(start, end);
    const singleArrangeBody = arrangeBody.slice(
      arrangeBody.indexOf("const element =\n        liveContextMenuTarget"),
    );

    expect(singleArrangeBody.indexOf("selectElementForStyling")).toBeLessThan(
      singleArrangeBody.indexOf("onUpdateSlideRef.current"),
    );
  });

  it("arranges flow layers through the shared z-order primitive", () => {
    const start = source.indexOf("const handleArrangeSelected");
    const end = source.indexOf("const handleToggleList", start);
    const arrangeBody = source.slice(start, end);

    expect(arrangeBody).toContain("arrangeSlideLayerInParent(element, target)");
    expect(arrangeBody).toContain("isPersistedFreeformObject(element)");
    expect(arrangeBody).toContain("resolveSlidePositioningLayer(element)");
    expect(source).toContain("persistSlideObjectZOrderFromDom(source");
    expect(source).toContain("function isZIndexedSlideLayer");
    expect(source).not.toContain("function reorderSlideLayerInParent");
    expect(source).not.toContain("function arrangeFlowSlideLayerInParent");
  });

  it("keeps portaled context-menu presses from clearing canvas selection", () => {
    const start = source.indexOf("const handleCanvasBackgroundPointerDown");
    const end = source.indexOf("const handleSlideContextMenu", start);
    const pointerDownBody = source.slice(start, end);

    expect(pointerDownBody).toContain(
      'target?.closest("[data-radix-menu-content]")',
    );
    expect(pointerDownBody.indexOf("data-radix-menu-content")).toBeLessThan(
      pointerDownBody.indexOf("clearCanvasSelection"),
    );
  });

  it("claims Delete before the deck-level slide shortcut when an object is selected", () => {
    const selectionStart = source.indexOf("const slideElementSelected =");
    const selectionEnd = source.indexOf(
      "// Flow objects are promoted",
      selectionStart,
    );
    expect(source.slice(selectionStart, selectionEnd)).toContain(
      "!!selectedElementSelector",
    );

    const deleteStart = source.indexOf(
      "// Delete/Backspace removes the selected slide content",
    );
    const deleteEnd = source.indexOf(
      "/**\n   * Find the nearest meaningful element",
      deleteStart,
    );
    const deleteBody = source.slice(deleteStart, deleteEnd);
    expect(deleteBody).toContain(
      'window.addEventListener("keydown", onKey, true)',
    );
    expect(deleteBody).toContain("e.stopPropagation()");
  });

  it("leaves Delete with a focused thumbnail", () => {
    const deleteStart = source.indexOf(
      "// Delete/Backspace removes the selected slide content",
    );
    const deleteEnd = source.indexOf(
      "/**\n   * Find the nearest meaningful element",
      deleteStart,
    );

    expect(source.slice(deleteStart, deleteEnd)).toContain(
      'active.closest("[data-slide-thumbnail-id]")',
    );
  });

  it("keeps object clipboard shortcuts scoped to the focused slide canvas", () => {
    const keyStart = source.indexOf(
      "// One window listener for object copy/paste/duplicate",
    );
    const pasteStart = source.indexOf(
      "// The native paste event is authoritative",
      keyStart,
    );
    const appearanceStart = source.indexOf(
      "// Appearance clipboard shortcuts",
      pasteStart,
    );
    const placementStart = source.indexOf(
      "const placeTextBoxAt = useCallback",
      appearanceStart,
    );

    expect(source.slice(keyStart, pasteStart)).toContain(
      "isSlideCanvasShortcutTarget(active, slideCanvasRef.current)",
    );
    expect(source.slice(pasteStart, appearanceStart)).toContain(
      "isSlideCanvasShortcutTarget(active, slideCanvasRef.current)",
    );
    expect(source.slice(appearanceStart, placementStart)).toContain(
      "isSlideCanvasShortcutTarget(active, slideCanvasRef.current)",
    );
  });

  it("ends native text editing before entering a multi-selection", () => {
    const start = source.indexOf("const applyMultiSelection");
    const end = source.indexOf("const clearMultiSelection", start);
    const multiSelectionBody = source.slice(start, end);

    expect(multiSelectionBody).toContain(
      "if (ids.size > 0 && editingElRef.current) exitInlineEdit();",
    );
    expect(source).toContain("window.getSelection()?.removeAllRanges();");
  });

  it("does not let selection rerenders clear a newly selected object set", () => {
    const start = source.indexOf("const applyMultiSelectionRef");
    const end = source.indexOf("// One Escape owner", start);
    const reconciliationBody = source.slice(start, end);

    expect(reconciliationBody).toContain(
      "applyMultiSelectionRef.current(new Set());",
    );
    expect(reconciliationBody).toContain(
      "applyMultiSelectionRef.current(ids);",
    );
    expect(reconciliationBody).toContain(
      "}, [slide.content, getSlideContent]);",
    );
    expect(reconciliationBody).not.toContain(
      "[slide.content, getSlideContent, applyMultiSelection]",
    );
  });

  it("collapses a grouped multi-selection to the new group", () => {
    const start = source.indexOf("const handleGroupSelected");
    const end = source.indexOf("const handleUngroupSelected", start);
    const groupBody = source.slice(start, end);

    expect(groupBody.indexOf("ensureBuilderId(group)")).toBeLessThan(
      groupBody.indexOf("getBuilderSelector(group)"),
    );
    expect(groupBody.indexOf("clearMultiSelection();")).toBeLessThan(
      groupBody.indexOf("selectElementForStyling(group, selector)"),
    );
  });

  it("lets additive canvas selection leave an active text edit", () => {
    const start = source.indexOf("const handleSlidePointerDown");
    const end = source.indexOf(
      "// Keep these listeners stable while React re-renders the marquee overlay.",
      start,
    );
    const pointerDownBody = source.slice(start, end);

    expect(pointerDownBody).toContain("const additive =");
    expect(pointerDownBody).toContain("const targetIsEditingBlock =");
    expect(pointerDownBody).toContain("exitInlineEdit();");
  });

  it("pastes plain clipboard text as a selected text box outside text editing", () => {
    const pasteStart = source.indexOf("const pasteTextAsTextBox");
    const pasteEnd = source.indexOf("const placeShapeAt", pasteStart);
    const pasteBody = source.slice(pasteStart, pasteEnd);

    expect(pasteBody).toContain('getData("text/plain")');
    expect(pasteBody).toContain('getData("text/html")');
    expect(pasteBody).toContain("normalizeSlideClipboardHtml");
    expect(pasteBody).toContain("applyPastedTextPresentation");
    expect(pasteBody).toContain("placeTextBoxAt(");
    expect(pasteBody).toContain("selectElementForStyling(box, selector)");
    expect(pasteBody).toContain(
      'window.addEventListener("paste", onPaste, true)',
    );
    expect(pasteBody).toContain("text,\n        false,");
    expect(pasteBody).toContain(
      "const renderedHeight = Math.max(height, box.offsetHeight)",
    );
    expect(pasteBody).toContain(
      "if (y > renderedMaxY) box.style.top = `${renderedMaxY}px`",
    );
    expect(pasteBody).toContain("box.style.maxHeight = `${slideHeight}px`");
    expect(pasteBody).toContain('box.style.overflowY = "auto"');
    expect(source).toContain('box.style.overflowWrap = "anywhere"');
  });

  it("lets HTML-only native paste beat a stale object clipboard", () => {
    const pasteStart = source.indexOf(
      "// The native paste event is authoritative",
    );
    const pasteEnd = source.indexOf(
      "// Appearance clipboard shortcuts",
      pasteStart,
    );
    const pasteBody = source.slice(pasteStart, pasteEnd);

    expect(pasteBody).toContain('type.startsWith("text/")');
    expect(pasteBody).toContain("e.clipboardData?.getData(type)?.length");
    expect(pasteBody).toContain("if (hasNativeText) return;");
  });

  it("uses the native layer marker instead of a timer to arbitrate paste", () => {
    expect(source).toContain("writeSlideObjectClipboard");
    expect(source).toContain("readSlideObjectClipboardId");
    expect(source).toContain("overlappingNativeClipboardIdsRef");
    expect(source).toContain("copySessionId");
    expect(source).toContain('window.addEventListener("blur"');
    expect(source).not.toContain("objectPasteFallbackRef");
    const pasteStart = source.indexOf("const onPaste = (e: ClipboardEvent)");
    const pasteEnd = source.indexOf(
      "// Appearance clipboard shortcuts",
      pasteStart,
    );
    const pasteBody = source.slice(pasteStart, pasteEnd);
    expect(pasteBody.indexOf("nativeClipboardId")).toBeLessThan(
      pasteBody.indexOf("const hasNativeText"),
    );
    expect(pasteBody).toContain(
      "overlappingNativeClipboardIdsRef.current.get(nativeClipboardId)",
    );
    expect(pasteBody.indexOf("const hasNativeText")).toBeLessThan(
      pasteBody.indexOf('clipboard.nativeClipboardMode === "pending"'),
    );
    expect(pasteBody).toContain('clipboard.nativeClipboardMode === "pending"');
    expect(pasteBody).toContain('clipboard.nativeClipboardMode === "failed"');
    expect(pasteBody).not.toContain("clipboard.clipboardText");
    expect(source).toContain(
      "copySlideObjects(selection, storedFormOfCopy),\n      selection[0],",
    );
  });

  it("re-measures portaled selection chrome after the editor layout moves", () => {
    const start = source.indexOf("const refreshMultiSelectionRects");
    const end = source.indexOf("// Keep cached rects fresh", start);
    const layoutBody = source.slice(start, end);

    expect(layoutBody).toContain("useLayoutEffect(() => {");
    expect(layoutBody).toContain(
      'scrollContainer.closest(".deck-editor-workspace")',
    );
    expect(layoutBody).toContain("new ResizeObserver(update)");
    expect(layoutBody).toContain("new MutationObserver(update)");
    expect(layoutBody).toContain("invalidateSelectionOverlayMeasurement();");
  });
});
