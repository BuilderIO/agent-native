// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { afterBodyPointerUnlock } from "./pointer-lock";

// oracle-change(templates/content/app/components/sidebar/DocumentSidebar.layout.test.ts): its pointer-lock.ts source grep became these frames
describe("afterBodyPointerUnlock", () => {
  const frames: FrameRequestCallback[] = [];
  const nextFrame = () => frames.shift()?.(0);

  afterEach(() => {
    frames.length = 0;
    document.body.style.pointerEvents = "";
    vi.restoreAllMocks();
  });

  function holdFrames() {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => {
      frames.push(frame);
      return frames.length;
    });
  }

  it("waits until a closing dialog gives the page back its pointer", () => {
    holdFrames();
    const callback = vi.fn();
    document.body.style.pointerEvents = "none";

    afterBodyPointerUnlock(callback);
    nextFrame();
    nextFrame();
    expect(callback).not.toHaveBeenCalled();

    document.body.style.pointerEvents = "";
    nextFrame();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("runs on the next frame when nothing holds the pointer", () => {
    holdFrames();
    const callback = vi.fn();

    afterBodyPointerUnlock(callback);
    expect(callback).not.toHaveBeenCalled();

    nextFrame();
    expect(callback).toHaveBeenCalledOnce();
  });
});
