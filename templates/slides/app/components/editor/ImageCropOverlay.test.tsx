// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, string>) => {
    if (key === "editorToolbar.cropHandle") {
      return `Crop ${options?.position ?? "image"}`;
    }
    const labels: Record<string, string> = {
      "editorToolbar.cropImage": "Crop image",
      "editorToolbar.imageOptions": "Image options",
      "styleInspector.top": "Top",
      "styleInspector.center": "Center",
      "styleInspector.bottom": "Bottom",
      "styleInspector.left": "Left",
      "styleInspector.right": "Right",
    };
    return labels[key] ?? key;
  },
}));

import ImageCropOverlay from "./ImageCropOverlay";

function createCropCanvas() {
  const canvas = document.createElement("div");
  canvas.style.position = "relative";
  Object.defineProperties(canvas, {
    offsetWidth: { configurable: true, get: () => 960 },
    offsetHeight: { configurable: true, get: () => 540 },
  });
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 480, 270);

  const frame = document.createElement("div");
  frame.style.cssText =
    "position:absolute;left:100px;top:80px;width:200px;height:100px;transform-origin:50% 50%;";
  Object.defineProperties(frame, {
    offsetLeft: {
      configurable: true,
      get: () => Number.parseFloat(frame.style.left) || 0,
    },
    offsetTop: {
      configurable: true,
      get: () => Number.parseFloat(frame.style.top) || 0,
    },
    offsetWidth: {
      configurable: true,
      get: () => Number.parseFloat(frame.style.width) || 0,
    },
    offsetHeight: {
      configurable: true,
      get: () => Number.parseFloat(frame.style.height) || 0,
    },
  });

  const viewport = document.createElement("div");
  viewport.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;";
  Object.defineProperties(viewport, {
    offsetLeft: { configurable: true, get: () => 0 },
    offsetTop: { configurable: true, get: () => 0 },
  });

  const image = document.createElement("img");
  image.src = "image.png";
  image.style.cssText =
    "position:absolute;left:-20px;top:-10px;width:260px;height:160px;";
  Object.defineProperties(image, {
    offsetLeft: {
      configurable: true,
      get: () => Number.parseFloat(image.style.left) || 0,
    },
    offsetTop: {
      configurable: true,
      get: () => Number.parseFloat(image.style.top) || 0,
    },
    offsetWidth: {
      configurable: true,
      get: () => Number.parseFloat(image.style.width) || 0,
    },
    offsetHeight: {
      configurable: true,
      get: () => Number.parseFloat(image.style.height) || 0,
    },
  });

  viewport.append(image);
  frame.append(viewport);
  canvas.append(frame);
  document.body.append(canvas);
  return { canvas, frame, viewport, image };
}

describe("<ImageCropOverlay>", () => {
  afterEach(cleanup);

  it("renders eight crop handles and keeps image options available", () => {
    const nodes = createCropCanvas();
    const onImageOptions = vi.fn();

    render(
      <ImageCropOverlay
        {...nodes}
        onFinish={vi.fn()}
        onImageOptions={onImageOptions}
      />,
    );

    expect(screen.getByRole("group", { name: "Crop image" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Crop / })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Crop Top Left" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crop Left" }).style.left).toBe(
      "0px",
    );
    expect(screen.getByRole("button", { name: "Crop Right" }).style.right).toBe(
      "0px",
    );

    fireEvent.click(screen.getByRole("button", { name: "Image options" }));
    expect(onImageOptions).toHaveBeenCalledTimes(1);
  });

  it("moves the image in frame coordinates and commits on Enter", () => {
    const nodes = createCropCanvas();
    const onFinish = vi.fn();

    render(
      <ImageCropOverlay
        {...nodes}
        onFinish={onFinish}
        onImageOptions={vi.fn()}
      />,
    );

    const crop = screen.getByRole("group", { name: "Crop image" });
    fireEvent.pointerDown(crop, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 110,
      clientY: 120,
    });

    expect(nodes.image.style.left).toBe("0px");
    expect(nodes.image.style.top).toBe("30px");
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onFinish).toHaveBeenCalledWith(true);
  });

  it("converts image movement through the frame rotation", () => {
    const nodes = createCropCanvas();
    nodes.frame.style.transform = "rotate(90deg)";

    render(
      <ImageCropOverlay
        {...nodes}
        onFinish={vi.fn()}
        onImageOptions={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("group", { name: "Crop image" }), {
      button: 0,
      pointerId: 4,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 4,
      clientX: 110,
      clientY: 100,
    });

    expect(Number.parseFloat(nodes.image.style.left)).toBeCloseTo(-20, 5);
    expect(Number.parseFloat(nodes.image.style.top)).toBeCloseTo(-30, 5);
    fireEvent.keyDown(window, { key: "Escape" });
  });

  it("does not treat an unsupported 3D transform as an identity transform", () => {
    const nodes = createCropCanvas();
    nodes.frame.style.transform = "perspective(300px) rotateY(20deg)";

    render(
      <ImageCropOverlay
        {...nodes}
        onFinish={vi.fn()}
        onImageOptions={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("group", { name: "Crop image" }), {
      button: 0,
      pointerId: 5,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 5,
      clientX: 110,
      clientY: 100,
    });

    expect(nodes.image.style.left).toBe("-20px");
    expect(nodes.image.style.top).toBe("-10px");
  });

  it("keeps the image fixed while cropping from the left and restores on pointer cancel", () => {
    const nodes = createCropCanvas();
    const originalFrameStyle = nodes.frame.getAttribute("style");
    const originalImageStyle = nodes.image.getAttribute("style");
    const onFinish = vi.fn();

    render(
      <ImageCropOverlay
        {...nodes}
        onFinish={onFinish}
        onImageOptions={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Crop Left" }), {
      button: 0,
      pointerId: 2,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 2,
      clientX: 110,
      clientY: 100,
    });

    expect(nodes.frame.style.left).toBe("120px");
    expect(nodes.frame.style.width).toBe("180px");
    expect(nodes.image.style.left).toBe("-40px");

    fireEvent.pointerCancel(window, { pointerId: 2 });
    expect(onFinish).toHaveBeenCalledWith(false);
    expect(nodes.frame.getAttribute("style")).toBe(originalFrameStyle);
    expect(nodes.image.getAttribute("style")).toBe(originalImageStyle);
  });

  it("commits when the user clicks outside the crop frame", () => {
    const nodes = createCropCanvas();
    const onFinish = vi.fn();

    render(
      <ImageCropOverlay
        {...nodes}
        onFinish={onFinish}
        onImageOptions={vi.fn()}
      />,
    );

    fireEvent.pointerDown(document.body, { button: 0, pointerId: 3 });
    expect(onFinish).toHaveBeenCalledWith(true);
  });
});
