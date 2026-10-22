// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cropRectToObjectViewBox,
  imageCropStyleEdits,
  objectViewBoxToCropRect,
} from "./image-crop-style";
import {
  Slides2ImageCropControls,
  type Slides2ImageCropResult,
} from "./Slides2ImageCropControls";

afterEach(cleanup);

describe("Slides2ImageCropControls", () => {
  it("keeps the initial aspect and bounds pointer and keyboard edits", () => {
    render(
      <Slides2ImageCropControls
        src="crop-test.png"
        targetWidth={4}
        targetHeight={3}
        initialFit="cover"
        initialPosition={{ x: 50, y: 50 }}
        initialRect={null}
        labels={{
          title: "Crop image",
          description: "Adjust the image crop",
          fitMode: "Image fit",
          fitCover: "Cover",
          fitContain: "Contain",
          cropRegion: "Crop region",
          close: "Close crop dialog",
          cancel: "Cancel",
          apply: "Apply",
        }}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    image!.getBoundingClientRect = () => new DOMRect(0, 0, 1200, 800);
    fireEvent.load(image!);

    expect(screen.getByRole("heading", { name: "Crop image" })).toBeTruthy();
    expect(screen.getByText("Adjust the image crop").className).not.toContain(
      "sr-only",
    );

    const region = screen.getByRole("group", { name: "Crop region" });
    const percent = (property: "left" | "top" | "width" | "height") =>
      Number.parseFloat((region as HTMLElement).style[property]);
    expect(percent("left")).toBeCloseTo(5.5556, 3);
    expect(percent("top")).toBe(0);
    expect((percent("width") * 1200) / (percent("height") * 800)).toBeCloseTo(
      4 / 3,
      5,
    );

    Object.defineProperties(region, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
    });

    const eastHandle = region.querySelector('[data-crop-handle="e"]');
    expect(eastHandle).not.toBeNull();
    fireEvent.pointerDown(eastHandle!, {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(region, {
      clientX: -500,
      clientY: 0,
      pointerId: 1,
    });
    expect(percent("width")).toBeLessThan(88.9);
    expect(percent("left") + percent("width")).toBeLessThanOrEqual(100);
    fireEvent.pointerUp(region, { pointerId: 1 });

    fireEvent.pointerDown(eastHandle!, {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
      pointerId: 2,
    });
    fireEvent.pointerMove(region, {
      clientX: 5000,
      clientY: 0,
      pointerId: 2,
    });
    expect(percent("width")).toBeCloseTo(88.8889, 3);
    expect(percent("top") + percent("height")).toBeLessThanOrEqual(100);
    fireEvent.pointerUp(region, { pointerId: 2 });

    region.focus();
    fireEvent.pointerDown(region, {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
      pointerId: 3,
    });
    fireEvent.pointerMove(region, {
      clientX: 5000,
      clientY: 5000,
      pointerId: 3,
    });
    fireEvent.pointerUp(region, { pointerId: 3 });
    expect(percent("left") + percent("width")).toBeCloseTo(100, 5);
    expect(percent("top") + percent("height")).toBeLessThanOrEqual(100);

    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(percent("left")).toBeCloseTo(100 - percent("width") - 1, 5);
  });

  it("applies the crop rectangle as an object view box with centered position", () => {
    const onApply = vi.fn();
    renderCropControls({ onApply });

    const image = document.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1200 },
      naturalHeight: { configurable: true, value: 800 },
    });
    image.getBoundingClientRect = () => new DOMRect(0, 0, 1200, 800);
    fireEvent.load(image);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({
      fit: "cover",
      rect: { x: 5.56, y: 0, width: 88.89, height: 100 },
    });
    expect(imageCropStyleEdits(onApply.mock.calls[0][0])).toEqual([
      { key: "objectFit", value: "cover" },
      { key: "objectPosition", value: "50% 50%" },
      { key: "objectViewBox", value: "inset(0% 5.55% 0% 5.56%)" },
    ]);
  });

  it("clears the saved crop when contain is applied", () => {
    const onApply = vi.fn();
    renderCropControls({ onApply });

    fireEvent.click(screen.getByRole("radio", { name: "Contain" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({ fit: "contain" });
    expect(imageCropStyleEdits(onApply.mock.calls[0][0])).toEqual([
      { key: "objectFit", value: "contain" },
      { key: "objectPosition", value: "50% 50%" },
      { key: "objectViewBox", value: null },
    ]);
  });

  it("closes on cancel without applying crop edits", () => {
    const onClose = vi.fn();
    const onApply = vi.fn();
    renderCropControls({ onClose, onApply });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("image crop styles", () => {
  it("parses and writes the crop inset used to restore zoom and position", () => {
    const rect = { x: 10.25, y: 20.5, width: 60, height: 50 };
    const viewBox = cropRectToObjectViewBox(rect);

    expect(viewBox).toBe("inset(20.5% 29.75% 29.5% 10.25%)");
    expect(objectViewBoxToCropRect(viewBox)).toEqual(rect);
    expect(objectViewBoxToCropRect("inset(10% 20%)")).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 80,
    });
    expect(objectViewBoxToCropRect("none")).toBeNull();
    expect(objectViewBoxToCropRect("inset(50% 50% 0% 0%)")).toEqual({
      x: 0,
      y: 50,
      width: 50,
      height: 50,
    });
    expect(objectViewBoxToCropRect("inset(50% 50% 50% 50%)")).toBeNull();
  });
});

function renderCropControls({
  onClose = vi.fn(),
  onApply = vi.fn(),
}: {
  onClose?: () => void;
  onApply?: (result: Slides2ImageCropResult) => void;
} = {}) {
  render(
    <Slides2ImageCropControls
      src="crop-test.png"
      targetWidth={4}
      targetHeight={3}
      initialFit="cover"
      initialPosition={{ x: 50, y: 50 }}
      initialRect={null}
      labels={{
        title: "Crop image",
        description: "Adjust the image crop",
        fitMode: "Image fit",
        fitCover: "Cover",
        fitContain: "Contain",
        cropRegion: "Crop region",
        close: "Close crop dialog",
        cancel: "Cancel",
        apply: "Apply",
      }}
      onClose={onClose}
      onApply={onApply}
    />,
  );
  return { onClose, onApply };
}
