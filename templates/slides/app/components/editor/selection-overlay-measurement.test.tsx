// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  createSelectionOverlayAutofitKey,
  createSelectionOverlayMeasurementKey,
  currentSelectionOverlayRect,
  isSelectionOverlayAutofitSettled,
  isSelectionOverlayOnActiveSlide,
  type SelectionOverlayMeasurement,
} from "./selection-overlay-measurement";

function rect(left: number): DOMRect {
  return {
    bottom: 40,
    height: 20,
    left,
    right: left + 100,
    top: 20,
    width: 100,
    x: left,
    y: 20,
    toJSON: () => ({}),
  } as DOMRect;
}

function measurementKey(
  objectId: string,
  content: string,
  revision = 0,
  canvasZoom = 100,
) {
  return createSelectionOverlayMeasurementKey({
    slideId: "slide-1",
    content,
    objectId,
    selector: `[data-slide-object-id="${objectId}"]`,
    path: [0],
    canvasZoom,
    revision,
  });
}

function SelectionOverlayHarness({
  objectId,
  content,
  currentRect,
  revision = 0,
  canvasZoom = 100,
  selectionSlideId = "slide-1",
  activeSlideId = "slide-1",
  onRender,
}: {
  objectId: string;
  content: string;
  currentRect: DOMRect;
  revision?: number;
  canvasZoom?: number;
  selectionSlideId?: string;
  activeSlideId?: string;
  onRender: (left: number | null) => void;
}) {
  const key = measurementKey(objectId, content, revision, canvasZoom);
  const [measurement, setMeasurement] =
    useState<SelectionOverlayMeasurement | null>(null);
  const selectionIsOnActiveSlide = isSelectionOverlayOnActiveSlide(
    selectionSlideId,
    activeSlideId,
  );
  const visibleRect = selectionIsOnActiveSlide
    ? currentSelectionOverlayRect(measurement, key)
    : null;
  onRender(visibleRect?.left ?? null);

  useLayoutEffect(() => {
    if (!selectionIsOnActiveSlide) {
      setMeasurement(null);
      return;
    }
    setMeasurement({ key, rect: currentRect });
  }, [currentRect, key, selectionIsOnActiveSlide]);

  return visibleRect ? (
    <div data-selection-overlay-left={visibleRect.left} />
  ) : null;
}

function AutofitSelectionOverlayHarness({
  autofitSettled,
  currentRect,
  onRender,
}: {
  autofitSettled: boolean;
  currentRect: DOMRect;
  onRender: (left: number | null) => void;
}) {
  const key = measurementKey("object-a", "autofit content");
  const [measurement, setMeasurement] =
    useState<SelectionOverlayMeasurement | null>(null);
  const visibleRect = isSelectionOverlayAutofitSettled(
    autofitSettled ? key : null,
    key,
  )
    ? currentSelectionOverlayRect(measurement, key)
    : null;
  onRender(visibleRect?.left ?? null);

  useLayoutEffect(() => {
    if (!autofitSettled) {
      setMeasurement(null);
      return;
    }

    setMeasurement({ key, rect: currentRect });
  }, [autofitSettled, currentRect, key]);

  return visibleRect ? (
    <div data-selection-overlay-left={visibleRect.left} />
  ) : null;
}

describe("selection overlay measurement", () => {
  it("never renders stale coordinates while selection identity changes", () => {
    const renderedLefts: Array<number | null> = [];
    const view = render(
      <SelectionOverlayHarness
        objectId="object-a"
        content="first render"
        currentRect={rect(120)}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    expect(
      view.container.firstElementChild?.getAttribute(
        "data-selection-overlay-left",
      ),
    ).toBe("120");

    const beforeChange = renderedLefts.length;
    view.rerender(
      <SelectionOverlayHarness
        objectId="object-b"
        content="promoted raw HTML"
        currentRect={rect(560)}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    expect(renderedLefts.slice(beforeChange)).toEqual([null, 560]);
    expect(
      view.container.firstElementChild?.getAttribute(
        "data-selection-overlay-left",
      ),
    ).toBe("560");
  });

  it("invalidates a previous measurement when canvas geometry changes", () => {
    const oldKey = measurementKey("object-a", "first render");
    const currentKey = createSelectionOverlayMeasurementKey({
      slideId: "slide-1",
      content: "first render",
      objectId: "object-a",
      selector: '[data-slide-object-id="object-a"]',
      path: [0],
      canvasZoom: 75,
      revision: 0,
    });

    expect(
      currentSelectionOverlayRect({ key: oldKey, rect: rect(120) }, currentKey),
    ).toBeNull();
  });

  it("hides the old rect while the same object receives new geometry", () => {
    const renderedLefts: Array<number | null> = [];
    const view = render(
      <SelectionOverlayHarness
        objectId="object-a"
        content="same content"
        currentRect={rect(120)}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );
    const beforeChange = renderedLefts.length;

    view.rerender(
      <SelectionOverlayHarness
        objectId="object-a"
        content="same content"
        currentRect={rect(560)}
        revision={1}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    expect(renderedLefts.slice(beforeChange)).toEqual([null, 560]);
    expect(
      view.container.firstElementChild?.getAttribute(
        "data-selection-overlay-left",
      ),
    ).toBe("560");
  });

  it("does not paint an overlay until AutoFit has the current viewport rect", () => {
    const renderedLefts: Array<number | null> = [];
    const view = render(
      <AutofitSelectionOverlayHarness
        autofitSettled={false}
        currentRect={rect(120)}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    expect(view.container.firstElementChild).toBeNull();
    const beforeSettle = renderedLefts.length;

    view.rerender(
      <AutofitSelectionOverlayHarness
        autofitSettled
        currentRect={rect(560)}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    expect(renderedLefts.slice(beforeSettle)).toEqual([null, 560]);
    expect(
      view.container.firstElementChild?.getAttribute(
        "data-selection-overlay-left",
      ),
    ).toBe("560");
  });

  it("remeasures selected chrome after zoom changes", () => {
    const renderedLefts: Array<number | null> = [];
    const view = render(
      <SelectionOverlayHarness
        objectId="object-a"
        content="same content"
        currentRect={rect(120)}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    const beforeZoom = renderedLefts.length;
    view.rerender(
      <SelectionOverlayHarness
        objectId="object-a"
        content="same content"
        currentRect={rect(150)}
        canvasZoom={125}
        onRender={(left) => renderedLefts.push(left)}
      />,
    );
    expect(renderedLefts.slice(beforeZoom)).toEqual([null, 150]);
    expect(
      view.container.firstElementChild?.getAttribute(
        "data-selection-overlay-left",
      ),
    ).toBe("150");
  });

  it("keeps the intrinsic AutoFit epoch settled across editor-only geometry", () => {
    const autofitKey = createSelectionOverlayAutofitKey(
      "slide-1",
      "same content",
    );
    const zoomedMeasurementKey = measurementKey(
      "object-a",
      "same content",
      0,
      125,
    );

    expect(isSelectionOverlayAutofitSettled(autofitKey, autofitKey)).toBe(true);
    expect(zoomedMeasurementKey).not.toBe(
      measurementKey("object-a", "same content"),
    );
  });

  it("never resolves a previous slide's selection in the active slide", () => {
    const renderedLefts: Array<number | null> = [];
    const view = render(
      <SelectionOverlayHarness
        objectId="object-a"
        content="slide one"
        currentRect={rect(120)}
        selectionSlideId="slide-1"
        activeSlideId="slide-1"
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    const beforeSlideChange = renderedLefts.length;
    view.rerender(
      <SelectionOverlayHarness
        objectId="object-a"
        content="slide two"
        currentRect={rect(560)}
        selectionSlideId="slide-1"
        activeSlideId="slide-2"
        onRender={(left) => renderedLefts.push(left)}
      />,
    );

    expect(
      renderedLefts.slice(beforeSlideChange).every((left) => left === null),
    ).toBe(true);
    expect(view.container.firstElementChild).toBeNull();
  });
});
