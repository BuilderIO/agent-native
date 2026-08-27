// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hexToLinearRgb } from "./brand-colors";
import { HeroOceanBackground } from "./hero-ocean-background";

const { createRenderer, renderer, importSpy } = vi.hoisted(() => {
  const renderer = {
    ready: Promise.resolve(),
    dispose: vi.fn(),
    setColors: vi.fn(),
    setPaused: vi.fn(),
  };
  const importSpy = vi.fn();
  return { createRenderer: vi.fn(() => renderer), renderer, importSpy };
});

vi.mock("./renderer", async () => {
  importSpy();
  const actual =
    await vi.importActual<typeof import("./renderer")>("./renderer");
  return { ...actual, createRenderer };
});

let intersectionCallbacks: ((entries: unknown[]) => void)[] = [];
let mutationCallbacks: (() => void)[] = [];
// Testing Library's own waitFor() runs on a MutationObserver, so this list
// carries its observers too. Assert on the delta across unmount rather than on
// a total, or the harness's bookkeeping reads as component behaviour.
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
  vi.unstubAllGlobals();
  createRenderer.mockClear();
  importSpy.mockClear();
  renderer.dispose.mockClear();
  renderer.setColors.mockClear();
  renderer.setPaused.mockClear();
});

describe("hexToLinearRgb", () => {
  it("converts a six-digit hex to linear RGB", () => {
    expect(hexToLinearRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToLinearRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("linearizes rather than passing sRGB straight through", () => {
    // 0x80 is 0.502 in sRGB but ~0.216 in linear light. Passing the sRGB value
    // to a shader that re-encodes on the way out is what makes a token-driven
    // field render too dark.
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
    const { container } = render(<HeroOceanBackground onError={vi.fn()} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.className).toContain("absolute");
    expect(box.className).toContain("inset-0");
    expect(box.className).toContain("z-[-1]");
    expect(box.className).toContain("opacity-[var(--b-hero-shader-opacity)]");
    expect(box.querySelector("canvas")).not.toBeNull();
  });

  it("loads the GPU runtime in an effect, not during render", async () => {
    render(<HeroOceanBackground onError={vi.fn()} />);
    // Present in the DOM before the renderer module has been constructed.
    expect(createRenderer).not.toHaveBeenCalled();
    await waitFor(() => expect(createRenderer).toHaveBeenCalled());
  });

  it("pushes brand colours through on a theme change", async () => {
    render(<HeroOceanBackground onError={vi.fn()} />);
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
    render(<HeroOceanBackground onError={vi.fn()} />);
    await waitFor(() => expect(createRenderer).toHaveBeenCalled());

    for (const cb of intersectionCallbacks) cb([{ isIntersecting: false }]);
    expect(renderer.setPaused).toHaveBeenCalledWith(true);

    for (const cb of intersectionCallbacks) cb([{ isIntersecting: true }]);
    expect(renderer.setPaused).toHaveBeenCalledWith(false);
  });

  it("disposes the GPU and both observers on unmount", async () => {
    const { unmount } = render(<HeroOceanBackground onError={vi.fn()} />);
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
    const { unmount } = render(<HeroOceanBackground onError={vi.fn()} />);
    unmount();
    await Promise.resolve();
    expect(createRenderer).not.toHaveBeenCalled();
  });

  it("reports a construction failure to the caller instead of throwing", async () => {
    const onError = vi.fn();
    createRenderer.mockImplementationOnce(() => {
      throw new Error("no device");
    });
    render(<HeroOceanBackground onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
