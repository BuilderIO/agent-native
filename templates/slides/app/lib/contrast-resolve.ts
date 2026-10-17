export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ContrastMeasurement {
  foreground: string;
  background: string;
  ratio: number;
  requiredRatio: number;
  fontSize: string;
  fontWeight: string;
}

export type HitTest = (x: number, y: number) => Element[];

// Reasons that only mean "axe could not work out the background". Others
// (icon glyphs, pseudo content, off-screen text) are not background questions.
export const RESOLVABLE_REASONS = new Set([
  "bgOverlap",
  "bgImage",
  "bgGradient",
  "elmPartiallyObscured",
  "elmPartiallyObscuring",
]);

const REPLACED_TAGS = new Set([
  "IMG",
  "SVG",
  "VIDEO",
  "CANVAS",
  "IFRAME",
  "PICTURE",
  "OBJECT",
  "EMBED",
]);
const MAX_TEXT_RECTS = 6;

export function parseCssColor(value: string): Rgba | null {
  const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const alpha = parts[3];
  const a =
    alpha === undefined
      ? 1
      : alpha.endsWith("%")
        ? Number.parseFloat(alpha) / 100
        : Number(alpha);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r, g, b, a };
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Floored so a ratio just under the threshold never displays or compares as a pass.
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.floor(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

export function requiredContrastRatio(
  fontSizePx: number,
  fontWeight: number,
): number {
  const pt = (fontSizePx * 72) / 96;
  return pt >= 18 || (pt >= 14 && fontWeight >= 700) ? 3 : 4.5;
}

function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function styleOf(element: Element, pseudo?: string): CSSStyleDeclaration {
  return element.ownerDocument.defaultView!.getComputedStyle(element, pseudo);
}

function pseudoPaints(element: Element): boolean {
  return ["::before", "::after"].some((pseudo) => {
    const style = styleOf(element, pseudo);
    const content = style.content;
    if (!content || content === "none" || content === "normal") return false;
    const bg = parseCssColor(style.backgroundColor);
    return (
      (bg?.a ?? 1) > 0 ||
      (!!style.backgroundImage && style.backgroundImage !== "none")
    );
  });
}

function blends(style: CSSStyleDeclaration): boolean {
  const set = (value: string | undefined) =>
    !!value && value !== "none" && value !== "normal";
  return (
    set(style.mixBlendMode) ||
    set(style.filter) ||
    set(style.getPropertyValue("backdrop-filter")) ||
    set(style.getPropertyValue("mask-image")) ||
    set(style.getPropertyValue("-webkit-mask-image"))
  );
}

function translucentUpTo(element: Element, canvas: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (Number.parseFloat(styleOf(node).opacity || "1") < 1) return true;
    if (node === canvas) return false;
  }
  return false;
}

function paintsOver(element: Element): boolean {
  if (REPLACED_TAGS.has(element.tagName.toUpperCase())) return true;
  const style = styleOf(element);
  if ((parseCssColor(style.backgroundColor)?.a ?? 1) > 0) return true;
  if (style.backgroundImage && style.backgroundImage !== "none") return true;
  if (pseudoPaints(element)) return true;
  return [...element.childNodes].some(
    (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
  );
}

function samplePoints(element: Element): Array<[number, number]> {
  const range = element.ownerDocument.createRange();
  const rects: DOMRect[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim())
      continue;
    range.selectNodeContents(child);
    rects.push(
      ...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0),
    );
  }
  return rects.slice(0, MAX_TEXT_RECTS).flatMap((rect) => {
    const y = rect.top + rect.height / 2;
    return [0.2, 0.5, 0.8].map((f): [number, number] => [
      rect.left + rect.width * f,
      y,
    ]);
  });
}

/** Opaque background under one point of the text, or null when it is not a flat color. */
function backgroundAt(
  element: Element,
  canvas: Element,
  stack: Element[],
): Rgba | null {
  const index = stack.indexOf(element);
  if (index < 0) return null;
  const above = stack.slice(0, index).filter((layer) => canvas.contains(layer));
  if (above.some(paintsOver)) return null;

  const layers: Rgba[] = [];
  for (const layer of stack.slice(index)) {
    if (!canvas.contains(layer)) return null;
    if (REPLACED_TAGS.has(layer.tagName.toUpperCase())) return null;
    const style = styleOf(layer);
    if (blends(style) || pseudoPaints(layer)) return null;
    if (style.backgroundImage && style.backgroundImage !== "none") return null;
    if (translucentUpTo(layer, canvas)) return null;
    const bg = parseCssColor(style.backgroundColor);
    if (!bg) return null;
    if (bg.a === 0) continue;
    layers.push(bg);
    if (bg.a >= 1) {
      return layers.reduceRight((below, above) => over(above, below));
    }
  }
  return null;
}

/**
 * Measures text contrast from what is actually painted under its glyphs.
 * Returns null unless every sampled point sits on flat colors all the way
 * down to an opaque layer inside the slide, so an unresolvable case stays
 * unverified rather than becoming a guessed pass.
 */
export function measureRenderedContrast(
  element: Element,
  canvas: Element,
  hitTest: HitTest,
): ContrastMeasurement | null {
  if (!canvas.contains(element)) return null;
  const style = styleOf(element);
  const clip =
    style.getPropertyValue("-webkit-background-clip") || style.backgroundClip;
  if (clip === "text" || blends(style) || translucentUpTo(element, canvas))
    return null;
  const fill = parseCssColor(
    style.getPropertyValue("-webkit-text-fill-color") || style.color,
  );
  if (!fill || fill.a === 0) return null;

  const points = samplePoints(element);
  if (points.length === 0) return null;

  const fontSizePx = Number.parseFloat(style.fontSize);
  const fontWeight = Number.parseFloat(style.fontWeight) || 400;
  if (!Number.isFinite(fontSizePx)) return null;
  const requiredRatio = requiredContrastRatio(fontSizePx, fontWeight);

  let worst: { ratio: number; fg: Rgba; bg: Rgba } | null = null;
  for (const [x, y] of points) {
    const bg = backgroundAt(element, canvas, hitTest(x, y));
    if (!bg) return null;
    const fg = over(fill, bg);
    const ratio = contrastRatio(fg, bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, fg, bg };
  }
  if (!worst) return null;

  return {
    foreground: toHex(worst.fg),
    background: toHex(worst.bg),
    ratio: worst.ratio,
    requiredRatio,
    fontSize: `${((fontSizePx * 72) / 96).toFixed(1)}pt (${fontSizePx}px)`,
    fontWeight: String(fontWeight),
  };
}
