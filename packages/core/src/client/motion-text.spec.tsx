// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentNativeMotionText,
  type MotionTextAnimation,
  type MotionTextPlaybackMode,
} from "./motion-text.js";

const animation: MotionTextAnimation = {
  targetNodeId: "headline",
  unit: "word",
  direction: "forward",
  staggerMs: 40,
  property: "opacity",
  durationMs: 200,
  keyframes: [
    { t: 0, value: "0", ease: "ease-out" },
    { t: 1, value: "1", ease: "ease-in" },
  ],
};

describe("AgentNativeMotionText", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hydrationRoot: Root | undefined;
  let hydrationContainer: HTMLDivElement | undefined;
  let rootMounted: boolean;
  let previousMatchMedia: PropertyDescriptor | undefined;
  let previousAnimate: PropertyDescriptor | undefined;
  let mockedAnimations: Array<{
    element: HTMLElement;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    animation: Animation;
  }>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    previousMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    previousAnimate = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "animate",
    );
    mockedAnimations = [];
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: vi.fn(function (
        this: HTMLElement,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        let currentTime: number | null = 0;
        const handle = {
          pause: vi.fn(),
          play: vi.fn(),
          cancel: vi.fn(),
          get currentTime() {
            return currentTime;
          },
          set currentTime(value: number | null) {
            currentTime = value;
          },
        } as unknown as Animation;
        mockedAnimations.push({
          element: this,
          keyframes,
          options,
          animation: handle,
        });
        return handle;
      }),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    rootMounted = true;
  });

  afterEach(() => {
    if (rootMounted) act(() => root.unmount());
    if (hydrationRoot) act(() => hydrationRoot?.unmount());
    container.remove();
    hydrationContainer?.remove();
    document.documentElement.style.removeProperty("--an-motion-ease-out");
    if (previousMatchMedia) {
      Object.defineProperty(window, "matchMedia", previousMatchMedia);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
    if (previousAnimate) {
      Object.defineProperty(HTMLElement.prototype, "animate", previousAnimate);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders unchanged static host markup on the server without scripts", () => {
    const html = renderToString(
      <AgentNativeMotionText animation={animation}>
        <h1 data-agent-native-node-id="headline">Hello world</h1>
      </AgentNativeMotionText>,
    );

    expect(html).toContain(
      '<h1 data-agent-native-node-id="headline">Hello world</h1>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<style");
  });

  it.each(["cubic-bezier(0, 0.9971093535, 1, 1)", "linear(0, 0.2 50%, 1)"])(
    "passes supported Text easing %s to Web Animations",
    async (ease) => {
      const easingAnimation: MotionTextAnimation = {
        ...animation,
        keyframes: animation.keyframes.map((keyframe) => ({
          ...keyframe,
          ease,
        })),
      };

      await act(async () => {
        root.render(
          <AgentNativeMotionText animation={easingAnimation}>
            <h1 data-agent-native-node-id="headline">Hello world</h1>
          </AgentNativeMotionText>,
        );
      });

      expect(mockedAnimations[0]?.keyframes[0]?.easing).toBe(ease);
    },
  );

  it("resolves canonical easing variables from the animated element styles", async () => {
    document.documentElement.style.setProperty(
      "--an-motion-ease-out",
      "ease-out",
    );
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--an-motion-ease-out" ? "ease-out" : "",
    } as CSSStyleDeclaration);
    const easingAnimation: MotionTextAnimation = {
      ...animation,
      keyframes: animation.keyframes.map((keyframe) => ({
        ...keyframe,
        ease: "var(--an-motion-ease-out)",
      })),
    };

    await act(async () => {
      root.render(
        <AgentNativeMotionText animation={easingAnimation}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      );
    });

    expect(mockedAnimations[0]?.keyframes.map(({ easing }) => easing)).toEqual([
      "ease-out",
      "ease-out",
    ]);
  });

  it("converts supported spring tokens into WAAPI timing functions", async () => {
    const easingAnimation: MotionTextAnimation = {
      ...animation,
      keyframes: animation.keyframes.map((keyframe) => ({
        ...keyframe,
        ease: "spring(0.674)",
      })),
    };

    await act(async () => {
      root.render(
        <AgentNativeMotionText animation={easingAnimation}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      );
    });

    const easings = mockedAnimations[0]?.keyframes.map(({ easing }) => easing);
    expect(easings).toHaveLength(2);
    expect(easings?.[0]).toMatch(/^linear\(/);
    expect(easings?.[1]).toBe(easings?.[0]);
  });

  it.each([
    "ease-discrete",
    "spring(1.01)",
    "cubic-bezier(1.1, 0, 0, 1)",
    "linear(0, unsupported)",
  ])("rejects unsupported Text easing %s before Web Animations", (ease) => {
    const invalidAnimation: MotionTextAnimation = {
      ...animation,
      keyframes: animation.keyframes.map((keyframe) => ({ ...keyframe, ease })),
    };

    expect(() =>
      renderToString(
        <AgentNativeMotionText animation={invalidAnimation}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      ),
    ).toThrow("AgentNativeMotionText keyframes are invalid.");
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });

  it("hydrates the unchanged server host before React adds animated units", async () => {
    const element = (
      <AgentNativeMotionText animation={animation}>
        <h1 data-agent-native-node-id="headline">Hello world</h1>
      </AgentNativeMotionText>
    );
    hydrationContainer = document.createElement("div");
    hydrationContainer.innerHTML = renderToString(element);
    document.body.appendChild(hydrationContainer);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await act(async () => {
      hydrationRoot = hydrateRoot(hydrationContainer!, element);
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(hydrationContainer.querySelector("h1")?.textContent).toBe(
      "Hello world",
    );
    expect(
      hydrationContainer.querySelectorAll("span.agent-native-motion-text-unit"),
    ).toHaveLength(2);
  });

  it("segments with React-owned spans and cancels Web Animations on unmount", async () => {
    await act(async () => {
      root.render(
        <AgentNativeMotionText animation={animation}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      );
    });

    expect(
      container.querySelectorAll("span.agent-native-motion-text-unit"),
    ).toHaveLength(2);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(mockedAnimations).toHaveLength(2);
    expect(mockedAnimations.map(({ options }) => options.delay)).toEqual([
      0, 40,
    ]);
    expect(
      mockedAnimations.every(
        ({ animation: handle }) =>
          handle.pause.mock.calls.length === 0 &&
          handle.play.mock.calls.length === 0,
      ),
    ).toBe(true);

    act(() => root.unmount());
    rootMounted = false;
    expect(
      mockedAnimations.every(
        ({ animation: handle }) =>
          vi.mocked(handle.cancel).mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("plays multiple compatible properties on the same text units", async () => {
    const translateAnimation: MotionTextAnimation = {
      ...animation,
      property: "translate",
      delayMs: 25,
      durationMs: 120,
      keyframes: [
        { t: 0, value: "0px", ease: "ease-out" },
        { t: 1, value: "12px" },
      ],
    };

    await act(async () => {
      root.render(
        <AgentNativeMotionText animations={[animation, translateAnimation]}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      );
    });

    expect(
      container.querySelectorAll("span.agent-native-motion-text-unit"),
    ).toHaveLength(2);
    expect(
      mockedAnimations.map(({ options }) => [options.duration, options.delay]),
    ).toEqual([
      [200, 0],
      [200, 40],
      [120, 25],
      [120, 65],
    ]);
    expect(mockedAnimations.map(({ keyframes }) => keyframes[0])).toEqual([
      { offset: 0, easing: "ease-out", opacity: "0" },
      { offset: 0, easing: "ease-out", opacity: "0" },
      { offset: 0, easing: "ease-out", translate: "0px" },
      { offset: 0, easing: "ease-out", translate: "0px" },
    ]);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview", t: 0.2, durationMs: 1000 },
      }),
    );
    expect(
      mockedAnimations.map(({ animation: handle }) => handle.currentTime),
    ).toEqual([200, 160, 120, 120]);
  });

  it("rejects composite tracks with incompatible tokenization", () => {
    expect(() =>
      renderToString(
        <AgentNativeMotionText
          animations={[
            animation,
            { ...animation, property: "translate", unit: "character" },
          ]}
        >
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      ),
    ).toThrow(/must share target, unit, direction, and stagger/);
  });

  it.each([
    { mode: "loop", iterations: Infinity, direction: "normal" },
    { mode: "once", iterations: 1, direction: "normal" },
    { mode: "ping-pong", iterations: Infinity, direction: "alternate" },
  ] as const)(
    "plays $mode text animations with the matching Web Animations options",
    async ({ mode, iterations, direction }) => {
      await act(async () => {
        root.render(
          <AgentNativeMotionText
            animation={animation}
            playbackMode={mode as MotionTextPlaybackMode}
          >
            <h1 data-agent-native-node-id="headline">Hello world</h1>
          </AgentNativeMotionText>,
        );
      });

      expect(mockedAnimations).toHaveLength(2);
      expect(
        mockedAnimations.map(({ options }) => ({
          iterations: options.iterations,
          direction: options.direction,
        })),
      ).toEqual([
        { iterations, direction },
        { iterations, direction },
      ]);
    },
  );

  it("leaves text untouched when reduced motion is requested", async () => {
    vi.mocked(window.matchMedia).mockImplementationOnce(
      () =>
        ({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as MediaQueryList,
    );

    await act(async () => {
      root.render(
        <AgentNativeMotionText animation={animation}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      );
    });

    expect(container.querySelector("h1")?.textContent).toBe("Hello world");
    expect(container.querySelector("span")).toBeNull();
    expect(mockedAnimations).toHaveLength(0);
  });

  it("seeks and clears preview animations through the parent bridge", async () => {
    await act(async () => {
      root.render(
        <AgentNativeMotionText animation={animation}>
          <h1 data-agent-native-node-id="headline">Hello world</h1>
        </AgentNativeMotionText>,
      );
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview-clear" },
      }),
    );
    expect(
      mockedAnimations.every(
        ({ animation: handle }) => handle.play.mock.calls.length === 0,
      ),
    ).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview", t: 0.1, durationMs: 1000 },
      }),
    );
    expect(
      mockedAnimations.map(({ animation: handle }) => handle.currentTime),
    ).toEqual([100, 60]);
    expect(
      mockedAnimations.every(
        ({ animation: handle }) => handle.pause.mock.calls.length === 1,
      ),
    ).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview", t: 0.2, durationMs: 1000 },
      }),
    );
    expect(
      mockedAnimations.map(({ animation: handle }) => handle.currentTime),
    ).toEqual([200, 160]);
    expect(
      mockedAnimations.every(
        ({ animation: handle }) => handle.pause.mock.calls.length === 1,
      ),
    ).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview", t: 0.8, durationMs: 1000 },
      }),
    );
    expect(
      mockedAnimations.map(({ animation: handle }) => handle.currentTime),
    ).toEqual([200, 200]);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview-clear" },
      }),
    );
    expect(
      mockedAnimations.map(({ animation: handle }) => handle.currentTime),
    ).toEqual([0, 0]);
    expect(
      mockedAnimations.every(
        ({ animation: handle }) => handle.play.mock.calls.length === 1,
      ),
    ).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: { type: "motion-preview-clear" },
      }),
    );
    expect(
      mockedAnimations.every(
        ({ animation: handle }) => handle.play.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it.each(["loop", "ping-pong"] as const)(
    "keeps the %s preview playhead beyond one iteration and clears it",
    async (playbackMode) => {
      await act(async () => {
        root.render(
          <AgentNativeMotionText
            animation={animation}
            playbackMode={playbackMode}
          >
            <h1 data-agent-native-node-id="headline">Hello world</h1>
          </AgentNativeMotionText>,
        );
      });

      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { type: "motion-preview", t: 0.5, durationMs: 1000 },
        }),
      );
      expect(
        mockedAnimations.map(({ animation: handle }) => handle.currentTime),
      ).toEqual([500, 460]);
      expect(
        mockedAnimations.every(
          ({ animation: handle }) => handle.pause.mock.calls.length === 1,
        ),
      ).toBe(true);

      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: { type: "motion-preview-clear" },
        }),
      );
      expect(
        mockedAnimations.map(({ animation: handle }) => handle.currentTime),
      ).toEqual([0, 0]);
      expect(
        mockedAnimations.every(
          ({ animation: handle }) => handle.play.mock.calls.length === 1,
        ),
      ).toBe(true);
    },
  );
});
