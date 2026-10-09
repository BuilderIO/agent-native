// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM":{"settings":{"disableIframePageLoading":true}}}
import { readFileSync } from "node:fs";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplatePreview } from "./TemplatePreview";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let intersectionObservers: Array<{
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  options?: IntersectionObserverInit;
}>;
beforeEach(() => {
  intersectionObservers = [];
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(180);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(
        public callback: IntersectionObserverCallback,
        public options?: IntersectionObserverInit,
      ) {
        intersectionObservers.push(this);
      }
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("template artboard preview", () => {
  it.each([
    [1080, 1080],
    [612, 792],
    [1280, 720],
  ])(
    "contains and centers the full %s by %s artboard in the gallery frame",
    async (width, height) => {
      await act(async () =>
        root.render(
          <TemplatePreview
            html="<h1>Preview</h1>"
            title="Sample"
            width={width}
            height={height}
          />,
        ),
      );
      const frame = container.querySelector("iframe")!;
      expect(frame.style.getPropertyValue("--design-template-scale")).toBe(
        String(Math.min(320 / width, 180 / height)),
      );
      expect(frame.className).toBe("design-template-preview-frame");
      expect(readFileSync("app/global.css", "utf8")).toContain(
        "translate(-50%, -50%) scale(var(--design-template-scale))",
      );
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(
        false,
      );
      expect(frame.style.getPropertyValue("--design-template-width")).toBe(
        `${width}px`,
      );
    },
  );

  it("allows isolated prototype interactions without account origin or editor bridge", async () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    const onEscape = vi.fn();
    await act(async () =>
      root.render(
        <TemplatePreview
          title="Interactive fixture"
          html='<main x-data="{count:0}"><button @click="count++">Increment</button><span x-text="count"></span></main>'
          interactive
          recordSessionReplay
          onNavigate={onNavigate}
          onEscape={onEscape}
        />,
      ),
    );
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(false);
    expect(intersectionObservers[0]?.options?.threshold).toEqual([
      0,
      Number.EPSILON,
    ]);
    act(() =>
      intersectionObservers[0]!.callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0,
            intersectionRect: { width: 0, height: 0 },
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(false);
    act(() =>
      intersectionObservers[0]!.callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            intersectionRect: { width: 320, height: 180 },
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(true);
    act(() =>
      intersectionObservers[0]!.callback(
        [
          {
            isIntersecting: false,
            intersectionRatio: 0,
            intersectionRect: { width: 0, height: 0 },
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(true);
    act(() => vi.advanceTimersByTime(750));
    expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(false);
    act(() =>
      intersectionObservers[0]!.callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
            intersectionRect: { width: 320, height: 180 },
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    expect(frame.hasAttribute("data-agent-native-session-replay")).toBe(true);
    expect(frame.hasAttribute("credentialless")).toBe(true);
    expect(frame.tabIndex).toBe(0);
    expect(frame.getAttribute("aria-hidden")).toBeNull();
    expect(frame.srcdoc).toContain('x-data="{count:0}"');
    expect(frame.srcdoc).not.toContain("editor-chrome");
    expect(frame.srcdoc).toContain("agent-native-session-replay:probe");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: window,
        data: { type: "design-template-preview:navigate", href: "second.html" },
      }),
    );
    expect(onNavigate).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://other.example.test",
        source: frame.contentWindow!,
        data: { type: "design-template-preview:navigate", href: "second.html" },
      }),
    );
    expect(onNavigate).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: frame.contentWindow!,
        data: { type: "design-template-preview:navigate", href: "second.html" },
      }),
    );
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("second.html");
    for (const event of [
      { origin: "null", source: window },
      { origin: window.location.origin, source: frame.contentWindow! },
    ])
      window.dispatchEvent(
        new MessageEvent("message", {
          ...event,
          data: { type: "design-template-preview:escape" },
        }),
      );
    expect(onEscape).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: frame.contentWindow!,
        data: { type: "design-template-preview:escape" },
      }),
    );
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
