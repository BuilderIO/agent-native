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
 * Remove CSS comments without touching string literals.
 *
 * The raw scanners below balance braces, and a brace inside a comment throws
 * that off: `@font-face { /* { *\/ src: url(a) }` leaves the scan one level
 * deep, so it runs on and captures the following `body { display: none }` into
 * the block mirrored into the editor document. That is the one thing this
 * module promises never to do, so comments go before anything else looks at
 * the text.
 */
export function stripCssComments(cssText: string): string {
  let output = "";
  let index = 0;
  let quote = "";
  while (index < cssText.length) {
    const character = cssText[index]!;
    if (quote) {
      if (character === "\\" && index + 1 < cssText.length) {
        output += character + cssText[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) quote = "";
      output += character;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    if (cssText.startsWith("/*", index)) {
      const end = cssText.indexOf("*/", index + 2);
      // An unterminated comment runs to the end of the sheet.
      index = end === -1 ? cssText.length : end + 2;
      output += " ";
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

/** Index just past the `}` closing the block whose `{` sits at `openIndex`. */
function findBlockEnd(cssText: string, openIndex: number): number {
  let depth = 1;
  let quote = "";
  let index = openIndex + 1;
  while (index < cssText.length && depth > 0) {
    const character = cssText[index]!;
    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }
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
  return depth === 0 ? index : -1;
}

/**
 * Decides whether a condition (`@media` / `@supports` prelude) held in the
 * preview. Shared by every path so the CSSOM walk, the `@import` gate and the
 * fetched-text scan cannot disagree about which faces the preview painted.
 */
export type ConditionFilter = (
  kind: "media" | "supports",
  condition: string,
) => boolean;

const ALLOW_ALL_CONDITIONS: ConditionFilter = () => true;

/**
 * Pull only `@font-face` blocks out of a stylesheet's text. Everything else is
 * dropped on purpose: this CSS comes from a user-generated design and is about
 * to be injected into the editor's own document, where a stray layout or color
 * rule would restyle the app.
 *
 * Conditional groups are entered only when they applied in the preview. A
 * fetched sheet can carry a print-only or unsupported face, and mirroring it
 * unconditionally would activate in the editor a face the preview never used —
 * the same metric mismatch this module exists to remove.
 */
export function extractFontFaceRules(
  cssText: string,
  baseUrl: string,
  conditionApplies: ConditionFilter = ALLOW_ALL_CONDITIONS,
): string[] {
  const rules: string[] = [];
  const source = stripCssComments(cssText);
  const visit = (start: number, end: number): void => {
    const atRule = /@(font-face|media|supports|layer)\b([^{;]*)([{;])/gi;
    atRule.lastIndex = start;
    let match: RegExpExecArray | null;
    while ((match = atRule.exec(source))) {
      if (match.index >= end) return;
      const [, keyword, prelude, terminator] = match;
      if (terminator === ";") continue;
      const openIndex = match.index + match[0].length - 1;
      const blockEnd = findBlockEnd(source, openIndex);
      // An unterminated block cannot be trusted; stop rather than guess.
      if (blockEnd === -1) return;
      atRule.lastIndex = blockEnd;
      const name = keyword!.toLowerCase();
      if (name === "font-face") {
        rules.push(
          absolutizeCssUrls(
            source.slice(match.index, blockEnd).trim(),
            baseUrl,
          ),
        );
        continue;
      }
      const condition = (prelude ?? "").trim();
      if (
        name === "media" &&
        condition &&
        !conditionApplies("media", condition)
      ) {
        continue;
      }
      if (
        name === "supports" &&
        condition &&
        !conditionApplies("supports", condition)
      ) {
        continue;
      }
      // `@layer` carries no condition, and a matching group is walked inside.
      visit(openIndex + 1, blockEnd - 1);
    }
  };
  visit(0, source.length);
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
 * The text a control paints without owning a text node. html2canvas renders
 * these through `InputElementContainer` / `SelectElementContainer` /
 * `TextareaElementContainer`, reading `.value` (or the selected option's
 * text), so a control with a custom font needs that font requested too.
 */
function paintedControlValue(element: HTMLElement): string {
  const tag = element.tagName;
  if (tag === "INPUT") {
    const input = element as HTMLInputElement;
    if (/^(?:password|hidden)$/i.test(input.type)) return "";
    return input.value || input.placeholder || "";
  }
  if (tag === "TEXTAREA") {
    const textarea = element as HTMLTextAreaElement;
    return textarea.value || textarea.placeholder || "";
  }
  if (tag === "SELECT") {
    const select = element as HTMLSelectElement;
    return select.options[select.selectedIndex]?.text ?? "";
  }
  return "";
}

function directText(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join("");
}

/**
 * Unquote a CSS `content` value so its glyphs can be requested.
 *
 * `attr()` is resolved against the host element rather than dropped. Chromium
 * already substitutes the attribute into the computed value, but engines that
 * leave `attr(data-icon)` unresolved would otherwise contribute no sample at
 * all, so a private-use icon subset would never load for that export.
 * Functions that paint no text of their own are dropped.
 */
function pseudoContentText(content: string, host: Element): string {
  return content
    .trim()
    .replace(
      /attr\(\s*([\w-]+)[^)]*\)/gi,
      (_match, name: string) => host.getAttribute(name) ?? "",
    )
    .replace(/(?:counter|counters|url|image|image-set)\([^)]*\)/gi, "")
    .replace(/["']/g, "");
}

export interface FontRequest {
  /** A CSS `font` shorthand accepted by `FontFaceSet.load`. */
  spec: string;
  /** Representative glyphs painted with that shorthand. */
  text: string;
}

/**
 * `FontFaceSet.load` defaults its sample text to a single space, and only
 * downloads faces whose `unicode-range` covers the sample. An icon face
 * restricted to the private-use area, or a CJK subset that omits U+0020, is
 * therefore never fetched however correctly it was mirrored — html2canvas then
 * paints fallback glyphs anyway. Carry the characters actually painted with
 * each shorthand so the right subsets load.
 */
const MAX_SAMPLE_CHARACTERS = 200;

/**
 * The CSS `font` shorthands actually painted in the preview, each with sample
 * text. `fonts.ready` alone is not enough in the editor document: nothing
 * there uses these families, so the faces would stay unloaded and `ctx.font`
 * would still fall back. Each spec has to be requested explicitly.
 */
export function collectFontRequests(doc: Document): FontRequest[] {
  const view = doc.defaultView;
  if (!view) return [];
  const samples = new Map<string, Set<string>>();
  const record = (spec: string | null, text: string): void => {
    if (!spec) return;
    let sample = samples.get(spec);
    if (!sample) {
      sample = new Set<string>();
      samples.set(spec, sample);
    }
    if (sample.size >= MAX_SAMPLE_CHARACTERS) return;
    for (const character of text) {
      if (sample.size >= MAX_SAMPLE_CHARACTERS) break;
      if (character.trim() === "") continue;
      sample.add(character);
    }
  };

  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("*"))) {
    if (NON_RENDERED_TAGS.has(element.tagName)) continue;
    const ownText = `${directText(element)}${paintedControlValue(element)}`;
    if (ownText.trim() !== "") {
      record(fontSpecFrom(view.getComputedStyle(element)), ownText);
    }
    for (const pseudo of ["::before", "::after"]) {
      let style: CSSStyleDeclaration | null = null;
      try {
        style = view.getComputedStyle(element, pseudo);
      } catch {
        continue;
      }
      if (!style || !pseudoContentIsPainted(style.content)) continue;
      record(fontSpecFrom(style), pseudoContentText(style.content, element));
    }
  }

  return Array.from(samples, ([spec, sample]) => ({
    spec,
    // A space keeps the sample valid when every painted glyph was whitespace.
    text: sample.size > 0 ? Array.from(sample).join("") : " ",
  }));
}

// CSSOM rule type constants; `CSSRule` is not a global outside the browser.
const FONT_FACE_RULE = 5;
const IMPORT_RULE = 3;

interface FontFaceHarvest {
  rules: string[];
  unreadable: string[];
  /** Whether a condition held in the preview; see conditionFilterFor. */
  conditionApplies: ConditionFilter;
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
function conditionFilterFor(view: Window | null): ConditionFilter {
  return (kind, condition) => {
    if (!condition) return true;
    if (kind === "media") {
      if (typeof view?.matchMedia !== "function") return true;
      try {
        return view.matchMedia(condition).matches;
      } catch {
        return true;
      }
    }
    const css = (view as (Window & { CSS?: typeof CSS }) | null)?.CSS;
    if (typeof css?.supports !== "function") return true;
    try {
      return css.supports(condition);
    } catch {
      return true;
    }
  };
}

function groupingRuleAppliesInPreview(
  rule: CSSRule,
  conditionApplies: ConditionFilter,
): boolean {
  const mediaText = (rule as CSSMediaRule).media?.mediaText;
  if (mediaText) return conditionApplies("media", mediaText);
  const conditionText = (rule as CSSSupportsRule).conditionText;
  if (conditionText) return conditionApplies("supports", conditionText);
  // `@layer` and anything else with no condition is always in play.
  return true;
}

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
      // `@import url(print-fonts.css) print` contributes nothing to a screen
      // preview, so following it would mirror faces the preview never used.
      const importMedia = importRule.media?.mediaText;
      if (importMedia && !harvest.conditionApplies("media", importMedia)) {
        continue;
      }
      // `@import` also accepts `supports(...)`, and a face behind a condition
      // the preview could not satisfy was never used to lay it out.
      const importSupports = (
        importRule as CSSImportRule & { supportsText?: string | null }
      ).supportsText;
      if (
        importSupports &&
        !harvest.conditionApplies("supports", importSupports)
      ) {
        continue;
      }
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
    if (!groupingRuleAppliesInPreview(rule, harvest.conditionApplies)) continue;
    harvestFontFaceRules(Array.from(nested), baseUrl, harvest, seen);
  }
}

function collectPreviewFontFaceCss(doc: Document): FontFaceHarvest {
  const harvest: FontFaceHarvest = {
    rules: [],
    unreadable: [],
    conditionApplies: conditionFilterFor(doc.defaultView),
  };
  const seen = new Set<object>();
  for (const sheet of Array.from(doc.styleSheets)) {
    // A sheet the preview never applied must not be mirrored: its faces would
    // become unconditional in the editor document and could win over the face
    // the preview actually laid out with. `<link media="print">` and an
    // unselected alternate stylesheet both sit in `styleSheets` regardless.
    // `media`/`disabled` stay readable cross-origin, unlike `cssRules`, so
    // this also avoids fetching a print-only sheet in the network pass.
    if (sheet.disabled) continue;
    const sheetMedia = sheet.media?.mediaText;
    if (sheetMedia && !harvest.conditionApplies("media", sheetMedia)) continue;
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
 * `@import url("x")` / `@import "x"` targets, resolved to absolute URLs, with
 * the media query an import may carry. A target that will not resolve is
 * returned separately rather than dropped, so the caller can report a sheet it
 * could not follow instead of mirroring a silently incomplete set of faces.
 */
export interface CssImport {
  href: string;
  /** The import's media query, if it declared one. */
  media: string;
  /** The import's `supports()` condition, if it declared one. */
  supports: string;
}

/** Index just past the `)` closing the parenthesis that sits at `openIndex`. */
function findParenEnd(text: string, openIndex: number): number {
  let depth = 1;
  let index = openIndex + 1;
  while (index < text.length && depth > 0) {
    const character = text[index]!;
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    index += 1;
  }
  return depth === 0 ? index : -1;
}

/**
 * Split an `@import` prelude into the conditions that decide whether the
 * preview applied it.
 *
 * `supports()` nests parentheses - `supports((display:grid) or (display:flex))`
 * - so stripping it with `[^)]*` stops at the first `)` and leaves the tail in
 * the media text. The resulting `or (display:flex)) screen` matches nothing,
 * which drops the sheet for the wrong reason and would silently drop a real
 * screen import. Balance the parentheses instead, and keep the condition so it
 * can be evaluated rather than assumed.
 */
export function splitImportPrelude(prelude: string): {
  media: string;
  supports: string;
} {
  let supports = "";
  let rest = "";
  let index = 0;
  const functional = /(supports|layer)\(/gi;
  while (index < prelude.length) {
    functional.lastIndex = index;
    const match = functional.exec(prelude);
    if (!match) {
      rest += prelude.slice(index);
      break;
    }
    rest += prelude.slice(index, match.index);
    const openIndex = match.index + match[0].length - 1;
    const end = findParenEnd(prelude, openIndex);
    // An unterminated condition cannot be read; nothing after it is trustworthy
    // either, so stop rather than guess at a media query.
    if (end === -1) break;
    if (match[1]!.toLowerCase() === "supports") {
      supports = prelude.slice(openIndex + 1, end - 1).trim();
    }
    index = end;
  }
  return { media: rest.replace(/\blayer\b/gi, "").trim(), supports };
}

/** Did an `@import`'s own conditions hold in the preview? */
function importAppliesInPreview(
  entry: CssImport,
  conditionApplies: ConditionFilter,
): boolean {
  if (entry.media && !conditionApplies("media", entry.media)) return false;
  if (entry.supports && !conditionApplies("supports", entry.supports)) {
    return false;
  }
  return true;
}

export function extractImportUrls(
  cssText: string,
  baseUrl: string,
): { urls: CssImport[]; unresolvable: string[] } {
  const urls: CssImport[] = [];
  const unresolvable: string[] = [];
  const pattern =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/gi;
  const source = stripCssComments(cssText);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const raw = (match[2] ?? match[4] ?? "").trim();
    if (!raw) continue;
    // Everything between the target and the `;` is layer()/supports()/media.
    const { media, supports } = splitImportPrelude(match[5] ?? "");
    try {
      urls.push({ href: new URL(raw, baseUrl).href, media, supports });
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
  conditionApplies: ConditionFilter;
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
  const rules = extractFontFaceRules(cssText, href, context.conditionApplies);
  const imports = extractImportUrls(cssText, href);
  context.failed.push(...imports.unresolvable);
  const nested = await Promise.all(
    imports.urls
      .filter((entry) =>
        importAppliesInPreview(entry, context.conditionApplies),
      )
      .map((entry) => fetchFontFaceRulesDeep(entry.href, context, depth + 1)),
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
    conditionApplies: conditionFilterFor(previewDoc.defaultView),
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

  const requests = collectFontRequests(previewDoc);
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, remainingMs());
  });
  await Promise.race([
    Promise.all(
      requests.map((request) =>
        fontSet.load(request.spec, request.text).catch(() => undefined),
      ),
    )
      .then(() => fontSet.ready)
      .then(() => undefined),
    deadline,
  ]);

  return {
    faceCount: rules.length,
    requestedSpecs: requests.length,
    unreadableStylesheets: failed,
    dispose,
  };
}
