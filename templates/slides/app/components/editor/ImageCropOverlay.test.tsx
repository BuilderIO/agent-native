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

import ImageCropOverlay, {
  writeImageCropPercentGeometry,
} from "./ImageCropOverlay";

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
    offsetWidth: { configurable: true, get: () => frame.offsetWidth },
    offsetHeight: { configurable: true, get: () => frame.offsetHeight },
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
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("dims the full image outside black crop handles", () => {
    const nodes = createCropCanvas();

    render(<ImageCropOverlay {...nodes} onFinish={vi.fn()} />);

    const crop = screen.getByRole("group", { name: "Crop image" });
    expect(crop).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Crop / })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Crop Top Left" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crop Left" }).style.left).toBe(
      "-8px",
    );
    const masks = Array.from(
      crop.querySelectorAll<HTMLElement>("[data-crop-mask]"),
    );
    expect(masks).toHaveLength(4);
    expect(masks.map((mask) => [mask.style.width, mask.style.height])).toEqual([
      ["200px", "10px"],
      ["200px", "50px"],
      ["20px", "100px"],
      ["40px", "100px"],
    ]);
    expect(nodes.image.style.opacity).toBe("");
    expect(nodes.viewport.style.overflow).toBe("visible");
    expect(
      crop.querySelector("[data-crop-handle='nw'] span")?.className,
    ).toContain("bg-black");
  });

  it("moves the image in frame coordinates and commits on Enter", () => {
    const nodes = createCropCanvas();
    const onFinish = vi.fn();

    render(<ImageCropOverlay {...nodes} onFinish={onFinish} />);

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
    expect(nodes.image.style.top).toBe("0px");
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onFinish).toHaveBeenCalledWith(true, true);
  });

  it("converts image movement through the frame rotation", () => {
    const nodes = createCropCanvas();
    nodes.frame.style.transform = "rotate(90deg)";

    render(<ImageCropOverlay {...nodes} onFinish={vi.fn()} />);

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

    render(<ImageCropOverlay {...nodes} onFinish={vi.fn()} />);

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

    render(<ImageCropOverlay {...nodes} onFinish={onFinish} />);

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
    expect(onFinish).toHaveBeenCalledWith(false, true);
    expect(nodes.frame.getAttribute("style")).toBe(originalFrameStyle);
    expect(nodes.image.getAttribute("style")).toBe(originalImageStyle);
  });

  it("commits when the user clicks outside the crop frame", () => {
    const nodes = createCropCanvas();
    const onFinish = vi.fn();

    render(<ImageCropOverlay {...nodes} onFinish={onFinish} />);

    fireEvent.pointerDown(document.body, { button: 0, pointerId: 3 });
    expect(onFinish).toHaveBeenCalledWith(true, false);
  });

  it("clamps crop resize to the full image and commits a no-op without changes", () => {
    const nodes = createCropCanvas();
    const onFinish = vi.fn();
    render(<ImageCropOverlay {...nodes} onFinish={onFinish} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Crop Right" }), {
      button: 0,
      pointerId: 6,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 6,
      clientX: 300,
      clientY: 100,
    });
    expect(nodes.frame.style.width).toBe("240px");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFinish).toHaveBeenCalledWith(true, true);
  });

  it("stores crop image geometry relative to the frame so a 2x resize scales it", () => {
    const nodes = createCropCanvas();
    const originalImageWidth = nodes.image.offsetWidth;
    expect(writeImageCropPercentGeometry(nodes.image, nodes.viewport)).toBe(
      true,
    );
    expect(nodes.image.style.left).toBe("-10%");
    expect(nodes.image.style.width).toBe("130%");
    expect(nodes.image.style.top).toBe("-10%");
    expect(nodes.image.style.height).toBe("160%");
    expect(
      nodes.frame.offsetWidth *
        2 *
        (Number.parseFloat(nodes.image.style.width) / 100),
    ).toBe(originalImageWidth * 2);
  });

  it("commits an unchanged crop as a no-op", () => {
    const nodes = createCropCanvas();
    const onFinish = vi.fn();
    render(<ImageCropOverlay {...nodes} onFinish={onFinish} />);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onFinish).toHaveBeenCalledWith(true, false);
  });
});
