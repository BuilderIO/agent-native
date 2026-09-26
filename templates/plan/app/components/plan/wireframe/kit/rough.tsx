import { useEffect, useRef, useState, type RefObject } from "react";
import rough from "roughjs";

const gen = rough.generator();

export type RoughPath = { d: string; stroke: string; strokeWidth: number };
export type RoughState = { paths: RoughPath[]; w: number; h: number };

const ROUGH_READY_ATTR = "data-rough-ready";
const ROUGH_FRAME_SELECTOR = ".plan-wf, .plan-html-frame, .plan-diagram-frame";
const EMPTY_ROUGH_STATE: RoughState = { paths: [], w: 0, h: 0 };

export const HTML_ROUGH_SELECTOR =
  "[data-rough],button,input,textarea,select,hr";

function seedFrom(...parts: Array<string | number>): number {
  const value = parts.join(":");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 2147483646) + 1;
}

export function sketchRoughness(sketch: number): number {
  const s = Math.max(0, Math.min(100, Number.isFinite(sketch) ? sketch : 0));
  return Number((0.32 + (s / 100) * 1.15).toFixed(2));
}

function sketchBowing(sketch: number): number {
  const s = Math.max(0, Math.min(100, Number.isFinite(sketch) ? sketch : 0));
  return Number((0.4 + (s / 100) * 0.5).toFixed(2));
}

function readVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function toRgbKey(color: string): string | null {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((d) => d + d)
            .join("")
        : h;
    const n = parseInt(full, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const rgb = c.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((v) => parseInt(v.trim(), 10));
    return `${r},${g},${b}`;
  }
  return null;
}

function sameColor(a: string, b: string): boolean {
  const ka = toRgbKey(a);
  const kb = toRgbKey(b);
  return ka !== null && ka === kb;
}

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M${x + rad},${y}`,
    `H${x + w - rad}`,
    `A${rad},${rad} 0 0 1 ${x + w},${y + rad}`,
    `V${y + h - rad}`,
    `A${rad},${rad} 0 0 1 ${x + w - rad},${y + h}`,
    `H${x + rad}`,
    `A${rad},${rad} 0 0 1 ${x},${y + h - rad}`,
    `V${y + rad}`,
    `A${rad},${rad} 0 0 1 ${x + rad},${y}`,
    "Z",
  ].join(" ");
}

function elementStroke(node: Element, fallback: string): string {
  const explicit = readVar(node, "--rough-stroke");
  if (explicit) return explicit;
  const cs = getComputedStyle(node);
  for (const side of [
    "borderTopColor",
    "borderLeftColor",
    "borderBottomColor",
    "borderRightColor",
  ] as const) {
    const width = parseFloat(
      cs.getPropertyValue(side.replace("Color", "Width")),
    );
    const color = cs[side];
    if (width > 0 && color && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return fallback;
}

function build(
  scope: HTMLElement,
  opts: {
    roughness: number;
    bowing: number;
    frameRadius: number;
    drawFrame: boolean;
    selector: string;
  },
): { paths: RoughPath[]; w: number; h: number } {
  const base = scope.getBoundingClientRect();
  const layoutW = scope.offsetWidth;
  const layoutH = scope.offsetHeight;
  if (!layoutW || !layoutH) return { paths: [], w: 0, h: 0 };
  const zoom = base.width / layoutW || 1;

  const themed =
    (scope.matches(ROUGH_FRAME_SELECTOR)
      ? scope
      : scope.querySelector(ROUGH_FRAME_SELECTOR)) ?? scope;
  const ink =
    readVar(themed, "--ink") || readVar(themed, "--wf-ink") || "#34322e";
  const sketch = readVar(themed, "--wf-sketch") || ink;
  const line = readVar(themed, "--wf-line") || readVar(themed, "--line") || "";

  const paths: RoughPath[] = [];
  let index = 0;
  const push = (drawable: unknown, stroke: string, sw: number) => {
    for (const p of gen.toPaths(
      drawable as Parameters<typeof gen.toPaths>[0],
    )) {
      paths.push({
        d: p.d,
        stroke: p.stroke && p.stroke !== "none" ? p.stroke : stroke,
        strokeWidth: p.strokeWidth || sw,
      });
    }
  };
  const makeOpts = (stroke: string, sw: number, seed: number) => ({
    seed,
    roughness: opts.roughness,
    bowing: opts.bowing,
    stroke,
    strokeWidth: sw,
    preserveVertices: true,
  });

  if (opts.drawFrame) {
    const sw = 2;
    push(
      gen.path(
        roundedRectPath(2, 2, layoutW - 4, layoutH - 4, opts.frameRadius),
        {
          ...makeOpts(sketch, sw, seedFrom("frame", layoutW, layoutH)),
          roughness: opts.roughness + 0.35,
          bowing: opts.bowing + 0.18,
        },
      ),
      sketch,
      sw,
    );
  }

  scope.querySelectorAll<HTMLElement>(opts.selector).forEach((node) => {
    if (node.getAttribute("data-rough") === "none") return;
    if (readVar(node, "--rough-skip") === "1") return;
    const r = node.getBoundingClientRect();
    const x = (r.left - base.left) / zoom;
    const y = (r.top - base.top) / zoom;
    const w = r.width / zoom;
    const h = r.height / zoom;
    if (w < 2 || h < 2) return;
    const kind = node.getAttribute("data-rough") || "rect";
    const rawStroke = elementStroke(node, sketch);
    const stroke =
      sameColor(rawStroke, ink) || (line !== "" && sameColor(rawStroke, line))
        ? sketch
        : rawStroke;
    const sw = Number(readVar(node, "--rough-w")) || 1.4;
    const seed = seedFrom(
      kind,
      Math.round(x),
      Math.round(y),
      Math.round(w),
      Math.round(h),
      index++,
    );
    const o = makeOpts(stroke, sw, seed);
    let drawable: unknown;
    if (kind === "ellipse") {
      drawable = gen.ellipse(x + w / 2, y + h / 2, w, h, o);
    } else if (kind === "line:right") {
      drawable = gen.line(x + w, y, x + w, y + h, o);
    } else if (kind === "line:bottom") {
      drawable = gen.line(x, y + h, x + w, y + h, o);
    } else if (kind === "line:top" || node.tagName === "HR") {
      drawable = gen.line(x, y + h / 2, x + w, y + h / 2, o);
    } else {
      const cr = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
      const radius = Math.min(cr / zoom, w / 2, h / 2);
      drawable =
        radius > 1
          ? gen.path(roundedRectPath(x + 1, y + 1, w - 2, h - 2, radius), o)
          : gen.rectangle(x + 1, y + 1, w - 2, h - 2, o);
    }
    push(drawable, stroke, sw);
  });

  return { paths, w: layoutW, h: layoutH };
}

export function RoughOverlay({
  scopeRef,
  sketch = 52,
  enabled = true,
  drawFrame = true,
  frameRadius = 14,
  selector = "[data-rough]",
}: {
  scopeRef: RefObject<HTMLElement | null>;
  sketch?: number;
  enabled?: boolean;
  drawFrame?: boolean;
  frameRadius?: number;
  selector?: string;
}) {
  const [state, setState] = useState<RoughState>(EMPTY_ROUGH_STATE);
  const rafRef = useRef(0);

  useEffect(() => {
    const el = scopeRef.current;
    if (!el || !enabled) {
      if (el) setRoughReadyState(el, false);
      setState((current) =>
        sameRoughState(current, EMPTY_ROUGH_STATE)
          ? current
          : EMPTY_ROUGH_STATE,
      );
      return;
    }
    const roughness = sketchRoughness(sketch);
    const bowing = sketchBowing(sketch);
    const measure = () => {
      clearTimeout(rafRef.current);
      rafRef.current = window.setTimeout(() => {
        const next = build(el, {
          roughness,
          bowing,
          frameRadius,
          drawFrame,
          selector,
        });
        if (next.w && next.h) {
          setRoughReadyState(el, true);
          setState((current) =>
            sameRoughState(current, next) ? current : next,
          );
        }
      }, 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll(selector).forEach((node) => ro.observe(node));
    const mo = new MutationObserver((mutations) => {
      if (mutations.every(isRoughOverlayMutation)) return;
      measure();
    });
    mo.observe(el, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    el.addEventListener("plan-prototype-runtime:rendered", measure);
    let cancelled = false;
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("plan-prototype-runtime:rendered", measure);
      clearTimeout(rafRef.current);
      setRoughReadyState(el, false);
    };
  }, [scopeRef, sketch, enabled, drawFrame, frameRadius, selector]);

  if (!enabled || !state.paths.length) return null;
  return (
    <svg
      aria-hidden
      className="plan-rough-overlay"
      width="100%"
      height="100%"
      viewBox={`0 0 ${state.w} ${state.h}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 3,
      }}
    >
      {state.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function setRoughReadyState(scope: HTMLElement, ready: boolean) {
  setRoughReady(scope, ready);
  const themed = scope.matches(ROUGH_FRAME_SELECTOR)
    ? scope
    : scope.querySelector(ROUGH_FRAME_SELECTOR);
  if (themed && themed !== scope) setRoughReady(themed, ready);
}

function setRoughReady(element: Element, ready: boolean) {
  if (ready) {
    if (element.getAttribute(ROUGH_READY_ATTR) !== "true") {
      element.setAttribute(ROUGH_READY_ATTR, "true");
    }
    return;
  }
  if (element.hasAttribute(ROUGH_READY_ATTR)) {
    element.removeAttribute(ROUGH_READY_ATTR);
  }
}

export function sameRoughState(a: RoughState, b: RoughState): boolean {
  if (a.w !== b.w || a.h !== b.h || a.paths.length !== b.paths.length) {
    return false;
  }
  return a.paths.every((path, index) => {
    const other = b.paths[index];
    return (
      path.d === other.d &&
      path.stroke === other.stroke &&
      path.strokeWidth === other.strokeWidth
    );
  });
}

export function isRoughOverlayMutation(mutation: MutationRecord) {
  if (
    mutation.type === "attributes" &&
    mutation.attributeName === ROUGH_READY_ATTR
  ) {
    return true;
  }
  if (nodeIsRoughOverlay(mutation.target)) return true;

  const changedNodes = [
    ...Array.from(mutation.addedNodes),
    ...Array.from(mutation.removedNodes),
  ];
  return changedNodes.length > 0 && changedNodes.every(nodeIsRoughOverlay);
}

function nodeIsRoughOverlay(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(
    element?.classList.contains("plan-rough-overlay") ||
    element?.closest(".plan-rough-overlay"),
  );
}
