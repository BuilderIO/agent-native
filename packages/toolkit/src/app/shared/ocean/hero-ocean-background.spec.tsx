// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hexToLinearRgb } from "./brand-colors.js";
import { HeroOceanBackground } from "./hero-ocean-background.js";

const FIRST_FRAME_TIMEOUT_MS = 6000;

const { createRenderer, renderer, importSpy } = vi.hoisted(() => {
  const renderer = {
    ready: Promise.resolve(),
    firstFrame: Promise.resolve(),
    dispose: vi.fn(),
    setColors: vi.fn(),
    setPaused: vi.fn(),
    setPointer: vi.fn(),
  };
  const importSpy = vi.fn();
  return { createRenderer: vi.fn(() => renderer), renderer, importSpy };
});

vi.mock("./renderer.js", async () => {
  importSpy();
  const actual =
    await vi.importActual<typeof import("./renderer.js")>("./renderer.js");
  return { ...actual, createRenderer };
});

let intersectionCallbacks: ((entries: unknown[]) => void)[] = [];
let mutationCallbacks: (() => void)[] = [];
let disconnected: string[] = [];

beforeEach(() => {
  intersectionCallbacks = [];
  mutationCallbacks = [];
  disconnected = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: unknown[]) => void) {
        intersectionCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        disconnected.push("intersection");
      }
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(cb: () => void) {
        mutationCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        disconnected.push("mutation");
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  renderer.ready = Promise.resolve();
  renderer.firstFrame = Promise.resolve();
  createRenderer.mockClear();
  importSpy.mockClear();
  renderer.dispose.mockClear();
  renderer.setColors.mockClear();
  renderer.setPaused.mockClear();
  renderer.setPointer.mockClear();
});

describe("hexToLinearRgb", () => {
  it("converts a six-digit hex to linear RGB", () => {
    expect(hexToLinearRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToLinearRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("linearizes rather than passing sRGB straight through", () => {
    const [r] = hexToLinearRgb("#808080")!;
    expect(r).toBeCloseTo(0.2158, 3);
  });

  it("returns null for anything that is not a six-digit hex", () => {
    for (const input of [
      "",
      "  ",
      "#fff",
      "rgb(0,0,0)",
      "#ggghhh",
      "#1234567",
    ]) {
      expect(hexToLinearRgb(input)).toBeNull();
    }
  });
});

describe("HeroOceanBackground", () => {
  it("fills the hero section behind the grid and is hidden from assistive tech", async () => {
    const { container } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.className).toContain("absolute");
    expect(box.className).toContain("inset-0");
    expect(box.className).toContain("z-[-1]");
    const canvas = box.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.style.width).toBe("100%");
    expect(canvas?.style.height).toBe("100%");
    expect(box.style.opacity).toBe("0");
    await waitFor(() => expect(box.style.opacity).toBe("0.3"));
    await waitFor(() => expect(createRenderer).toHaveBeenCalled());
  });

  it("loads the GPU runtime in an effect, not during render", async () => {
    const onError = vi.fn();
    render(<HeroOceanBackground onError={onError} onReady={vi.fn()} />);
    expect(createRenderer).not.toHaveBeenCalled();
    await waitFor(() => {
      if (onError.mock.calls.length) throw onError.mock.calls[0]![0];
      expect(createRenderer).toHaveBeenCalled();
    });
  });

  it("starts the first-frame deadline after renderer initialization", async () => {
    vi.useFakeTimers();
    let finishInitialization: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    createRenderer.mockReturnValueOnce({ ...renderer, ready });
    const onError = vi.fn();
    const onReady = vi.fn();

    render(<HeroOceanBackground onError={onError} onReady={onReady} />);
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(createRenderer).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      finishInitialization?.();
      await ready;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("pauses the first-frame deadline while the document is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    renderer.firstFrame = new Promise<void>(() => {});
    const onError = vi.fn();
    render(<HeroOceanBackground onError={onError} onReady={vi.fn()} />);

    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    });
    expect(createRenderer).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(7000);
      expect(onError).not.toHaveBeenCalled();
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(FIRST_FRAME_TIMEOUT_MS - 1001);
      expect(onError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "The ocean wave did not draw a frame",
      }),
    );
  });

  it("pushes brand colours through on a theme change", async () => {
    render(<HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />);
    await waitFor(() => expect(createRenderer).toHaveBeenCalled());

    for (const cb of mutationCallbacks) cb();
    expect(renderer.setColors).toHaveBeenCalledWith(
      expect.objectContaining({
        fg: expect.any(Array),
        bg: expect.any(Array),
      }),
    );
  });

  it("pauses when scrolled out of view and resumes when back", async () => {
    render(<HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />);
    await waitFor(() => expect(createRenderer).toHaveBeenCalled());

    for (const cb of intersectionCallbacks) cb([{ isIntersecting: false }]);
    expect(renderer.setPaused).toHaveBeenCalledWith(true);

    for (const cb of intersectionCallbacks) cb([{ isIntersecting: true }]);
    expect(renderer.setPaused).toHaveBeenCalledWith(false);
  });

  it("tracks body mouse movement relative to the hero bounds", async () => {
    const { container } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />,
    );
    const box = container.firstElementChild as HTMLElement;
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    } as DOMRect);

    await waitFor(() => expect(createRenderer).toHaveBeenCalled());
    renderer.setPointer.mockClear();

    document.body.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 110,
        clientY: 70,
      }),
    );
    expect(renderer.setPointer).toHaveBeenLastCalledWith([0, 0, 1]);

    document.body.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 310,
        clientY: 70,
      }),
    );
    expect(renderer.setPointer).toHaveBeenLastCalledWith([2, 0, 0]);
  });

  it("remaps the active pointer on scroll and fades it on window blur", async () => {
    const { container } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />,
    );
    const box = container.firstElementChild as HTMLElement;
    const rect = {
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    } as DOMRect;
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue(rect);

    await waitFor(() => expect(createRenderer).toHaveBeenCalled());
    renderer.setPointer.mockClear();

    document.body.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 110,
        clientY: 70,
      }),
    );
    expect(renderer.setPointer).toHaveBeenLastCalledWith([0, 0, 1]);

    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
      ...rect,
      left: 60,
    } as DOMRect);
    window.dispatchEvent(new Event("scroll"));
    expect(renderer.setPointer).toHaveBeenLastCalledWith([-0.5, 0, 1]);

    window.dispatchEvent(new Event("blur"));
    expect(renderer.setPointer).toHaveBeenLastCalledWith([-0.5, 0, 0]);

    window.dispatchEvent(new Event("scroll"));
    expect(renderer.setPointer).toHaveBeenLastCalledWith([-0.5, 0, 0]);
  });

  it("disposes the GPU and both observers on unmount", async () => {
    const { unmount } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />,
    );
    await waitFor(() => expect(createRenderer).toHaveBeenCalled());

    const before = disconnected.length;
    unmount();
    expect(renderer.dispose).toHaveBeenCalled();
    expect([...disconnected.slice(before)].sort()).toEqual([
      "intersection",
      "mutation",
    ]);
  });

  it("does not construct a renderer when unmounted before the import lands", async () => {
    const { unmount } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />,
    );
    unmount();
    await Promise.resolve();
    expect(createRenderer).not.toHaveBeenCalled();
  });

  it("stays fully transparent until the first frame is drawn", async () => {
    let drawFirstFrame: () => void = () => {};
    renderer.firstFrame = new Promise<void>((resolve) => {
      drawFirstFrame = resolve;
    });
    const onReady = vi.fn();
    const { container } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={onReady} />,
    );
    const box = container.firstElementChild as HTMLElement;

    await waitFor(() => expect(createRenderer).toHaveBeenCalled());
    expect(box.style.opacity).toBe("0");

    drawFirstFrame();
    await waitFor(() => expect(box.style.opacity).toBe("0.3"));
    expect(onReady).toHaveBeenCalledOnce();
    renderer.firstFrame = Promise.resolve();
  });

  it("never fades in when the renderer fails before drawing", async () => {
    renderer.firstFrame = Promise.reject(new Error("device lost"));
    const { container } = render(
      <HeroOceanBackground onError={vi.fn()} onReady={vi.fn()} />,
    );
    const box = container.firstElementChild as HTMLElement;

    await waitFor(() => expect(createRenderer).toHaveBeenCalled());
    await Promise.resolve();
    expect(box.style.opacity).toBe("0");
    renderer.firstFrame = Promise.resolve();
  });

  it("reports a construction failure to the caller instead of throwing", async () => {
    const onError = vi.fn();
    createRenderer.mockImplementationOnce(() => {
      throw new Error("no device");
    });
    render(<HeroOceanBackground onError={onError} onReady={vi.fn()} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
