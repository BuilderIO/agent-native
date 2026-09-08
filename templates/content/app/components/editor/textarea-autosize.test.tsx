// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWidthSensitiveTextareaAutosize } from "./textarea-autosize";

describe("width-sensitive textarea autosize", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let resizeCallback: ResizeObserverCallback | null = null;
  const disconnect = vi.fn();

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
    disconnect.mockClear();
    resizeCallback = null;
    root = null;
    container = null;
  });

  function Title({ value }: { value: string }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useWidthSensitiveTextareaAutosize(ref, value);
    return (
      <div>
        <textarea ref={ref} value={value} readOnly />
      </div>
    );
  }

  it("expands and contracts after width changes without observing its height", () => {
    let width = 500;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Title value="A title that wraps" />));
    const textarea = container.querySelector("textarea")!;
    const widthSource = textarea.parentElement!;
    vi.spyOn(widthSource, "getBoundingClientRect").mockImplementation(
      () => ({ width }) as DOMRect,
    );
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => (width < 300 ? 96 : 48),
    });
    textarea.setSelectionRange(7, 7);

    act(() => resizeCallback!([], {} as ResizeObserver));
    expect(textarea.style.height).toBe("48px");
    width = 240;
    act(() => resizeCallback!([], {} as ResizeObserver));
    expect(textarea.style.height).toBe("96px");
    width = 500;
    act(() => resizeCallback!([], {} as ResizeObserver));
    expect(textarea.style.height).toBe("48px");
    expect(textarea.selectionStart).toBe(7);
    expect(textarea.selectionEnd).toBe(7);
  });

  it("disconnects width observation when the title unmounts", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {}
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Title value="Title" />));
    act(() => root!.unmount());
    root = null;
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
