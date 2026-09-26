
const MIRROR_STYLE_MARKER = "data-agent-native-export-fontface";

export interface MirroredFonts {
  faceCount: number;
  requestedSpecs: number;
  unreadableStylesheets: string[];
  dispose: () => void;
}

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
      index = end === -1 ? cssText.length : end + 2;
      output += " ";
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

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
      visit(openIndex + 1, blockEnd - 1);
    }
  };
  visit(0, source.length);
  return rules;
}

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

function paintedControlValue(element: HTMLElement): string {
  const tag = element.tagName;
  if (tag === "INPUT") {
    const input = element as HTMLInputElement;
    if (input.type === "hidden" || (input.type === "password" && input.value)) {
      return "";
    }
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

export function getHtml2CanvasPlaceholderStyle(
  element: Element,
  view: Window,
): CSSStyleDeclaration | null {
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (input.type === "hidden" || input.value || !input.placeholder)
      return null;
  } else if (element.tagName === "TEXTAREA") {
    const textarea = element as HTMLTextAreaElement;
    if (textarea.value || !textarea.placeholder) return null;
  } else {
    return null;
  }

  return view.getComputedStyle(element, "::placeholder");
}

function directText(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join("");
}

function pseudoContentText(content: string): string {
  return content
    .trim()
    .replace(/^(?:attr|counter|counters|url|image)\([^)]*\)/gi, "")
    .replace(/["']/g, "");
}

export interface FontRequest {
  spec: string;
  text: string;
}

const MAX_SAMPLE_CHARACTERS = 200;

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
      record(
        fontSpecFrom(
          getHtml2CanvasPlaceholderStyle(element, view) ??
            view.getComputedStyle(element),
        ),
        ownText,
      );
    }
    for (const pseudo of ["::before", "::after"]) {
      let style: CSSStyleDeclaration | null = null;
      try {
        style = view.getComputedStyle(element, pseudo);
      } catch {
        continue;
      }
      if (!style || !pseudoContentIsPainted(style.content)) continue;
      record(fontSpecFrom(style), pseudoContentText(style.content));
    }
  }

  return Array.from(samples, ([spec, sample]) => ({
    spec,
    text: sample.size > 0 ? Array.from(sample).join("") : " ",
  }));
}

const FONT_FACE_RULE = 5;
const IMPORT_RULE = 3;

interface FontFaceHarvest {
  rules: string[];
  unreadable: string[];
  conditionApplies: ConditionFilter;
}

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
      const importMedia = importRule.media?.mediaText;
      if (importMedia && !harvest.conditionApplies("media", importMedia)) {
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
    const base = sheet.href ?? doc.baseURI;
    let cssRules: CSSRule[];
    try {
      cssRules = Array.from((sheet as CSSStyleSheet).cssRules ?? []);
    } catch {
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
  media: string;
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
    const media = (match[5] ?? "")
      .replace(/\b(?:layer|supports)\([^)]*\)/gi, "")
      .replace(/\blayer\b/gi, "")
      .trim();
    try {
      urls.push({ href: new URL(raw, baseUrl).href, media });
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
      .filter(
        (entry) =>
          !entry.media || context.conditionApplies("media", entry.media),
      )
      .map((entry) => fetchFontFaceRulesDeep(entry.href, context, depth + 1)),
  );
  for (const group of nested) rules.push(...group);
  context.resolved.add(href);
  return rules;
}

export async function mirrorPreviewWebFonts(
  previewDoc: Document,
  targetDoc: Document,
  options?: { timeoutMs?: number },
): Promise<MirroredFonts> {
  const timeoutMs = options?.timeoutMs ?? 4000;
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
