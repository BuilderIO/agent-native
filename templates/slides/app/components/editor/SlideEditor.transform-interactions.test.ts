import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);

describe("SlideEditor transformed-object interactions", () => {
  it("uses pointer-down transforms for grouped and rotated previews", () => {
    const resizeStart = editorSource.indexOf("const startElementResize =");
    const resizeEnd = editorSource.indexOf(
      "const startGroupResize =",
      resizeStart,
    );
    expect(resizeStart).toBeGreaterThanOrEqual(0);
    expect(resizeEnd).toBeGreaterThan(resizeStart);
    const resizeSource = editorSource.slice(resizeStart, resizeEnd);

    expect(resizeSource).toContain("readSlideObjectTransformSnapshot(element)");
    expect(resizeSource).toContain("gesture.canvasDelta.x");
    expect(resizeSource).toContain("gesture.canvasDelta.y");
    expect(resizeSource).toContain("readSlideObjectTransformSnapshot(child)");
    expect(resizeSource).toContain(
      "member.element.style.transform = plan.transform",
    );
    expect(resizeSource).toContain(
      "member.element.style.transformOrigin = plan.transformOrigin",
    );

    const rotateStart = editorSource.indexOf("const startRotateSelection =");
    const rotateEnd = editorSource.indexOf(
      "useEffect(() => {\n    if (readOnly || editingEl)",
      rotateStart,
    );
    expect(rotateStart).toBeGreaterThanOrEqual(0);
    expect(rotateEnd).toBeGreaterThan(rotateStart);
    const rotateSource = editorSource.slice(rotateStart, rotateEnd);

    expect(rotateSource).toContain(
      "readSlideObjectTransformSnapshot(member.element)",
    );
    expect(rotateSource).toContain(
      "member.element.style.transform = next.transform",
    );
  });

  it("renders single-object handles in the measured local transform frame", () => {
    const outlineStart = editorSource.indexOf(
      "function ElementSelectionOutline(",
    );
    const outlineEnd = editorSource.indexOf(
      "/** Translucent rectangle",
      outlineStart,
    );
    const outlineSource = editorSource.slice(outlineStart, outlineEnd);

    expect(outlineSource).toContain("transform: frame?.transform");
    expect(outlineSource).toContain("frame.transformOrigin.x + pad");
    expect(editorSource).toContain("frame={selectedElementFrame}");
    expect(editorSource).toContain(
      "isSelectedElementDraggable && selectedElementFrame",
    );
    expect(editorSource).toContain("data-slide-move-handle");
    expect(editorSource).toContain(
      "selectedElementRect && !multiSelectionBounds",
    );
    expect(editorSource).toContain("allowBodyMove");
  });

  it("keeps drag chrome and snap guides in the object coordinate root", () => {
    const dragStart = editorSource.indexOf("const startElementDrag =");
    const dragEnd = editorSource.indexOf(
      "const startElementResize =",
      dragStart,
    );
    expect(dragStart).toBeGreaterThanOrEqual(0);
    expect(dragEnd).toBeGreaterThan(dragStart);
    const dragSource = editorSource.slice(dragStart, dragEnd);

    expect(dragSource).toContain(
      "resolveSlideObjectContainingBlock(\n            activeElement,",
    );
    expect(dragSource).toContain(
      "setSelectedElementMeasurement({\n            key: selectionOverlayMeasurementKeyRef.current,",
    );
    expect(dragSource).toContain(
      "readSlideObjectSelectionFrame(activeElement, rect)",
    );
    expect(dragSource).toContain(
      "updateAlignmentGuides(snap.guides, containingBlock, snapCanvas)",
    );

    const groupStart = editorSource.indexOf("const startGroupDrag =");
    const groupEnd = editorSource.indexOf(
      "const rotateSelectedObjects =",
      groupStart,
    );
    expect(groupStart).toBeGreaterThanOrEqual(0);
    expect(groupEnd).toBeGreaterThan(groupStart);
    const groupSource = editorSource.slice(groupStart, groupEnd);
    expect(groupSource).toContain("groupContainingBlock = containingBlock");
    expect(groupSource).toContain(
      "updateAlignmentGuides(snap.guides, containingBlock, snapCanvas)",
    );
  });

  it("refreshes layer hover geometry after canvas zoom and nested row transitions", () => {
    const hoverStart = editorSource.indexOf(
      "useLayoutEffect(() => {\n    if (!layersOpen || !hoveredLayerId)",
    );
    const hoverEnd = editorSource.indexOf(
      "useEffect(() => {\n    if (!layersOpen) setHoveredLayerId(null);",
      hoverStart,
    );
    expect(hoverStart).toBeGreaterThanOrEqual(0);
    expect(hoverEnd).toBeGreaterThan(hoverStart);
    expect(editorSource.slice(hoverStart, hoverEnd)).toContain(
      "[canvasZoom, getSlideContent, hoveredLayerId, layersOpen, slide.content]",
    );
    expect(editorSource).toContain(
      "setHoveredLayerId((current) => (current === id ? null : current))",
    );
  });
});
