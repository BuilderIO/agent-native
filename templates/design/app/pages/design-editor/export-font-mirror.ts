/**
 * html2canvas measures layout inside the preview iframe but paints text with
 * `ctx.font` on a canvas created in the *editor* document, and derives its
 * baseline from a probe element appended to the *editor* body
 * (`CanvasRenderer` -> `document.createElement('canvas')` /
 * `new FontMetrics(document)`).
 *
 * A generated design loads its webfonts inside the preview iframe, so the
 * editor document has usually never heard of them. Every box - background,
 * gradient, underline, shadow, border - is placed from the iframe's real
 * layout, while the glyphs on top are drawn with whatever fallback the editor
 * document resolves. The two disagree, and the decoration reads as "shifted"
 * relative to its text. Measured on a 290px headline: glyphs rendered 18px
 * (6%) narrow and 5px high.
 *
 * Loading the same faces into the document that owns the canvas removes the
 * disagreement at its source, so every raster export (PNG/JPG/WEBP, PDF,
 * Copy as PNG) lines up with the live canvas. The mirrored faces are removed
 * again after the capture so a design's fonts can never restyle editor chrome.
 */

const MIRROR_STYLE_MARKER = "data-agent-native-export-fontface";

export interface MirroredFonts {
  faceCount: number;
  requestedSpecs: number;
  /** Stylesheets whose @font-face rules could not be read or fetched. */
  unreadableStylesheets: string[];
  dispose: () => void;
}

/** Rewrite every `url(...)` in a CSS chunk to an absolute URL. */
export function absolutizeCssUrls(cssText: string, baseUrl: string): string {
  return cssText.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote: string, rawUrl: string) => {
      const url = rawUrl.trim();
      if (!url || /^(?:data|blob|about):/i.test(url)) return match;
      try {
        return `url(${quote}${new URL(url, baseUrl).href}${quote})`;
      } catch {
        return match;
      }
    },
  );
}

/**
 * Pull only `@font-face` blocks out of a stylesheet's text. Everything else is
 * dropped on purpose: this CSS comes from a user-generated design and is about
 * to be injected into the editor's own document, where a stray layout or color
 * rule would restyle the app.
 */
export function extractFontFaceRules(
  cssText: string,
  baseUrl: string,
): string[] {
  const rules: string[] = [];
  const pattern = /@font-face\s*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cssText))) {
    let depth = 1;
    let quote = "";
    let index = match.index + match[0].length;
    while (index < cssText.length && depth > 0) {
      const character = cssText[index]!;
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
      index += 1;
    }
    if (depth !== 0) break;
    rules.push(
      absolutizeCssUrls(cssText.slice(match.index, index).trim(), baseUrl),
    );
    pattern.lastIndex = index;
  }
  return rules;
}

/**
 * The CSS `font` shorthands actually painted in the preview. `fonts.ready`
 * alone is not enough in the editor document: nothing there uses these
 * families, so the faces would stay unloaded and `ctx.font` would still fall
 * back. Each spec has to be requested explicitly.
 */
export function collectUsedFontSpecs(doc: Document): string[] {
  const view = doc.defaultView;
  if (!view) return [];
  const specs = new Set<string>();
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("*"))) {
    const hasText = Array.from(element.childNodes).some(
      (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
    );
    if (!hasText) continue;
    const style = view.getComputedStyle(element);
    const family = style.fontFamily;
    const size = style.fontSize;
    if (!family || !size) continue;
    const weight = style.fontWeight || "400";
    const fontStyle = style.fontStyle || "normal";
    specs.add(`${fontStyle} ${weight} ${size} ${family}`);
  }
  return Array.from(specs);
}

// CSSOM rule type constants; `CSSRule` is not a global outside the browser.
const FONT_FACE_RULE = 5;
const IMPORT_RULE = 3;

interface FontFaceHarvest {
  rules: string[];
  unreadable: string[];
}

/**
 * Walk a rule list for `@font-face`, following `@import` and grouping rules
 * (`@media`, `@supports`, `@layer`). A design that pulls its fonts in with
 * `@import url('https://fonts.googleapis.com/...')` inside a `<style>` block
 * is common, and those faces hang off `CSSImportRule.styleSheet` rather than
 * the top level - collecting only top-level rules mirrored an empty stylesheet
 * and let the raster export fall back to the wrong metrics with nothing
 * reported.
 */
function harvestFontFaceRules(
  rules: readonly CSSRule[],
  baseUrl: string,
  harvest: FontFaceHarvest,
  seen: Set<object>,
): void {
  for (const rule of rules) {
    if (rule.type === FONT_FACE_RULE) {
      harvest.rules.push(absolutizeCssUrls(rule.cssText, baseUrl));
      continue;
    }
    if (rule.type === IMPORT_RULE) {
      const importRule = rule as CSSImportRule;
      let importedBase = baseUrl;
      try {
        importedBase = importRule.href
          ? new URL(importRule.href, baseUrl).href
          : baseUrl;
      } catch {
        importedBase = baseUrl;
      }
      // Reading `.styleSheet` is itself a cross-origin access and can throw,
      // so it has to sit inside the same guard as `.cssRules`. Distinguish
      // "already walked" from "could not read": collapsing them would drop a
      // whole imported sheet with nothing reported.
      let imported: CSSStyleSheet | null = null;
      let nestedRules: CSSRule[] | null = null;
      let alreadyWalked = false;
      try {
        imported = importRule.styleSheet;
        if (imported && seen.has(imported)) {
          alreadyWalked = true;
        } else if (imported) {
          seen.add(imported);
          nestedRules = Array.from(imported.cssRules ?? []);
        }
      } catch {
        nestedRules = null;
      }
      if (nestedRules) {
        harvestFontFaceRules(
          nestedRules,
          imported?.href ?? importedBase,
          harvest,
          seen,
        );
      } else if (!alreadyWalked) {
        harvest.unreadable.push(imported?.href ?? importedBase);
      }
      continue;
    }
    const nested = (rule as CSSGroupingRule).cssRules;
    if (!nested) continue;
    if (seen.has(rule)) continue;
    seen.add(rule);
    harvestFontFaceRules(Array.from(nested), baseUrl, harvest, seen);
  }
}

function collectPreviewFontFaceCss(doc: Document): FontFaceHarvest {
  const harvest: FontFaceHarvest = { rules: [], unreadable: [] };
  const seen = new Set<object>();
  for (const sheet of Array.from(doc.styleSheets)) {
    const base = sheet.href ?? doc.baseURI;
    let cssRules: CSSRule[];
    try {
      cssRules = Array.from((sheet as CSSStyleSheet).cssRules ?? []);
    } catch {
      // Cross-origin stylesheet (Google Fonts is the common case). Its text is
      // still fetchable, so record it for the network pass rather than losing
      // the faces silently.
      if (sheet.href) harvest.unreadable.push(sheet.href);
      continue;
    }
    seen.add(sheet);
    harvestFontFaceRules(cssRules, base, harvest, seen);
  }
  return harvest;
}

async function fetchFontFaceRules(
  href: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(href, { signal });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return extractFontFaceRules(await response.text(), href);
}

/**
 * Load the preview document's webfaces into `targetDoc` (the document that
 * owns the export canvas) and wait for them. A design whose fonts cannot be
 * mirrored still exports, with the pre-existing fallback metrics; which
 * stylesheets were lost is reported in the result rather than swallowed.
 */
export async function mirrorPreviewWebFonts(
  previewDoc: Document,
  targetDoc: Document,
  options?: { timeoutMs?: number },
): Promise<MirroredFonts> {
  const timeoutMs = options?.timeoutMs ?? 4000;
  const { rules, unreadable } = collectPreviewFontFaceCss(previewDoc);
  const failed: string[] = [];

  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const fetchTimer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const fetched = await Promise.all(
    unreadable.map(async (href) => {
      try {
        return await fetchFontFaceRules(href, controller?.signal);
      } catch {
        failed.push(href);
        return [] as string[];
      }
    }),
  );
  if (fetchTimer) clearTimeout(fetchTimer);
  for (const group of fetched) rules.push(...group);

  if (rules.length === 0 || !targetDoc.head) {
    return {
      faceCount: 0,
      requestedSpecs: 0,
      unreadableStylesheets: failed,
      dispose: () => {},
    };
  }

  const style = targetDoc.createElement("style");
  style.setAttribute(MIRROR_STYLE_MARKER, "");
  style.textContent = rules.join("\n");
  targetDoc.head.appendChild(style);
  const dispose = () => style.remove();

  const fontSet = targetDoc.fonts;
  if (!fontSet) {
    return {
      faceCount: rules.length,
      requestedSpecs: 0,
      unreadableStylesheets: failed,
      dispose,
    };
  }

  const specs = collectUsedFontSpecs(previewDoc);
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  await Promise.race([
    Promise.all(specs.map((spec) => fontSet.load(spec).catch(() => undefined)))
      .then(() => fontSet.ready)
      .then(() => undefined),
    deadline,
  ]);

  return {
    faceCount: rules.length,
    requestedSpecs: specs.length,
    unreadableStylesheets: failed,
    dispose,
  };
}
