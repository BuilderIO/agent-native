import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sampleSpring, springToCssLinear } from "../../../shared/motion-easing";

/**
 * These tests exercise the REAL motion-preview bridge script that
 * `DesignCanvas.tsx` injects into the design iframe. Rather than copy the
 * interpolation logic (which would drift), we import the compiled bridge
 * string from the generated module, strip the IIFE wrapper, and pull out
 * `lerp` / `interpolate` so we can assert the live-scrub preview produces
 * smoothly interpolated values instead of snapping at the midpoint.
 *
 * Source: app/components/design/bridge/motion-preview.bridge.ts
 * Compiled: .generated/bridge/motion-preview.generated.ts
 */
interface FakeElement {
  style: Record<string, string>;
}

function loadBridge(): {
  lerp: (a: string, b: string, ratio: number) => string;
  interpolate: (
    keyframes: Array<{ t: number; value: string; ease?: string }>,
    t: number,
  ) => string;
  parseColor: (value: string) => number[] | null;
  evalEase: (ease: string | undefined, x: number) => number;
  trackLocalT: (
    track: { delayMs?: number; durationMs?: number },
    t: number,
  ) => number;
  /** Dispatch a parent → iframe postMessage into the bridge's listener. */
  sendMessage: (data: unknown) => void;
  /** Register a fake element addressable by data-agent-native-node-id. */
  addElement: (nodeId: string) => FakeElement;
  /** Simulate the node leaving the document (e.g. replaced by a host edit). */
  removeElement: (nodeId: string) => void;
} {
  // Import the compiled bridge string from the generated module. Using
  // require() so the import is synchronous and the function can be called
  // at module evaluation time (loadBridge() is called at top level).
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

  // The generated string is the compiled IIFE JS (no <script> tags).
  // esbuild wraps the source IIFE in an outer arrow-IIFE:
  //   "use strict";\n(() => {\n  // source-file-comment\n  (function() {\n    ...\n  })();\n})();\n
  // Strip both wrappers so only the function body is left, then pull out
  // lerp / interpolate / parseColor by appending a return statement.
  let body = motionPreviewBridgeScript;
  // Remove leading "use strict"; and outer (() => { ... })() opening
  body = body.replace(/^["']use strict["'];\s*\(\(\)\s*=>\s*\{/, "");
  // Remove outer IIFE closing
  body = body.replace(/\}\)\(\);\s*$/, "");
  // Remove source-location comment (// app/components/design/bridge/...)
  body = body.replace(/^\s*\/\/[^\n]*\n/, "");
  // Remove inner (function() { ... })() opening
  body = body.replace(/^\s*\(function\s*\(\s*\)\s*\{/, "");
  // Remove inner IIFE closing
  body = body.replace(/\}\)\(\);\s*$/, "");

  // Fake window/document so the bridge's live message handler and
  // applyPreview() path are exercised for real (offsets, inline styles).
  const listeners: Array<(e: unknown) => void> = [];
  const elements = new Map<string, FakeElement>();
  const parentSentinel = {};
  const fakeWindow = {
    parent: parentSentinel,
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (type === "message") listeners.push(fn);
    },
  };
  const fakeDocument = {
    querySelector(selector: string): FakeElement | null {
      const m = /\[data-agent-native-node-id="([^"]+)"\]/.exec(selector);
      return m ? (elements.get(m[1]) ?? null) : null;
    },
    // The bridge's element cache (resolveTrackElement) checks
    // `document.contains(cached)` before trusting a cached lookup, so the
    // fake document needs to answer that too — "contained" here means
    // still registered in this test's `elements` map (removeElement below
    // simulates the node leaving the document, e.g. a host-applied edit
    // replacing it).
    contains(node: unknown): boolean {
      return Array.from(elements.values()).includes(node as FakeElement);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "window",
    "document",
    body +
      "\n; return { lerp, interpolate, parseColor, evalEase, trackLocalT };",
  );
  const api = factory(fakeWindow, fakeDocument);
  return {
    ...api,
    sendMessage: (data: unknown) => {
      for (const fn of listeners) fn({ source: parentSentinel, data });
    },
    addElement: (nodeId: string) => {
      const el: FakeElement = { style: {} };
      elements.set(nodeId, el);
      return el;
    },
    removeElement: (nodeId: string) => {
      elements.delete(nodeId);
    },
  };
}

const bridge = loadBridge();
// Value-interpolation tests pin ease to "linear" so they assert exact
// midpoints; easing behavior itself is covered separately below. Keyframes
// without an ease fall back to the CSS "ease" curve (the compiled
// stylesheet's defaultEase default), not linear.
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
    // #000000 -> #ffffff at 0.5 is mid-grey.
    expect(at("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    // #ff0000 -> #0000ff at 0.5.
    expect(at("#ff0000", "#0000ff", 0.5)).toBe("rgb(128, 0, 128)");
  });

  it("interpolates rgb()/rgba() and hsl() colors", () => {
    expect(at("rgb(0, 0, 0)", "rgb(100, 200, 50)", 0.5)).toBe(
      "rgb(50, 100, 25)",
    );
    expect(at("rgba(0,0,0,0)", "rgba(0,0,0,1)", 0.5)).toBe(
      "rgba(0, 0, 0, 0.5)",
    );
    // hsl red -> hsl(120 ...) green-ish; just assert it produced an rgb mix.
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
      // A correctly-interpolated midpoint must differ from at least one
      // endpoint (the old snap returned an endpoint verbatim).
      expect(mid === from && mid === to).toBe(false);
      if (from !== to) {
        expect(mid).not.toBe(from);
        expect(mid).not.toBe(to);
      }
    }
  });

  it("maps a `none` endpoint to the identity of the other endpoint", () => {
    // transform: none -> translateY(16px) lerps from translateY(0px)
    // instead of midpoint-snapping.
    expect(at("none", "translateY(16px)", 0.5)).toBe("translateY(8px)");
    expect(at("translateY(16px)", "none", 0.5)).toBe("translateY(8px)");
    expect(at("none", "blur(8px)", 0.5)).toBe("blur(4px)");
    expect(at("none", "translateY(20px) scale(0.5)", 0.5)).toBe(
      "translateY(10px) scale(0.75)",
    );
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
    // ease(0.5) ≈ 0.8 — decisively NOT the linear midpoint.
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
    // Endpoints always pin for every supported form.
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
    // Overshoot flows through numeric interpolation (extrapolates past `to`).
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

describe("motion-preview bridge spring + linear() easing (Figma Motion parity)", () => {
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
    // A compiled spring replays through linear() close to the true spring.
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
  it("maps timeline time into an offset track's local span, clamped outside", () => {
    const fresh = loadBridge();
    // Establish the timeline duration via a load message.
    fresh.sendMessage({
      type: "motion-load-tracks",
      tracks: [],
      durationMs: 2000,
    });
    const track = { delayMs: 500, durationMs: 1000 };
    expect(fresh.trackLocalT(track, 0)).toBe(0);
    expect(fresh.trackLocalT(track, 0.25)).toBe(0); // 500ms = span start
    expect(fresh.trackLocalT(track, 0.5)).toBeCloseTo(0.5, 6); // 1000ms
    expect(fresh.trackLocalT(track, 0.75)).toBe(1); // 1500ms = span end
    expect(fresh.trackLocalT(track, 1)).toBe(1);
    // Offset-free tracks pass through unchanged.
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
    // Before the span: holds the first keyframe value (fill-mode both).
    fresh.sendMessage({ type: "motion-preview", t: 0.25, durationMs: 2000 });
    expect(el.style.opacity).toBe("0");
    // Mid-span: 1500ms → local t 0.5.
    fresh.sendMessage({ type: "motion-preview", t: 0.75, durationMs: 2000 });
    expect(el.style.opacity).toBe("0.5");
    // After the span end: holds the last keyframe value.
    fresh.sendMessage({ type: "motion-preview", t: 1, durationMs: 2000 });
    expect(el.style.opacity).toBe("1");
    // Clear restores the original inline value.
    fresh.sendMessage({ type: "motion-preview-clear" });
    expect(el.style.opacity).toBe("");
  });

  it("caches the resolved element across preview ticks but re-resolves once it leaves the document", () => {
    // Perf regression coverage: applyPreview used to call
    // document.querySelector for every track on every single "motion-preview"
    // tick (one per parent rAF frame), even though the target element almost
    // never changes between ticks. Assert the cache (a) is actually used —
    // repeated ticks with the node still present must keep hitting the SAME
    // element instance — and (b) is safely invalidated when the node is no
    // longer in the document (e.g. a host-applied edit replaced it), so a
    // stale cached reference can never silently swallow further updates.
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

    // The node is replaced (removed, then a NEW element re-registered under
    // the same nodeId) without any "motion-load-tracks" reload in between —
    // exactly what a live DOM patch looks like from the bridge's perspective.
    fresh.removeElement("hero");
    const replacementEl = fresh.addElement("hero");
    fresh.sendMessage({ type: "motion-preview", t: 0.75, durationMs: 1000 });

    // The stale cached element must NOT keep receiving updates...
    expect(originalEl.style.opacity).toBe("0.5");
    // ...the NEW element must, proving the cache re-resolved instead of
    // silently no-oping against a detached reference.
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
    // Individual transform properties compose without clobbering each other.
    expect(el.style.translate).toBe("0px 8px");
    expect(el.style.rotate).toBe("45deg");
    expect(el.style.scale).toBe("0.9");
  });
});
