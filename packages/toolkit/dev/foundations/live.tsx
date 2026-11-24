import { PARTS } from "@agent-native/design-system";
import * as React from "react";

/**
 * What the Storybook stage decorator set: read from the stage element itself,
 * so a page always describes the attributes its values resolved under.
 */
export interface Stage {
  theme: string;
  appearance: "light" | "dark";
  density: string;
  /** The `data-radius` preset, or null when the theme's own radius applies. */
  radius: string | null;
  corners: string;
  /** The `data-palette` id, or null when the theme's own scales apply. */
  palette: string | null;
}

const STAGE_ATTRIBUTES = [
  "class",
  "data-app-theme",
  "data-density",
  "data-radius",
  "data-corners",
  "data-palette",
];

function readStage(element: HTMLElement): Stage {
  const theme = element.getAttribute("data-app-theme");
  const density = element.getAttribute("data-density");
  const corners = element.getAttribute("data-corners");
  if (theme === null || density === null || corners === null) {
    throw new Error(
      "The Storybook stage is missing data-app-theme, data-density or data-corners",
    );
  }
  return {
    theme,
    appearance: element.classList.contains("dark") ? "dark" : "light",
    density,
    radius: element.getAttribute("data-radius"),
    corners,
    palette: element.getAttribute("data-palette"),
  };
}

interface LiveContextValue {
  probe: HTMLElement | null;
  stage: Stage | null;
  version: number;
}

const LiveContext = React.createContext<LiveContextValue | null>(null);

function useLive(): LiveContextValue {
  const value = React.useContext(LiveContext);
  if (value === null) {
    throw new Error("Foundation components render inside <LiveRoot>");
  }
  return value;
}

/** The stage the page renders on, or null before the first layout. */
export function useStage(): Stage | null {
  return useLive().stage;
}

/**
 * Tracks the stage decorator's attributes and the runtime palette `<style>`
 * beside it, and hosts the hidden probe every live value resolves on.
 */
export function LiveRoot({ children }: { children: React.ReactNode }) {
  const probeRef = React.useRef<HTMLSpanElement>(null);
  const [state, setState] = React.useState<LiveContextValue>({
    probe: null,
    stage: null,
    version: 0,
  });

  React.useLayoutEffect(() => {
    const probe = probeRef.current;
    if (probe === null) return;
    const stage = probe.closest<HTMLElement>("[data-storybook-stage]");
    if (stage === null) {
      throw new Error("Foundation pages render inside the Storybook stage");
    }
    const refresh = () =>
      setState((previous) => ({
        probe,
        stage: readStage(stage),
        version: previous.version + 1,
      }));
    refresh();
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) => record.target === stage || !stage.contains(record.target),
        )
      ) {
        refresh();
      }
    });
    observer.observe(stage, {
      attributes: true,
      attributeFilter: STAGE_ATTRIBUTES,
    });
    if (stage.parentElement !== null) {
      observer.observe(stage.parentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    return () => observer.disconnect();
  }, []);

  return (
    <LiveContext.Provider value={state}>
      <span
        ref={probeRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute block h-0"
      />
      {children}
    </LiveContext.Provider>
  );
}

/** A token's value in a token map, or undefined when the map does not set it. */
export function lookup(
  map: Readonly<Record<string, string>>,
  token: string,
): string | undefined {
  return Object.hasOwn(map, token) ? map[token] : undefined;
}

export type Resolved =
  | { status: "unset" }
  | { status: "ok"; value: string }
  | { status: "color"; value: string; rgba: Rgba };

export type Rgba = readonly [number, number, number, number];

let canvasContext: CanvasRenderingContext2D | null = null;

function rasterContext(): CanvasRenderingContext2D {
  if (canvasContext !== null) return canvasContext;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("No 2D canvas to sample colors on");
  canvasContext = context;
  return context;
}

function sampleColor(computed: string): Rgba {
  const context = rasterContext();
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = computed;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a];
}

const byte = (value: number) => value.toString(16).padStart(2, "0");

export function toHex([r, g, b, a]: Rgba): string {
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`;
}

export type ResolveKind = "raw" | "length" | "color";

function resolveOne(
  probe: HTMLElement,
  token: string,
  kind: ResolveKind,
): Resolved {
  const raw = getComputedStyle(probe).getPropertyValue(token).trim();
  if (raw === "") return { status: "unset" };
  if (kind === "raw") return { status: "ok", value: raw };
  if (kind === "length") {
    probe.style.setProperty("width", `var(${token})`);
    const value = getComputedStyle(probe).width;
    probe.style.removeProperty("width");
    return { status: "ok", value };
  }
  probe.style.setProperty("color", `var(${token})`);
  const computed = getComputedStyle(probe).color;
  probe.style.removeProperty("color");
  const rgba = sampleColor(computed);
  return { status: "color", value: toHex(rgba), rgba };
}

/**
 * Each token's live value on the stage: its computed text, a length in px, or
 * the sRGB color it paints. Re-resolved whenever the toolbar changes.
 */
export function useResolved(
  tokens: readonly string[],
  kind: ResolveKind,
): ReadonlyMap<string, Resolved> {
  const { probe, version } = useLive();
  const [values, setValues] = React.useState<ReadonlyMap<string, Resolved>>(
    () => new Map(),
  );
  const key = tokens.join(" ");
  React.useLayoutEffect(() => {
    if (probe === null) return;
    setValues(
      new Map(
        key
          .split(" ")
          .filter(Boolean)
          .map((token) => [token, resolveOne(probe, token, kind)]),
      ),
    );
  }, [probe, version, key, kind]);
  return values;
}

/** The text a resolved value shows; an unset token says so rather than blank. */
export function resolvedText(resolved: Resolved | undefined): string {
  if (resolved === undefined) return "";
  return resolved.status === "unset" ? "Not set" : resolved.value;
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio of two colors, the foreground composited over the background. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const alpha = foreground[3] / 255;
  const over = (index: 0 | 1 | 2) =>
    foreground[index] * alpha + background[index] * (1 - alpha);
  const composed: Rgba = [over(0), over(1), over(2), 255];
  const a = luminance(composed);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const WCAG_AA_TEXT = 4.5;

function partFor(selector: string, inherited: string | null): string | null {
  let best: string | null = null;
  for (const [, name = ""] of selector.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
    for (const part of PARTS) {
      if (
        (name === part.name || name.startsWith(`${part.name}-`)) &&
        (best === null || part.name.length > best.length)
      ) {
        best = part.name;
      }
    }
  }
  return best ?? inherited;
}

function hasRules(rule: CSSRule): rule is CSSRule & { cssRules: CSSRuleList } {
  return "cssRules" in rule && rule.cssRules instanceof CSSRuleList;
}

function collect(
  rules: CSSRuleList,
  inherited: string | null,
  into: Map<string, Set<string>>,
) {
  for (const rule of Array.from(rules)) {
    let part = inherited;
    if (rule instanceof CSSStyleRule) {
      part = partFor(rule.selectorText, inherited);
      if (part !== null) {
        for (const [, token = ""] of rule.style.cssText.matchAll(
          /var\((--[a-z0-9-]+)/g,
        )) {
          const parts = into.get(token) ?? new Set<string>();
          parts.add(part);
          into.set(token, parts);
        }
      }
    }
    if (hasRules(rule)) collect(rule.cssRules, part, into);
  }
}

export interface TokenUsage {
  /** Part names whose CSS reads each token. */
  parts: ReadonlyMap<string, ReadonlySet<string>>;
  /** Stylesheets from another origin, whose rules the browser keeps private. */
  unreadableSheets: number;
}

/** Which parts read each token, scanned from the part CSS the page has loaded. */
export function useTokenUsage(): TokenUsage | null {
  const { version, probe } = useLive();
  const [usage, setUsage] = React.useState<TokenUsage | null>(null);
  React.useLayoutEffect(() => {
    if (probe === null) return;
    const parts = new Map<string, Set<string>>();
    let unreadableSheets = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      if (
        sheet.href !== null &&
        new URL(sheet.href).origin !== location.origin
      ) {
        unreadableSheets += 1;
        continue;
      }
      collect(sheet.cssRules, null, parts);
    }
    setUsage({ parts, unreadableSheets });
  }, [version, probe]);
  return usage;
}
