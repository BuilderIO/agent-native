import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sampleSpring, springToCssLinear } from "../../../shared/motion-easing";
import {
  createMotionNativeStyleInstance,
  motionNativeStylesToTracks,
} from "../../../shared/motion-native-style-runtime";

interface FakeElement {
  style: Record<string, string>;
  attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

class FakeSvgElement {
  readonly tagName: string;
  readonly style: Record<string, string> = {};
  readonly children: FakeSvgElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  parentNode: FakeSvgElement | FakeSvgBody | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get firstChild(): FakeSvgElement | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  appendChild<T extends FakeSvgElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends FakeSvgElement>(child: T): T {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeSvgBody {
  readonly children: FakeSvgElement[] = [];

  appendChild<T extends FakeSvgElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends FakeSvgElement>(child: T): T {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
}

class FakeAudio {
  src: string;
  preload = "";
  volume = 1;
  muted = false;
  currentTime = 0;
  readyState = 4;
  paused = true;
  readonly listeners = new Map<string, Array<() => void>>();
  shouldFailPlayback = false;

  constructor(src = "") {
    this.src = src;
    activeAudioElements.push(this);
  }

  play() {
    if (this.shouldFailPlayback) return Promise.reject(new Error("blocked"));
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {}

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
}

let activeAudioElements: FakeAudio[] = [];

function loadBridge(): {
  lerp: (a: string, b: string, ratio: number) => string;
  interpolate: (
    keyframes: Array<{
      t: number;
      value: string;
      ease?: string;
      motionPath?: {
        version: 1;
        type: "cubic";
        control1: { x: number; y: number };
        control2: { x: number; y: number };
      };
    }>,
    t: number,
  ) => string;
  parseColor: (value: string) => number[] | null;
  evalEase: (ease: string | undefined, x: number) => number;
  trackLocalT: (
    track: { delayMs?: number; durationMs?: number },
    t: number,
  ) => number;
  sendMessage: (data: unknown) => void;
  addElement: (nodeId: string) => FakeElement;
  removeElement: (nodeId: string) => void;
  getPathOverlay: () => FakeSvgElement | null;
  findSvg: (attribute: string, value?: string) => FakeSvgElement | null;
  pointerDown: (target: FakeSvgElement, event: Record<string, unknown>) => void;
  pointerEvent: (type: string, event: Record<string, unknown>) => void;
  parentMessages: Array<Record<string, unknown>>;
  audioElements: FakeAudio[];
} {
  const generatedPath = fileURLToPath(
    new URL(
      "../../../.generated/bridge/motion-preview.generated.ts",
      import.meta.url,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { motionPreviewBridgeScript } = require(generatedPath) as {
    motionPreviewBridgeScript: string;
  };

  let body = motionPreviewBridgeScript;
  body = body.replace(/^["']use strict["'];\s*\(\(\)\s*=>\s*\{/, "");
  body = body.replace(/\}\)\(\);\s*$/, "");
  body = body.replace(/^\s*\/\/[^\n]*\n/, "");
  body = body.replace(/^\s*\(function\s*\(\s*\)\s*\{/, "");
  body = body.replace(/\}\)\(\);\s*$/, "");

  const listeners: Array<(e: unknown) => void> = [];
  const windowListeners = new Map<string, Array<(event: unknown) => void>>();
  const elements = new Map<string, FakeElement>();
  const parentMessages: Array<Record<string, unknown>> = [];
  activeAudioElements = [];
  const parentSentinel = {
    postMessage(message: Record<string, unknown>) {
      parentMessages.push(message);
    },
  };
  const svgBody = new FakeSvgBody();
  function containsSvg(
    root: FakeSvgElement | FakeSvgBody,
    target: unknown,
  ): boolean {
    if (root.children.includes(target as FakeSvgElement)) return true;
    return root.children.some((child) => containsSvg(child, target));
  }
  function findSvg(attribute: string, value?: string): FakeSvgElement | null {
    function visit(node: FakeSvgElement): FakeSvgElement | null {
      const actual = node.getAttribute(attribute);
      if (actual !== null && (value === undefined || actual === value)) {
        return node;
      }
      for (const child of node.children) {
        const result = visit(child);
        if (result) return result;
      }
      return null;
    }
    for (const child of svgBody.children) {
      const result = visit(child);
      if (result) return result;
    }
    return null;
  }
  const fakeWindow = {
    parent: parentSentinel,
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (type === "message") listeners.push(fn);
      const registered = windowListeners.get(type) ?? [];
      registered.push(fn);
      windowListeners.set(type, registered);
    },
    getComputedStyle(element: FakeElement) {
      return {
        translate: element.style.translate || "none",
        transformOrigin: "20px 10px",
      };
    },
  };
  const fakeDocument = {
    body: svgBody,
    createElementNS(_namespace: string, tagName: string) {
      return new FakeSvgElement(tagName);
    },
    querySelector(selector: string): FakeElement | null {
      const m = /\[data-agent-native-node-id="([^"]+)"\]/.exec(selector);
      return m ? (elements.get(m[1]) ?? null) : null;
    },
    contains(node: unknown): boolean {
      return (
        Array.from(elements.values()).includes(node as FakeElement) ||
        containsSvg(svgBody, node)
      );
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "window",
    "document",
    "Audio",
    body +
      "\n; return { lerp, interpolate, parseColor, evalEase, trackLocalT };",
  );
  const api = factory(fakeWindow, fakeDocument, FakeAudio);
  return {
    ...api,
    sendMessage: (data: unknown) => {
      for (const fn of listeners) fn({ source: parentSentinel, data });
    },
    addElement: (nodeId: string) => {
      const style: Record<string, string> = {};
      Object.assign(style, {
        getPropertyValue(name: string): string {
          return style[name] ?? "";
        },
        getPropertyPriority(): string {
          return "";
        },
        setProperty(name: string, value: string) {
          style[name] = value;
        },
        removeProperty(name: string) {
          delete style[name];
        },
      });
      const el: FakeElement = {
        style,
        attributes: new Map(),
        getAttribute(name) {
          return this.attributes.get(name) ?? null;
        },
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        removeAttribute(name) {
          this.attributes.delete(name);
        },
        getBoundingClientRect: () => ({
          left: 100,
          top: 50,
          right: 140,
          bottom: 70,
          width: 40,
          height: 20,
        }),
      };
      elements.set(nodeId, el);
      return el;
    },
    removeElement: (nodeId: string) => {
      elements.delete(nodeId);
    },
    getPathOverlay: () => findSvg("data-motion-path-overlay"),
    findSvg,
    pointerDown: (target, event) => {
      for (const listener of windowListeners.get("pointerdown") ?? []) {
        listener({
          target,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
          ctrlKey: false,
          metaKey: false,
          preventDefault() {},
          stopPropagation() {},
          ...event,
        });
      }
    },
    pointerEvent: (type, event) => {
      for (const listener of windowListeners.get(type) ?? []) {
        listener({
          pointerId: 1,
          clientX: 0,
          clientY: 0,
          preventDefault() {},
          ...event,
        });
      }
    },
    parentMessages,
    audioElements: activeAudioElements,
  };
}

const bridge = loadBridge();
const at = (from: string, to: string, t: number, ease = "linear") =>
  bridge.interpolate(
    [
      { t: 0, value: from, ease },
      { t: 1, value: to, ease },
    ],
    t,
  );

describe("motion-preview bridge interpolation", () => {
  it("interpolates plain numbers with units (opacity / translateY px)", () => {
    expect(at("0", "1", 0.5)).toBe("0.5");
    expect(at("0", "1", 0.25)).toBe("0.25");
    expect(at("translateY(16px)", "translateY(0px)", 0.5)).toBe(
      "translateY(8px)",
    );
    expect(at("translateY(16px)", "translateY(0px)", 0.25)).toBe(
      "translateY(12px)",
    );
  });

  it("interpolates scale() and blur() function values instead of snapping", () => {
    expect(at("scale(0.8)", "scale(1)", 0.5)).toBe("scale(0.9)");
    expect(at("blur(8px)", "blur(0px)", 0.5)).toBe("blur(4px)");
    expect(at("blur(8px)", "blur(0px)", 0.25)).toBe("blur(6px)");
  });

  it("interpolates compound transforms component-wise", () => {
    expect(
      at("translateY(20px) scale(0.5)", "translateY(0px) scale(1)", 0.5),
    ).toBe("translateY(10px) scale(0.75)");
  });

  it("interpolates hex colors through rgb (color / background-color)", () => {
    expect(at("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    expect(at("#ff0000", "#0000ff", 0.5)).toBe("rgb(128, 0, 128)");
  });

  it("interpolates rgb()/rgba() and hsl() colors", () => {
    expect(at("rgb(0, 0, 0)", "rgb(100, 200, 50)", 0.5)).toBe(
      "rgb(50, 100, 25)",
    );
    expect(at("rgba(0,0,0,0)", "rgba(0,0,0,1)", 0.5)).toBe(
      "rgba(0, 0, 0, 0.5)",
    );
    expect(at("hsl(0, 100%, 50%)", "hsl(120, 100%, 50%)", 0)).toBe(
      "rgb(255, 0, 0)",
    );
  });

  it("snaps only for non-interpolable keyword values", () => {
    expect(at("none", "block", 0.4)).toBe("none");
    expect(at("none", "block", 0.6)).toBe("block");
  });

  it("never snaps mid-scrub for the shipped presets", () => {
    const presets: Array<[string, string]> = [
      ["0", "1"],
      ["translateY(16px)", "translateY(0px)"],
      ["scale(0.8)", "scale(1)"],
      ["blur(8px)", "blur(0px)"],
      ["#000000", "#3366ff"],
      ["#ffffff", "#101820"],
    ];
    for (const [from, to] of presets) {
      const mid = at(from, to, 0.5);
      expect(mid === from && mid === to).toBe(false);
      if (from !== to) {
        expect(mid).not.toBe(from);
        expect(mid).not.toBe(to);
      }
    }
  });

  it("maps a `none` endpoint to the identity of the other endpoint", () => {
    expect(at("none", "translateY(16px)", 0.5)).toBe("translateY(8px)");
    expect(at("translateY(16px)", "none", 0.5)).toBe("translateY(8px)");
    expect(at("none", "blur(8px)", 0.5)).toBe("blur(4px)");
    expect(at("none", "translateY(20px) scale(0.5)", 0.5)).toBe(
      "translateY(10px) scale(0.75)",
    );
  });
});

describe("motion-preview bridge spatial cubic interpolation", () => {
  const curved = [
    {
      t: 0,
      value: "0px 0px",
      ease: "linear",
      motionPath: {
        version: 1 as const,
        type: "cubic" as const,
        control1: { x: 0, y: 100 },
        control2: { x: 0, y: 100 },
      },
    },
    { t: 1, value: "100px 0px", ease: "linear" },
  ];

  it("resolves code-backed easing variables while scrubbing the preview", () => {
    const fresh = loadBridge();
    const element = fresh.addElement("eased-node");
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [
        {
          targetNodeId: "eased-node",
          property: "opacity",
          keyframes: [
            { t: 0, value: "0", ease: "var(--an-motion-ease-smooth-out)" },
            { t: 1, value: "1" },
          ],
        },
      ],
      easingVariables: [
        {
          id: "smooth-out",
          name: "Smooth out",
          value: "cubic-bezier(0, 0, 0.58, 1)",
        },
      ],
      durationMs: 1000,
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.5, durationMs: 1000 });

    expect(Number(element.style.opacity)).toBeCloseTo(
      fresh.evalEase("cubic-bezier(0, 0, 0.58, 1)", 0.5),
      4,
    );
  });

  it("samples the cubic by distance and leaves segment timing ease independent", () => {
    expect(bridge.interpolate(curved, 0.5)).toBe("50px 75px");
    expect(
      bridge.interpolate(
        [{ ...curved[0]!, ease: "step-start" }, curved[1]!],
        0.5,
      ),
    ).toBe("100px 0px");
  });

  it("disables compiled offset-path during scrub preview and restores it on clear", () => {
    const fresh = loadBridge();
    const element = fresh.addElement("motion-path-node");
    element.style.offsetPath = 'path("M 0 0 C 0 100 100 100 100 0")';
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [
        {
          targetNodeId: "motion-path-node",
          property: "translate",
          keyframes: curved,
        },
      ],
      durationMs: 1000,
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.5, durationMs: 1000 });

    expect(element.style.translate).toBe("50px 75px");
    expect(element.style.offsetPath).toBe("none");

    fresh.sendMessage({ type: "motion-preview-clear" });
    expect(element.style.offsetPath).toBe(
      'path("M 0 0 C 0 100 100 100 100 0")',
    );
    expect(element.style.translate).toBe("");
  });

  it("renders path keyframes, easing dots, and editable controls for straight tracks", () => {
    const fresh = loadBridge();
    fresh.addElement("motion-path-node");
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [
        {
          targetNodeId: "motion-path-node",
          property: "translate",
          keyframes: [
            { t: 0, value: "0px 0px", ease: "linear" },
            { t: 1, value: "100px 0px", ease: "linear" },
          ],
        },
      ],
      durationMs: 1000,
    });
    fresh.sendMessage({
      type: "motion-path-editing",
      enabled: true,
      targetNodeId: "motion-path-node",
    });

    expect(fresh.getPathOverlay()).not.toBeNull();
    const curve = fresh.findSvg("data-motion-path-curve");
    expect(curve).not.toBeNull();
    expect(curve?.getAttribute("stroke")).toBe(
      "var(--design-editor-accent-color, Highlight)",
    );
    expect(
      fresh.findSvg("data-motion-path-keyframe", "0")?.getAttribute("fill"),
    ).toBe("Canvas");
    expect(fresh.findSvg("data-motion-path-keyframe", "1")).not.toBeNull();
    expect(
      fresh.findSvg("data-motion-path-easing-dot")?.getAttribute("stroke"),
    ).toBe("var(--design-editor-accent-color, Highlight)");
    expect(
      fresh
        .findSvg("data-motion-path-handle", "control1")
        ?.getAttribute("fill"),
    ).toBe("var(--design-editor-accent-color, Highlight)");
    expect(fresh.findSvg("data-motion-path-handle", "control2")).not.toBeNull();
  });

  it("shows a draggable transform-origin marker on the selected element", () => {
    const fresh = loadBridge();
    fresh.addElement("motion-origin-node");
    fresh.sendMessage({
      type: "motion-origin-editing",
      enabled: true,
      targetNodeId: "motion-origin-node",
    });

    expect(fresh.findSvg("data-motion-origin-overlay")).not.toBeNull();
    expect(
      fresh.findSvg("data-motion-origin-marker")?.getAttribute("transform"),
    ).toBe("translate(120 60)");
    fresh.sendMessage({ type: "motion-origin-editing", enabled: false });
    expect(fresh.findSvg("data-motion-origin-overlay")).toBeNull();
  });

  it("accepts a parent-relayed origin drag and commits its style", () => {
    const fresh = loadBridge();
    const element = fresh.addElement("motion-origin-node");
    fresh.sendMessage({
      type: "motion-origin-editing",
      enabled: true,
      targetNodeId: "motion-origin-node",
    });
    expect(fresh.parentMessages).toContainEqual(
      expect.objectContaining({
        type: "motion-origin-marker-position",
        visible: true,
        targetNodeId: "motion-origin-node",
        x: 120,
        y: 60,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    );

    fresh.sendMessage({
      type: "motion-origin-pointer",
      phase: "down",
      pointerId: 7,
      x: 120,
      y: 60,
    });
    fresh.sendMessage({
      type: "motion-origin-pointer",
      phase: "move",
      pointerId: 7,
      x: 130,
      y: 65,
    });
    fresh.sendMessage({
      type: "motion-origin-pointer",
      phase: "up",
      pointerId: 7,
      x: 130,
      y: 65,
    });

    expect(element.style["transform-origin"]).toBe("75% 75%");
    expect(fresh.parentMessages).toContainEqual(
      expect.objectContaining({
        type: "visual-style-change",
        selector: '[data-agent-native-node-id="motion-origin-node"]',
        styles: { "transform-origin": "75% 75%" },
        phase: "commit",
        preserveSelection: true,
      }),
    );
  });

  it("renders an editable path lowered from a native Position style", () => {
    const nativeStyle = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "native-position-node",
    });
    const motionPath = {
      version: 1 as const,
      type: "cubic" as const,
      control1: { x: 0, y: 40 },
      control2: { x: 30, y: -10 },
    };
    const [track] = motionNativeStylesToTracks([
      {
        ...nativeStyle,
        props: { ...nativeStyle.props, motionPath },
      },
    ]);
    const fresh = loadBridge();
    fresh.addElement("native-position-node");

    fresh.sendMessage({ type: "motion-load-tracks", tracks: [track] });
    fresh.sendMessage({
      type: "motion-path-editing",
      enabled: true,
      targetNodeId: "native-position-node",
    });

    expect(track?.keyframes[0]?.motionPath).toEqual(motionPath);
    expect(
      fresh.findSvg("data-motion-path-curve")?.getAttribute("d"),
    ).toContain("C -80 100 150 50 120 60");
    expect(fresh.findSvg("data-motion-path-handle", "control1")).toMatchObject({
      tagName: "circle",
    });
    expect(
      fresh.findSvg("data-motion-path-handle", "control1")?.getAttribute("cy"),
    ).toBe("100");
  });

  it("requires Ctrl or Cmd to drag a handle and emits one atomic spatial edit", () => {
    const fresh = loadBridge();
    fresh.addElement("motion-path-node");
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [
        {
          targetNodeId: "motion-path-node",
          property: "translate",
          keyframes: [
            { t: 0, value: "0px 0px", ease: "linear" },
            { t: 1, value: "100px 0px", ease: "linear" },
          ],
        },
      ],
      durationMs: 1000,
    });
    fresh.sendMessage({
      type: "motion-path-editing",
      enabled: true,
      targetNodeId: "motion-path-node",
    });
    const handle = fresh.findSvg("data-motion-path-handle", "control1");
    expect(handle).not.toBeNull();

    fresh.pointerDown(handle!, {});
    fresh.pointerEvent("pointermove", { clientX: 10, clientY: 30 });
    expect(fresh.parentMessages).toHaveLength(0);

    fresh.pointerDown(handle!, { ctrlKey: true });
    fresh.pointerEvent("pointermove", { clientX: 10, clientY: 30 });
    expect(fresh.parentMessages).toEqual([
      {
        type: "motion-path-edit",
        targetNodeId: "motion-path-node",
        edits: [
          {
            keyframeT: 0,
            segmentStartT: 0,
            motionPath: {
              version: 1,
              type: "cubic",
              control1: { x: 43.3333, y: 30 },
              control2: { x: -33.3333, y: 0 },
            },
          },
        ],
      },
    ]);
  });

  it("moves endpoints and adjusts adjacent curve geometry in one edit gesture", () => {
    const fresh = loadBridge();
    fresh.addElement("motion-path-node");
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [
        {
          targetNodeId: "motion-path-node",
          property: "translate",
          keyframes: [
            { t: 0, value: "0px 0px", ease: "linear" },
            { t: 1, value: "100px 0px", ease: "linear" },
          ],
        },
      ],
      durationMs: 1000,
    });
    fresh.sendMessage({
      type: "motion-path-editing",
      enabled: true,
      targetNodeId: "motion-path-node",
    });
    const endpoint = fresh.findSvg("data-motion-path-keyframe", "1");
    expect(endpoint).not.toBeNull();

    fresh.pointerDown(endpoint!, {});
    fresh.pointerEvent("pointermove", { clientX: 20, clientY: 10 });
    expect(fresh.parentMessages).toEqual([
      {
        type: "motion-path-edit",
        targetNodeId: "motion-path-node",
        edits: [
          { keyframeT: 1, value: "120px 10px" },
          {
            keyframeT: 1,
            segmentStartT: 0,
            motionPath: {
              version: 1,
              type: "cubic",
              control1: { x: 33.3333, y: 0 },
              control2: { x: -53.3333, y: -10 },
            },
          },
        ],
      },
    ]);
  });
});

describe("motion-preview bridge easing", () => {
  it("applies the CSS `ease` curve when a keyframe omits ease", () => {
    const eased = bridge.interpolate(
      [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
      0.5,
    );
    expect(parseFloat(eased)).toBeGreaterThan(0.7);
    expect(parseFloat(eased)).toBeLessThan(0.9);
  });

  it("evaluates keywords, cubic-bezier, and steps", () => {
    expect(bridge.evalEase("linear", 0.25)).toBeCloseTo(0.25, 6);
    expect(bridge.evalEase("ease-in", 0.25)).toBeLessThan(0.25);
    expect(bridge.evalEase("ease-out", 0.25)).toBeGreaterThan(0.25);
    expect(bridge.evalEase("ease-in-out", 0.5)).toBeCloseTo(0.5, 3);
    expect(bridge.evalEase("step-start", 0.01)).toBe(1);
    expect(bridge.evalEase("step-end", 0.99)).toBe(0);
    expect(bridge.evalEase("steps(4, end)", 0.3)).toBeCloseTo(0.25, 6);
    expect(bridge.evalEase("steps(4, start)", 0.3)).toBeCloseTo(0.5, 6);
    for (const ease of [
      "linear",
      "ease",
      "ease-in-out",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      "steps(3, end)",
      "spring",
    ]) {
      expect(bridge.evalEase(ease, 0)).toBe(0);
      expect(bridge.evalEase(ease, 1)).toBe(1);
    }
  });

  it("supports overshoot beziers (Spring preset) past 1", () => {
    const values = [0.5, 0.6, 0.7, 0.8].map((x) =>
      bridge.evalEase("cubic-bezier(0.34,1.56,0.64,1)", x),
    );
    expect(Math.max(...values)).toBeGreaterThan(1);
    const mid = bridge.interpolate(
      [
        {
          t: 0,
          value: "translateY(100px)",
          ease: "cubic-bezier(0.34,1.56,0.64,1)",
        },
        { t: 1, value: "translateY(0px)", ease: "linear" },
      ],
      0.7,
    );
    const px = parseFloat(mid.replace("translateY(", ""));
    expect(px).toBeLessThan(0);
  });

  it("holds the from value across the interval for step-end easing", () => {
    const held = bridge.interpolate(
      [
        { t: 0, value: "0", ease: "step-end" },
        { t: 1, value: "1", ease: "linear" },
      ],
      0.9,
    );
    expect(held).toBe("0");
  });

  it("falls back to linear for unknown easing strings", () => {
    expect(bridge.evalEase("totally-unknown", 0.4)).toBeCloseTo(0.4, 6);
  });
});

describe("motion-preview bridge spring + linear() easing", () => {
  it("evaluates spring tokens with real physics, matching the shared sampler", () => {
    for (const [token, spring] of [
      ["spring(0.69)", { bounce: 0.69, settle: 1 }],
      ["spring(0)", { bounce: 0, settle: 1 }],
      ["spring(0.2, 0.5)", { bounce: 0.2, settle: 0.5 }],
    ] as const) {
      for (const x of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        expect(bridge.evalEase(token, x)).toBeCloseTo(
          sampleSpring(spring, x),
          10,
        );
      }
    }
  });

  it("bouncy springs overshoot past 1; bounce 0 never does", () => {
    let max = 0;
    for (let i = 0; i <= 200; i++) {
      max = Math.max(max, bridge.evalEase("spring(0.69)", i / 200));
    }
    expect(max).toBeGreaterThan(1.1);
    for (let i = 0; i <= 100; i++) {
      expect(bridge.evalEase("spring(0)", i / 100)).toBeLessThanOrEqual(1.0001);
    }
  });

  it("evaluates CSS linear() stop lists (incl. compiled springs)", () => {
    expect(bridge.evalEase("linear(0, 0.5, 1)", 0.25)).toBeCloseTo(0.25, 6);
    expect(bridge.evalEase("linear(0, 0.9 20%, 1)", 0.2)).toBeCloseTo(0.9, 6);
    expect(bridge.evalEase("linear(0, 1 40% 60%, 1)", 0.5)).toBeCloseTo(1, 6);
    const compiled = springToCssLinear({ bounce: 0.69, settle: 1 });
    for (const x of [0.2, 0.5, 0.8]) {
      expect(
        Math.abs(
          bridge.evalEase(compiled, x) -
            sampleSpring({ bounce: 0.69, settle: 1 }, x),
        ),
      ).toBeLessThan(0.08);
    }
  });
});

describe("motion-preview bridge per-track offsets (span timing)", () => {
  it("restores the original style when a track is disabled", () => {
    const fresh = loadBridge();
    const el = fresh.addElement("hero");
    fresh.sendMessage({
      type: "motion-load-tracks",
      durationMs: 1000,
      tracks: [
        {
          targetNodeId: "hero",
          property: "opacity",
          keyframes: [
            { t: 0, value: "0", ease: "linear" },
            { t: 1, value: "1", ease: "linear" },
          ],
        },
      ],
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.5, durationMs: 1000 });
    expect(el.style.opacity).toBe("0.5");

    fresh.sendMessage({
      type: "motion-load-tracks",
      durationMs: 1000,
      tracks: [
        {
          targetNodeId: "hero",
          property: "opacity",
          enabled: false,
          keyframes: [
            { t: 0, value: "0", ease: "linear" },
            { t: 1, value: "1", ease: "linear" },
          ],
        },
      ],
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.75, durationMs: 1000 });

    expect(el.style.opacity).toBe("");
  });

  it("maps timeline time into an offset track's local span, clamped outside", () => {
    const fresh = loadBridge();
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [],
      durationMs: 2000,
    });
    const track = { delayMs: 500, durationMs: 1000 };
    expect(fresh.trackLocalT(track, 0)).toBe(0);
    expect(fresh.trackLocalT(track, 0.25)).toBe(0);
    expect(fresh.trackLocalT(track, 0.5)).toBeCloseTo(0.5, 6);
    expect(fresh.trackLocalT(track, 0.75)).toBe(1);
    expect(fresh.trackLocalT(track, 1)).toBe(1);
    expect(fresh.trackLocalT({}, 0.42)).toBeCloseTo(0.42, 6);
  });

  it("previews offset tracks through the real message + inline-style path", () => {
    const fresh = loadBridge();
    const el = fresh.addElement("hero");
    fresh.sendMessage({
      type: "motion-load-tracks",
      durationMs: 2000,
      tracks: [
        {
          targetNodeId: "hero",
          property: "opacity",
          delayMs: 1000,
          durationMs: 1000,
          keyframes: [
            { t: 0, value: "0", ease: "linear" },
            { t: 1, value: "1", ease: "linear" },
          ],
        },
      ],
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.25, durationMs: 2000 });
    expect(el.style.opacity).toBe("0");
    fresh.sendMessage({ type: "motion-preview", t: 0.75, durationMs: 2000 });
    expect(el.style.opacity).toBe("0.5");
    fresh.sendMessage({ type: "motion-preview", t: 1, durationMs: 2000 });
    expect(el.style.opacity).toBe("1");
    fresh.sendMessage({ type: "motion-preview-clear" });
    expect(el.style.opacity).toBe("");
  });

  it("caches the resolved element across preview ticks but re-resolves once it leaves the document", () => {
    const fresh = loadBridge();
    const originalEl = fresh.addElement("hero");
    fresh.sendMessage({
      type: "motion-load-tracks",
      durationMs: 1000,
      tracks: [
        {
          targetNodeId: "hero",
          property: "opacity",
          keyframes: [
            { t: 0, value: "0", ease: "linear" },
            { t: 1, value: "1", ease: "linear" },
          ],
        },
      ],
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.25, durationMs: 1000 });
    expect(originalEl.style.opacity).toBe("0.25");
    fresh.sendMessage({ type: "motion-preview", t: 0.5, durationMs: 1000 });
    expect(originalEl.style.opacity).toBe("0.5");

    fresh.removeElement("hero");
    const replacementEl = fresh.addElement("hero");
    fresh.sendMessage({ type: "motion-preview", t: 0.75, durationMs: 1000 });

    expect(originalEl.style.opacity).toBe("0.5");
    expect(replacementEl.style.opacity).toBe("0.75");
  });

  it("previews modern individual transform properties (translate/scale/rotate)", () => {
    const fresh = loadBridge();
    const el = fresh.addElement("card");
    fresh.sendMessage({
      type: "motion-load-tracks",
      durationMs: 1000,
      tracks: [
        {
          targetNodeId: "card",
          property: "translate",
          keyframes: [
            { t: 0, value: "0px 16px", ease: "linear" },
            { t: 1, value: "0px 0px", ease: "linear" },
          ],
        },
        {
          targetNodeId: "card",
          property: "rotate",
          keyframes: [
            { t: 0, value: "0deg", ease: "linear" },
            { t: 1, value: "90deg", ease: "linear" },
          ],
        },
        {
          targetNodeId: "card",
          property: "scale",
          keyframes: [
            { t: 0, value: "0.8", ease: "linear" },
            { t: 1, value: "1", ease: "linear" },
          ],
        },
      ],
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.5, durationMs: 1000 });
    expect(el.style.translate).toBe("0px 8px");
    expect(el.style.rotate).toBe("45deg");
    expect(el.style.scale).toBe("0.9");
  });
});

describe("motion-preview bridge native Path trim", () => {
  it("scrubs normalized SVG dash values and restores authored pathLength and styles", () => {
    const fresh = loadBridge();
    const path = fresh.addElement("path-1");
    path.setAttribute("pathLength", "24");
    path.style.strokeDasharray = "5 7";
    path.style.strokeDashoffset = "3";

    fresh.sendMessage({
      type: "motion-load-tracks",
      durationMs: 1000,
      tracks: [
        {
          targetNodeId: "path-1",
          property: "path-trim",
          keyframes: [
            { t: 0, value: "100% 20%", ease: "linear" },
            { t: 1, value: "0% 100%", ease: "linear" },
          ],
        },
      ],
    });
    fresh.sendMessage({ type: "motion-preview", t: 0.5, durationMs: 1000 });

    expect(path.getAttribute("pathLength")).toBe("100");
    expect(path.style.strokeDasharray).toBe("10 90");
    expect(path.style.strokeDashoffset).toBe("-50");

    fresh.sendMessage({ type: "motion-preview-clear" });
    expect(path.getAttribute("pathLength")).toBe("24");
    expect(path.style.strokeDasharray).toBe("5 7");
    expect(path.style.strokeDashoffset).toBe("3");
  });
});

describe("motion-preview bridge audio", () => {
  const audioClip = {
    id: "audio-1",
    sourceUrl: "https://cdn.example/audio.mp3",
    timelineStartMs: 250,
    sourceTrimStartMs: 100,
    durationMs: 500,
    volume: 0.4,
    muted: true,
  };

  it("loads durable clips and seeks without starting playback", () => {
    const fresh = loadBridge();
    fresh.sendMessage({ type: "motion-audio-load", clips: [audioClip] });
    expect(fresh.audioElements).toHaveLength(1);
    expect(fresh.audioElements[0]).toMatchObject({
      src: audioClip.sourceUrl,
      preload: "auto",
      volume: 0.4,
      muted: true,
      paused: true,
    });

    fresh.sendMessage({
      type: "motion-audio-state",
      timelineTimeMs: 500,
      isPlaying: false,
    });

    expect(fresh.audioElements[0]?.currentTime).toBe(0.35);
    expect(fresh.audioElements[0]?.paused).toBe(true);
  });

  it("plays only while the timeline is explicitly playing inside the clip", () => {
    const fresh = loadBridge();
    fresh.sendMessage({ type: "motion-audio-load", clips: [audioClip] });
    fresh.sendMessage({
      type: "motion-audio-state",
      timelineTimeMs: 500,
      isPlaying: true,
    });
    expect(fresh.audioElements[0]?.paused).toBe(false);
    expect(fresh.audioElements[0]?.currentTime).toBe(0.35);

    fresh.sendMessage({
      type: "motion-audio-state",
      timelineTimeMs: 1000,
      isPlaying: true,
    });
    expect(fresh.audioElements[0]?.paused).toBe(true);

    fresh.sendMessage({ type: "motion-audio-clear" });
    expect(fresh.audioElements[0]?.src).toBe("");
  });

  it("reports rejected playback once per explicit play attempt", async () => {
    const fresh = loadBridge();
    fresh.sendMessage({ type: "motion-audio-load", clips: [audioClip] });
    fresh.audioElements[0]!.shouldFailPlayback = true;
    fresh.sendMessage({
      type: "motion-audio-state",
      timelineTimeMs: 500,
      isPlaying: true,
    });
    await Promise.resolve();
    expect(fresh.parentMessages).toEqual([
      { type: "motion-audio-playback-error", clipId: audioClip.id },
    ]);

    fresh.sendMessage({
      type: "motion-audio-state",
      timelineTimeMs: 510,
      isPlaying: true,
    });
    await Promise.resolve();
    expect(fresh.parentMessages).toHaveLength(1);
  });
});
