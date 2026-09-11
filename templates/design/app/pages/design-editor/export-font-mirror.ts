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

/** Elements that hold text nodes but paint nothing. */
const NON_RENDERED_TAGS = new Set([
  "STYLE",
  "SCRIPT",
  "TITLE",
  "META",
  "LINK",
  "HEAD",
  "NOSCRIPT",
  "TEMPLATE",
]);

/**
 * html2canvas resolves `::before` / `::after` into real painted elements
 * (`DocumentCloner.resolvePseudoContent`), so their fonts need requesting too.
 * An icon `<i class="icon"></i>` carries no direct text at all, so without
 * this its family was never requested and the glyph rasterized as fallback.
 */
function pseudoContentIsPainted(content: string | null | undefined): boolean {
  if (!content) return false;
  const value = content.trim();
  return value !== "" && value !== "none" && value !== "normal";
}

function fontSpecFrom(style: CSSStyleDeclaration): string | null {
  const family = style.fontFamily;
  const size = style.fontSize;
  if (!family || !size) return null;
  const weight = style.fontWeight || "400";
  const fontStyle = style.fontStyle || "normal";
  return `${fontStyle} ${weight} ${size} ${family}`;
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
    if (NON_RENDERED_TAGS.has(element.tagName)) continue;
    const hasText = Array.from(element.childNodes).some(
      (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
    );
    if (hasText) {
      const spec = fontSpecFrom(view.getComputedStyle(element));
      if (spec) specs.add(spec);
    }
    for (const pseudo of ["::before", "::after"]) {
      let style: CSSStyleDeclaration | null = null;
      try {
        style = view.getComputedStyle(element, pseudo);
      } catch {
        continue;
      }
      if (!pseudoContentIsPainted(style?.content)) continue;
      const spec = style ? fontSpecFrom(style) : null;
      if (spec) specs.add(spec);
    }
  }
  return Array.from(specs);
}

// CSSOM rule type constants; `CSSRule` is not a global outside the browser.
const FONT_FACE_RULE = 5;
const IMPORT_RULE = 3;

interface FontFaceHarvest {
  rules: string[];
  unreadable: string[];
  /** Preview window, used to evaluate grouping conditions where they apply. */
  view: Window | null;
}

/**
 * Does a grouping rule (`@media`, `@supports`, `@layer`) apply in the preview?
 *
 * Faces are mirrored unconditionally, so a face nested in a non-matching
 * `@media` would become active in the editor document while the preview laid
 * out without it - the same metric mismatch this module exists to remove, just
 * inverted. Re-emitting the condition instead would be worse: it would be
 * evaluated against the editor window, whose width and features differ from
 * the artboard-sized preview iframe. Resolve the question where the layout
 * actually happened, then emit the survivors unconditionally.
 *
 * An unevaluable condition keeps the face: a spurious extra face costs a font
 * request, a missing one silently restores the fallback-metrics bug.
 */
function groupingRuleAppliesInPreview(
  rule: CSSRule,
  view: Window | null,
): boolean {
  const mediaText = (rule as CSSMediaRule).media?.mediaText;
  if (mediaText) {
    if (typeof view?.matchMedia !== "function") return true;
    try {
      return view.matchMedia(mediaText).matches;
    } catch {
      return true;
    }
  }
  const conditionText = (rule as CSSSupportsRule).conditionText;
  if (conditionText) {
    const css = (view as (Window & { CSS?: typeof CSS }) | null)?.CSS;
    if (typeof css?.supports !== "function") return true;
    try {
      return css.supports(conditionText);
    } catch {
      return true;
    }
  }
  // `@layer` and anything else with no condition is always in play.
  return true;
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
    if (!groupingRuleAppliesInPreview(rule, harvest.view)) continue;
    harvestFontFaceRules(Array.from(nested), baseUrl, harvest, seen);
  }
}

function collectPreviewFontFaceCss(doc: Document): FontFaceHarvest {
  const harvest: FontFaceHarvest = {
    rules: [],
    unreadable: [],
    view: doc.defaultView,
  };
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

/**
 * `@import url("x")` / `@import "x"` targets, resolved to absolute URLs.
 * A target that will not resolve is returned separately rather than dropped,
 * so the caller can report a sheet it could not follow instead of mirroring
 * a silently incomplete set of faces.
 */
export function extractImportUrls(
  cssText: string,
  baseUrl: string,
): { urls: string[]; unresolvable: string[] } {
  const urls: string[] = [];
  const unresolvable: string[] = [];
  const pattern =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cssText))) {
    const raw = (match[2] ?? match[4] ?? "").trim();
    if (!raw) continue;
    try {
      urls.push(new URL(raw, baseUrl).href);
    } catch {
      unresolvable.push(raw);
    }
  }
  return { urls, unresolvable };
}

/**
 * A fetched stylesheet can itself `@import` the sheet holding the faces, so
 * stopping at direct `@font-face` blocks dropped them with nothing reported.
 * Bounded so a cyclic or deeply chained import cannot stall an export.
 */
const MAX_FETCHED_IMPORT_DEPTH = 3;

interface FetchContext {
  failed: string[];
  visited: Set<string>;
  /** Sheets that produced an answer, so a timeout cannot look like success. */
  resolved: Set<string>;
  signal?: AbortSignal;
  remainingMs: () => number;
}

async function fetchFontFaceRulesDeep(
  href: string,
  context: FetchContext,
  depth = 0,
): Promise<string[]> {
  if (context.visited.has(href)) return [];
  context.visited.add(href);
  if (depth > MAX_FETCHED_IMPORT_DEPTH || context.remainingMs() <= 0) {
    context.failed.push(href);
    context.resolved.add(href);
    return [];
  }
  let cssText: string;
  try {
    const response = await fetch(href, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    cssText = await response.text();
  } catch {
    context.failed.push(href);
    context.resolved.add(href);
    return [];
  }
  const rules = extractFontFaceRules(cssText, href);
  const imports = extractImportUrls(cssText, href);
  context.failed.push(...imports.unresolvable);
  const nested = await Promise.all(
    imports.urls.map((importHref) =>
      fetchFontFaceRulesDeep(importHref, context, depth + 1),
    ),
  );
  for (const group of nested) rules.push(...group);
  context.resolved.add(href);
  return rules;
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
  // One budget for the whole operation. Fetching and font loading used to get
  // a full window each, so a slow stylesheet followed by slow fonts could add
  // roughly double the intended delay to an export that is already waiting on
  // waitForExportReady.
  const deadlineAt = Date.now() + timeoutMs;
  const remainingMs = () => Math.max(0, deadlineAt - Date.now());
  const { rules, unreadable } = collectPreviewFontFaceCss(previewDoc);
  const failed: string[] = [];

  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const fetchTimer = controller
    ? setTimeout(() => controller.abort(), remainingMs())
    : null;
  const fetchContext: FetchContext = {
    failed,
    visited: new Set<string>(),
    resolved: new Set<string>(),
    signal: controller?.signal,
    remainingMs,
  };
  // Abort only asks nicely; a fetch implementation that ignores the signal
  // would otherwise hang the export forever. The deadline has to bound the
  // phase itself, not just the request.
  const fetched = await Promise.race([
    Promise.all(
      unreadable.map((href) => fetchFontFaceRulesDeep(href, fetchContext)),
    ),
    new Promise<string[][]>((resolve) => {
      setTimeout(() => resolve([]), remainingMs());
    }),
  ]);
  if (fetchTimer) clearTimeout(fetchTimer);
  for (const group of fetched) rules.push(...group);
  // A sheet the timeout cut short is neither mirrored nor yet reported.
  for (const href of unreadable) {
    if (!fetchContext.resolved.has(href) && !failed.includes(href)) {
      failed.push(href);
    }
  }

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
    setTimeout(resolve, remainingMs());
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
