import { parseHTML } from "linkedom/worker";

import {
  getElementPath,
  getElementPreview,
} from "../../app/lib/slide-animation-elements.js";
import {
  compositeOver,
  contrastRatio,
  isBoldFontWeight,
  parseCssColor,
  requiredContrastRatio,
  resolveCssVarChain,
  toHexColor,
  type RgbaColor,
} from "../../shared/contrast.js";
import { resolveSlideBackground } from "../../shared/slide-background.js";

// Mirrors app/global.css's .fmd-slide default text color fallback so an
// element with no explicit color anywhere in its ancestor chain resolves
// the same way the renderer does.
// guard:allow-raw-color - mirrors the fixed fallback baked into global.css
const DEFAULT_SLIDE_TEXT_COLOR = "#1f2933";

// Mirrors the two semantic surface/text classes app/global.css defines on
// `.fmd-slide` descendants. Anything beyond these two is per-deck styling
// this static audit does not attempt to resolve from a class name alone.
const MUTED_TEXT_CLASSES = new Set(["fmd-muted", "fmd-subtitle"]);
const ACCENT_TEXT_CLASSES = new Set(["fmd-accent", "fmd-cyan"]);
const CALLOUT_CLASS = new Set(["fmd-callout"]);
// guard:allow-raw-color - mirrors app/global.css's `.fmd-callout` background.
const CALLOUT_BACKGROUND: RgbaColor = { r: 255, g: 255, b: 255, a: 0.05 };

// guard:allow-raw-color - mirrors .fmd-muted's fixed fallback in global.css
const MUTED_TEXT_VAR_EXPRESSION = "var(--ds-text-muted, #667085)";
// guard:allow-raw-color - mirrors .fmd-accent's fixed fallback in global.css
const ACCENT_TEXT_VAR_EXPRESSION = "var(--ds-accent, #2457d6)";

const DEFAULT_FONT_SIZE_BY_TAG: Record<string, number> = {
  h1: 32,
  h2: 28,
  h3: 24,
  h4: 20,
  h5: 18,
  h6: 16,
};

const SKIPPED_TAGS = new Set(["script", "style", "template", "svg"]);

export interface SlideContrastDesignSystemColors {
  text?: string;
  textMuted?: string;
  accent?: string;
  surface?: string;
  primary?: string;
  secondary?: string;
  background?: string;
  slideDefaultsBackground?: string;
}

export interface ContrastIssue {
  elementPath: number[];
  preview: string;
  foreground: string;
  background: string;
  ratio: number;
  requiredRatio: number;
  isLargeText: boolean;
  fontSizePx: number;
  bold: boolean;
}

export interface UnresolvedContrastElement {
  elementPath: number[];
  preview: string;
  reason: "color" | "background";
  rawValue: string;
}

export interface SlideContrastResult {
  status: "measured" | "no-root" | "empty";
  elementsChecked: number;
  issues: ContrastIssue[];
  unresolved: UnresolvedContrastElement[];
}

function parseInlineStyle(styleAttr: string | null): Map<string, string> {
  const declarations = new Map<string, string>();
  if (!styleAttr) return declarations;
  for (const raw of styleAttr.split(";")) {
    const idx = raw.indexOf(":");
    if (idx <= 0) continue;
    const property = raw.slice(0, idx).trim().toLowerCase();
    const value = raw.slice(idx + 1).trim();
    if (!property || !value) continue;
    declarations.set(property, value);
  }
  return declarations;
}

function hasClass(element: Element, classes: Set<string>): boolean {
  for (const name of classes) {
    if (element.classList.contains(name)) return true;
  }
  return false;
}

/**
 * Collect every `--name: value;` inline custom-property declaration in
 * document order, resolving each against the values already collected. This
 * approximates CSS custom-property cascade well enough for these decks: the
 * `--deck-*` contract is declared once on the `.fmd-slide` wrapper and read
 * everywhere below it.
 */
function collectCssVariables(
  root: Element,
  base: ReadonlyMap<string, string>,
): Map<string, string> {
  const vars = new Map(base);
  const walk = (el: Element) => {
    const style = parseInlineStyle(el.getAttribute("style"));
    for (const [property, value] of style) {
      if (!property.startsWith("--")) continue;
      vars.set(property, resolveCssVarChain(value, vars));
    }
    for (const child of Array.from(el.children)) walk(child as Element);
  };
  walk(root);
  return vars;
}

function ancestorsInclusive(root: Element, element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    chain.push(current);
    if (current === root) break;
    current = current.parentElement;
  }
  return chain;
}

interface ResolvedColorResult {
  color: RgbaColor | null;
  unresolvedValue: string | null;
}

function resolveTextColor(
  chain: Element[],
  vars: ReadonlyMap<string, string>,
  defaultColorHex: string,
): ResolvedColorResult {
  for (const el of chain) {
    const style = parseInlineStyle(el.getAttribute("style"));
    const declared = style.get("color");
    if (declared) {
      const resolved = resolveCssVarChain(declared, vars);
      if (resolved.toLowerCase() === "currentcolor") continue;
      const parsed = parseCssColor(resolved);
      if (parsed) return { color: parsed, unresolvedValue: null };
      return { color: null, unresolvedValue: resolved };
    }
    if (hasClass(el, MUTED_TEXT_CLASSES)) {
      const muted = resolveCssVarChain(MUTED_TEXT_VAR_EXPRESSION, vars);
      const parsed = parseCssColor(muted);
      return parsed
        ? { color: parsed, unresolvedValue: null }
        : { color: null, unresolvedValue: muted };
    }
    if (hasClass(el, ACCENT_TEXT_CLASSES)) {
      const accent = resolveCssVarChain(ACCENT_TEXT_VAR_EXPRESSION, vars);
      const parsed = parseCssColor(accent);
      return parsed
        ? { color: parsed, unresolvedValue: null }
        : { color: null, unresolvedValue: accent };
    }
  }
  const parsed = parseCssColor(defaultColorHex);
  return parsed
    ? { color: parsed, unresolvedValue: null }
    : { color: null, unresolvedValue: defaultColorHex };
}

function resolveBackgroundFrom(
  chain: Element[],
  startIndex: number,
  vars: ReadonlyMap<string, string>,
  slideBackground: RgbaColor | null,
  slideBackgroundRaw: string,
): ResolvedColorResult {
  for (let i = startIndex; i < chain.length; i += 1) {
    const el = chain[i];
    const style = parseInlineStyle(el.getAttribute("style"));
    const declared = style.get("background-color") ?? style.get("background");
    let layerColor: RgbaColor | null = null;

    if (declared) {
      if (/gradient|url\(/i.test(declared)) {
        return { color: null, unresolvedValue: declared };
      }
      const resolved = resolveCssVarChain(declared, vars);
      if (resolved.toLowerCase() === "transparent") {
        layerColor = null;
      } else if (resolved.toLowerCase() === "currentcolor") {
        // `background: currentColor` depends on the same element's resolved
        // text color, which this pass does not have in hand here; flag it
        // rather than guess.
        return { color: null, unresolvedValue: resolved };
      } else {
        const parsed = parseCssColor(resolved);
        if (!parsed) return { color: null, unresolvedValue: resolved };
        layerColor = parsed;
      }
    } else if (hasClass(el, CALLOUT_CLASS)) {
      layerColor = CALLOUT_BACKGROUND;
    }

    if (!layerColor) continue;
    if (layerColor.a >= 1) return { color: layerColor, unresolvedValue: null };

    const beneath = resolveBackgroundFrom(
      chain,
      i + 1,
      vars,
      slideBackground,
      slideBackgroundRaw,
    );
    if (!beneath.color) return beneath;
    return {
      color: compositeOver(layerColor, beneath.color),
      unresolvedValue: null,
    };
  }
  return slideBackground
    ? { color: slideBackground, unresolvedValue: null }
    : { color: null, unresolvedValue: slideBackgroundRaw };
}

function parsePxValue(value: string): number | null {
  const match = /^(-?[\d.]+)px$/i.exec(value.trim());
  return match ? parseFloat(match[1]) : null;
}

function resolveFontSize(chain: Element[]): number {
  for (const el of chain) {
    const declared = parseInlineStyle(el.getAttribute("style")).get(
      "font-size",
    );
    if (!declared) continue;
    const px = parsePxValue(declared);
    return px ?? DEFAULT_FONT_SIZE_BY_TAG[chain[0].tagName.toLowerCase()] ?? 16;
  }
  return DEFAULT_FONT_SIZE_BY_TAG[chain[0].tagName.toLowerCase()] ?? 16;
}

function resolveFontWeightBold(chain: Element[]): boolean {
  for (const el of chain) {
    const declared = parseInlineStyle(el.getAttribute("style")).get(
      "font-weight",
    );
    if (!declared) continue;
    const trimmed = declared.trim().toLowerCase();
    if (trimmed === "bold" || trimmed === "bolder") return true;
    if (trimmed === "normal" || trimmed === "lighter") return false;
    const numeric = parseFloat(trimmed);
    if (!Number.isNaN(numeric)) return isBoldFontWeight(numeric);
    break;
  }
  return /^h[1-6]$/.test(chain[0].tagName.toLowerCase());
}

function hasOwnVisibleText(element: Element, textNodeType: number): boolean {
  return Array.from(element.childNodes).some((node) => {
    if ((node as { nodeType: number }).nodeType !== textNodeType) return false;
    return Boolean((node.textContent ?? "").replace(/\s+/g, " ").trim());
  });
}

function collectTextElements(
  root: Element,
  textNodeType: number,
  out: Element[],
): void {
  const walk = (el: Element) => {
    if (SKIPPED_TAGS.has(el.tagName.toLowerCase())) return;
    const style = parseInlineStyle(el.getAttribute("style"));
    if (style.get("display") === "none") return;
    if (style.get("visibility") === "hidden") return;
    if (hasOwnVisibleText(el, textNodeType)) out.push(el);
    for (const child of Array.from(el.children)) walk(child as Element);
  };
  walk(root);
}

/**
 * Audit one slide's persisted HTML for WCAG AA text contrast using its
 * actual inline colors and the deck's linked design system — no browser
 * rendering required, since color resolution (unlike layout fit) is a pure
 * function of the CSS the slide already declares.
 */
export function analyzeSlideContrast(
  content: string,
  options: {
    slideBackground?: string;
    designSystem?: SlideContrastDesignSystemColors;
  } = {},
): SlideContrastResult {
  const { document, Node } = parseHTML(
    `<!doctype html><html><head></head><body>${content}</body></html>`,
  );
  const root = document.querySelector(".fmd-slide");
  if (!root) {
    return {
      status: "no-root",
      elementsChecked: 0,
      issues: [],
      unresolved: [],
    };
  }

  const resolvedSlideBackgroundValue = resolveSlideBackground(
    options.slideBackground,
    options.designSystem
      ? {
          slideDefaults: {
            background: options.designSystem.slideDefaultsBackground ?? "",
          },
          colors: { background: options.designSystem.background ?? "" },
        }
      : undefined,
  );
  const slideBackgroundColor = parseCssColor(resolvedSlideBackgroundValue);

  const dsVars = new Map<string, string>();
  dsVars.set("--ds-bg", resolvedSlideBackgroundValue);
  const designSystem = options.designSystem;
  if (designSystem?.text) dsVars.set("--ds-text", designSystem.text);
  if (designSystem?.textMuted) {
    dsVars.set("--ds-text-muted", designSystem.textMuted);
  }
  if (designSystem?.accent) dsVars.set("--ds-accent", designSystem.accent);
  if (designSystem?.surface) dsVars.set("--ds-surface", designSystem.surface);
  if (designSystem?.primary) dsVars.set("--ds-primary", designSystem.primary);
  if (designSystem?.secondary) {
    dsVars.set("--ds-secondary", designSystem.secondary);
  }

  const defaultTextColorHex =
    designSystem?.text?.trim() || DEFAULT_SLIDE_TEXT_COLOR;
  const vars = collectCssVariables(root, dsVars);

  const elements: Element[] = [];
  collectTextElements(root, Node.TEXT_NODE, elements);

  const issues: ContrastIssue[] = [];
  const unresolved: UnresolvedContrastElement[] = [];

  for (const element of elements) {
    const chain = ancestorsInclusive(root, element);
    const textResult = resolveTextColor(chain, vars, defaultTextColorHex);
    const bgResult = resolveBackgroundFrom(
      chain,
      0,
      vars,
      slideBackgroundColor,
      resolvedSlideBackgroundValue,
    );
    const path = getElementPath(root, element) ?? [];
    const preview = getElementPreview(element, "Text element");

    if (!textResult.color || !bgResult.color) {
      unresolved.push({
        elementPath: path,
        preview,
        reason: !textResult.color ? "color" : "background",
        rawValue:
          (!textResult.color
            ? textResult.unresolvedValue
            : bgResult.unresolvedValue) ?? "unknown",
      });
      continue;
    }

    const fontSizePx = resolveFontSize(chain);
    const bold = resolveFontWeightBold(chain);
    const { required, isLargeText } = requiredContrastRatio(fontSizePx, bold);
    const ratio = contrastRatio(textResult.color, bgResult.color);

    if (ratio < required) {
      issues.push({
        elementPath: path,
        preview,
        foreground: toHexColor(textResult.color),
        background: toHexColor(bgResult.color),
        ratio: Math.round(ratio * 100) / 100,
        requiredRatio: required,
        isLargeText,
        fontSizePx,
        bold,
      });
    }
  }

  return {
    status: elements.length === 0 ? "empty" : "measured",
    elementsChecked: elements.length,
    issues,
    unresolved,
  };
}
