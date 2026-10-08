import { parseFragment, type DefaultTreeAdapterTypes as P5 } from "parse5";

import {
  ALLOWED_TAGS,
  DROP_WITH_CHILDREN,
  isKeptCssProperty,
  sanitizeCssValue,
  sanitizeSlideUrl,
} from "../../app/lib/sanitize-slide-html.js";

// Write-time lint for slide HTML. The agent reads the findings in the action
// result; a finding never blocks the write. Every check is deliberately
// conservative: a false positive teaches the agent to ignore the channel.

export type SlideHygieneCode =
  | "inline-svg"
  | "stripped-element"
  | "stripped-attribute"
  | "stripped-url"
  | "stripped-style"
  | "unwrapped-element"
  | "typed-page-number"
  | "fixed-height-text"
  | "contain-property"
  | "deep-nesting"
  | "stacked-absolute-text"
  | "small-text"
  | "hygiene-lint-failed";

export interface SlideHygieneWarning {
  code: SlideHygieneCode;
  /** `error`: content is lost or renders wrong. `warning`: it works but breaks an authoring rule. */
  severity: "error" | "warning";
  /** What is wrong and the fix, for the agent. */
  message: string;
  /** First offending element, shortened. */
  snippet: string;
  /** Occurrences in the slide (or across the slides of a report). */
  count: number;
}

export interface SlideHygieneReportEntry extends SlideHygieneWarning {
  slideIds: string[];
}

export interface SlideHygieneReport {
  warnings: SlideHygieneReportEntry[];
  /** Entries dropped by the size cap. */
  omitted?: number;
}

interface Finding {
  code: SlideHygieneCode;
  /** Identity across edits, so an edit is only blamed for findings it introduced. */
  key: string;
  snippet: string;
  detail?: string;
}

const MAX_NESTING = 9;
const MAX_REPORT_ENTRIES = 10;
const MAX_SLIDE_IDS = 8;

const SEVERITY: Record<SlideHygieneCode, SlideHygieneWarning["severity"]> = {
  "inline-svg": "error",
  "stripped-element": "error",
  "stripped-attribute": "warning",
  "stripped-url": "error",
  "stripped-style": "error",
  "unwrapped-element": "warning",
  "typed-page-number": "warning",
  "fixed-height-text": "warning",
  "contain-property": "warning",
  "deep-nesting": "warning",
  "stacked-absolute-text": "warning",
  "small-text": "warning",
  "hygiene-lint-failed": "warning",
};

const list = (details: string[]) =>
  [...new Set(details)].slice(0, 6).join(", ");

const MESSAGE: Record<SlideHygieneCode, (details: string[]) => string> = {
  "inline-svg": () =>
    "Inline <svg> is silently removed by the sanitizer and renders as nothing; use an <img> with an https PNG/JPEG/WebP URL, or draw the shape with a styled <div> (border-radius, borders, gradients).",
  "stripped-element": (d) =>
    `The sanitizer removes ${list(d)} and everything inside; slides are static HTML, so use a styled <div> or <a> for buttons and drop scripts, forms and embeds.`,
  "stripped-attribute": (d) =>
    `The sanitizer removes ${list(d)} attributes; slides are static, so delete them and use plain src and href.`,
  "stripped-url": (d) =>
    `The sanitizer removes ${list(d)} because the URL is javascript:, file:, protocol-relative (//host) or a non-image data: URL such as image/svg+xml; use an https:// URL or a PNG/JPEG/WebP data: image.`,
  "stripped-style": (d) =>
    `The sanitizer removes vendor-prefixed properties (-webkit-text-fill-color, -webkit-background-clip, -webkit-line-clamp) and declarations that use url(), expression(), @import or javascript: (${list(d)}), so they have no effect; use a solid color instead of gradient text, an <img> for pictures and CSS colors or gradients for backgrounds.`,
  "unwrapped-element": (d) =>
    `The sanitizer unwraps ${list(d)}, keeping its text but dropping the tag with its class and style; use div, span, section, p or another supported tag for styled content.`,
  "typed-page-number": () =>
    'A typed page number goes stale when slides are inserted or reordered; use <span data-slide-number></span> and <span data-slide-total></span> (add ="pad" for two digits) in the footer.',
  "fixed-height-text": () =>
    "A fixed px height on an element that contains text clips or overflows when the text changes; use min-height (or no height) so the box grows with its text.",
  "contain-property": () =>
    "Do not write `contain` or `contain-intrinsic-size` in slide HTML; remove the declaration.",
  "deep-nesting": (d) =>
    `Nesting reaches ${d[0]} levels (keep it under ${MAX_NESTING + 1}); merge wrapper elements that carry no background, border or text of their own.`,
  "stacked-absolute-text": () =>
    "Several absolutely positioned text elements are stacked over a card background; make the card one painted box (background or border on a single element) that holds its text in normal flow.",
  "small-text": () =>
    "Text under 12px (labels) or under 14px (running copy) is unreadable when presented; use at least 12px for labels and 16px for body copy.",
  "hygiene-lint-failed": (d) =>
    `The hygiene lint could not run on this slide (${list(d)}); no warnings are implied, so check the slide for svg, typed page numbers and fixed heights yourself.`,
};

const INLINE_TAGS = new Set([
  "a",
  "b",
  "br",
  "code",
  "em",
  "i",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);
const SKIP_TEXT_TAGS = new Set(["style", "script", "template"]);
const NO_TEXT_BOX_TAGS = new Set([
  "img",
  "video",
  "source",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "col",
  "colgroup",
  "caption",
]);
const SCALED_FONT_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "small",
  "sub",
  "sup",
]);
/** Parser scaffolding and tags with no rendered box: nothing to unwrap. */
const STRUCTURAL_TAGS = new Set(["html", "head", "body", "title", "template"]);
const URL_ATTRS = ["href", "src", "poster"];

const isElement = (node: P5.Node): node is P5.Element => "tagName" in node;
const isText = (node: P5.Node): node is P5.TextNode =>
  node.nodeName === "#text";

const attr = (el: P5.Element, name: string): string | undefined =>
  el.attrs.find((entry) => entry.name === name)?.value;

function splitDeclarations(style: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quote = "";
  let start = 0;
  const push = (end: number) => {
    const raw = style.slice(start, end);
    const colon = raw.indexOf(":");
    start = end + 1;
    if (colon <= 0) return;
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (name && value) {
      out.set(name.startsWith("--") ? name : name.toLowerCase(), value);
    }
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) push(i);
  }
  push(style.length);
  return out;
}

/** Absolute lengths only; `rem`/`em` count (at 16px) for boxes, never for font sizes, which they scale. */
function lengthPx(
  value: string | undefined,
  units: "box" | "font" = "box",
): number | null {
  const match = /^(\d+(?:\.\d+)?)(px|pt|rem|em)$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "px") return n;
  if (unit === "pt") return n * (4 / 3);
  return units === "box" ? n * 16 : null;
}

const trunc = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

function textOf(node: P5.Node): string {
  if (isText(node)) return node.value;
  if (!isElement(node) || SKIP_TEXT_TAGS.has(node.tagName)) return "";
  return node.childNodes.map(textOf).join("");
}

function ownText(el: P5.Element): string {
  return el.childNodes
    .filter(isText)
    .map((node) => node.value)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function snippetOf(el: P5.Element): string {
  const cls = attr(el, "class");
  const style = attr(el, "style");
  const text = textOf(el).replace(/\s+/g, " ").trim();
  return (
    `<${el.tagName}${cls ? ` class="${trunc(cls, 40)}"` : ""}${
      style ? ` style="${trunc(style.replace(/\s+/g, " "), 70)}"` : ""
    }>` + (text ? trunc(text, 40) : "")
  );
}

const keyOf = (code: string, el: P5.Element, detail = "") =>
  `${code}|${el.tagName}|${detail}|${textOf(el).replace(/\s+/g, " ").trim().slice(0, 30)}`;

const NO_FILL = /^(?:none|transparent|initial|inherit|unset)\b/i;

/** A card background: a solid fill or shadow. Borders and gradients also paint chart plots and table rows. */
const isCardFill = (decl: Map<string, string>) =>
  [...decl].some(
    ([name, value]) =>
      (name === "box-shadow" ||
        name === "background" ||
        name === "background-color") &&
      !NO_FILL.test(value) &&
      !/gradient\(|url\(/i.test(value),
  );

/** Offsets in plain px: stacked labels. `%` and `calc()` offsets belong to a chart or timeline. */
const isPixelPlaced = (decl: Map<string, string>) =>
  ["top", "right", "bottom", "left"]
    .map((side) => decl.get(side))
    .filter((value) => value !== undefined)
    .every((value) => /^-?\d+(?:\.\d+)?(?:px)?$/.test(value!));

function containsTag(el: P5.Element, tag: string): boolean {
  return el.childNodes.some(
    (child) =>
      isElement(child) && (child.tagName === tag || containsTag(child, tag)),
  );
}

/** Axis labels over a chart: the card holds an image, a table or absolutely placed shapes with no text of their own. */
function isChartLike(el: P5.Element): boolean {
  return el.childNodes.some((child) => {
    if (!isElement(child)) return false;
    if (child.tagName === "img" || child.tagName === "table") return true;
    const drawn =
      splitDeclarations(attr(child, "style") ?? "").get("position") ===
        "absolute" && !textOf(child).trim();
    return drawn || isChartLike(child);
  });
}

/** Cards this tall are plot areas or panels, not a stat tile with a caption. */
const MAX_STACKED_CARD_HEIGHT = 160;

const PAGE_NUMBER_TEXT =
  /^(?:(?:page|slide)\s+)?\d{1,3}(?:\s*(?:\/|of)\s*\d{1,3})?$|^\d{1,3}\s*(?:\/|of)$|^(?:\/|of)\s*\d{1,3}$/i;
/** Spaced, zero-padded `04 / 12` is a page number wherever it sits (running heads included); unspaced `03/15` is a date. */
const PADDED_PAGE_NUMBER = /^0(\d)\s+\/\s+(\d{2})$/;
const isPaddedPageNumber = (text: string) => {
  const match = PADDED_PAGE_NUMBER.exec(text);
  return match !== null && Number(match[1]) <= Number(match[2]);
};
const FOOTER_NAME =
  /\bfooter\b|page-?n(?:um|o)|slide-?n(?:um|o)|pagination|pager/i;

function isFooterLooking(el: P5.Element, decl: Map<string, string>): boolean {
  if (el.tagName === "footer") return true;
  if (FOOTER_NAME.test(`${attr(el, "class") ?? ""} ${attr(el, "id") ?? ""}`)) {
    return true;
  }
  // A bottom-edge block is a footer only when it is nothing but the number.
  const position = decl.get("position");
  const bottom = lengthPx(decl.get("bottom"));
  return (
    (position === "absolute" || position === "fixed") &&
    bottom !== null &&
    bottom <= 48 &&
    PAGE_NUMBER_TEXT.test(textOf(el).trim())
  );
}

/** A list marker or footnote reference is content, not a page number. */
const NUMBER_CONTENT_TAGS = new Set(["sup", "li"]);

const isToken = (el: P5.Element) =>
  attr(el, "data-slide-number") !== undefined ||
  attr(el, "data-slide-total") !== undefined;

interface Walk {
  painted: P5.Element | null;
  freeform: boolean;
  footer: boolean;
  inToken: boolean;
  /** px, or null when the inherited size is not a plain px value. */
  fontPx: number | null;
  depth: number;
}

function collect(html: string): Finding[] {
  const findings: Finding[] = [];
  const add = (
    code: SlideHygieneCode,
    key: string,
    snippet: string,
    detail?: string,
  ) => findings.push({ code, key, snippet, detail });
  const root = parseFragment(html, { scriptingEnabled: false });

  let importedSource = false;
  const scan = (node: P5.ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (
        /\bfmd-slide\b/.test(attr(child, "class") ?? "") &&
        (attr(child, "data-imported-pptx") === "true" ||
          attr(child, "data-imported-pdf") === "true")
      ) {
        importedSource = true;
      }
      scan(child);
    }
  };
  scan(root);

  const absoluteText = new Map<P5.Element, number>();
  let deepest: { depth: number; el: P5.Element } | null = null;

  const visit = (parent: P5.ParentNode, walk: Walk) => {
    for (const el of parent.childNodes) {
      if (isText(el)) {
        const text = el.value.trim();
        if (
          !walk.inToken &&
          isElement(parent) &&
          !NUMBER_CONTENT_TAGS.has(parent.tagName) &&
          textOf(parent).trim() === text &&
          ((walk.footer && PAGE_NUMBER_TEXT.test(text)) ||
            isPaddedPageNumber(text))
        ) {
          add(
            "typed-page-number",
            `typed-page-number||${text}`,
            `"${trunc(text, 20)}"`,
          );
        }
        continue;
      }
      if (!isElement(el)) continue;
      const tag = el.tagName;

      if (tag === "svg") {
        add(
          "inline-svg",
          keyOf("inline-svg", el),
          `<svg> (${attr(el, "viewBox") ? `viewBox ${attr(el, "viewBox")}` : "inline"})`,
        );
        continue;
      }
      if (DROP_WITH_CHILDREN.has(tag)) {
        add(
          "stripped-element",
          keyOf("stripped-element", el),
          snippetOf(el),
          `<${tag}>`,
        );
        continue;
      }

      const decl = splitDeclarations(attr(el, "style") ?? "");

      for (const { name } of el.attrs) {
        if (name.startsWith("on") || name === "srcdoc" || name === "srcset") {
          add(
            "stripped-attribute",
            keyOf("stripped-attribute", el, name),
            snippetOf(el),
            name,
          );
        }
      }
      for (const name of URL_ATTRS) {
        const value = attr(el, name);
        if (value === undefined || !value.trim()) continue;
        const kind =
          name === "poster" || tag === "img"
            ? "image"
            : tag === "video" || tag === "source"
              ? "media"
              : "link";
        if (sanitizeSlideUrl(value, kind) === null) {
          add(
            "stripped-url",
            keyOf("stripped-url", el, `${name}=${value.slice(0, 40)}`),
            snippetOf(el),
            `<${tag} ${name}="${trunc(value, 30)}">`,
          );
        }
      }
      for (const [property, value] of decl) {
        if (!isKeptCssProperty(property) || sanitizeCssValue(value) === null) {
          add(
            "stripped-style",
            keyOf("stripped-style", el, property),
            snippetOf(el),
            property,
          );
        }
        if (
          property === "contain" ||
          property.startsWith("contain-intrinsic")
        ) {
          if (!/^(?:none|normal)$/i.test(value)) {
            add(
              "contain-property",
              keyOf("contain-property", el, property),
              snippetOf(el),
              property,
            );
          }
        }
      }

      if (tag === "style") {
        const css = el.childNodes
          .filter(isText)
          .map((node) => node.value)
          .join("");
        if (/@import/i.test(css)) {
          add(
            "stripped-style",
            "stripped-style||@import",
            "<style> @import",
            "@import",
          );
        }
        for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          if (rule[1].trim().startsWith("@")) continue;
          for (const [property, value] of splitDeclarations(rule[2])) {
            if (
              !isKeptCssProperty(property) ||
              sanitizeCssValue(value) === null
            ) {
              add(
                "stripped-style",
                `stripped-style|style-block|${rule[1].trim()}|${property}`,
                `${trunc(rule[1].trim(), 50)} { ${property}: … }`,
                property,
              );
            }
            if (
              (property === "contain" ||
                property.startsWith("contain-intrinsic")) &&
              !/^(?:none|normal)$/i.test(value)
            ) {
              add(
                "contain-property",
                `contain-property|style-block|${rule[1].trim()}|${property}`,
                `${trunc(rule[1].trim(), 50)} { ${property}: … }`,
                property,
              );
            }
          }
        }
        continue;
      }

      if (
        !ALLOWED_TAGS.has(tag) &&
        !STRUCTURAL_TAGS.has(tag) &&
        !DROP_WITH_CHILDREN.has(tag)
      ) {
        add(
          "unwrapped-element",
          keyOf("unwrapped-element", el),
          snippetOf(el),
          `<${tag}>`,
        );
      }

      const next: Walk = {
        ...walk,
        depth: INLINE_TAGS.has(tag) ? walk.depth : walk.depth + 1,
      };
      if (!deepest || next.depth > deepest.depth) {
        deepest = { depth: next.depth, el };
      }
      if (attr(el, "data-slide-object-id") !== undefined) next.freeform = true;
      if (isToken(el)) next.inToken = true;
      if (isFooterLooking(el, decl)) next.footer = true;

      const ownFont = decl.get("font-size");
      if (ownFont !== undefined) next.fontPx = lengthPx(ownFont, "font");
      else if (SCALED_FONT_TAGS.has(tag)) next.fontPx = null;

      const isRoot = /\bfmd-slide\b/.test(attr(el, "class") ?? "");
      const own = ownText(el);
      const hasText = /[\p{L}\p{N}]/u.test(own);

      if (!importedSource) {
        if (
          hasText &&
          next.fontPx !== null &&
          ((next.fontPx < 12 && own.length >= 2) ||
            (next.fontPx < 14 && own.length >= 60))
        ) {
          add(
            "small-text",
            keyOf("small-text", el, String(next.fontPx)),
            snippetOf(el),
            `${next.fontPx}px`,
          );
        }

        const height = lengthPx(decl.get("height"));
        if (height !== null && height > 0 && !next.freeform && !isRoot) {
          const text = textOf(el).replace(/\s+/g, " ").trim();
          const absoluteChild = el.childNodes.some(
            (child) =>
              isElement(child) &&
              /^(?:absolute|fixed)$/.test(
                splitDeclarations(attr(child, "style") ?? "").get("position") ??
                  "",
              ),
          );
          const cls = attr(el, "class") ?? "";
          const exempt =
            NO_TEXT_BOX_TAGS.has(tag) ||
            attr(el, "aria-hidden") === "true" ||
            /fmd-img-placeholder|fmd-pptx|fmd-layout-spacer/.test(cls) ||
            attr(el, "data-pptx-element-kind") !== undefined ||
            decl.has("line-clamp") ||
            absoluteChild ||
            (decl.get("position") === "absolute" &&
              lengthPx(decl.get("width")) !== null) ||
            text.length <= 3 ||
            (text.length <= 24 && height <= 64) ||
            (text.length <= 12 && lengthPx(decl.get("width")) !== null) ||
            containsTag(el, "img");
          if (!exempt) {
            add(
              "fixed-height-text",
              keyOf("fixed-height-text", el, decl.get("height")),
              snippetOf(el),
              `height: ${decl.get("height")}`,
            );
          }
        }

        if (
          !next.freeform &&
          decl.get("position") === "absolute" &&
          hasText &&
          walk.painted &&
          isPixelPlaced(decl)
        ) {
          absoluteText.set(
            walk.painted,
            (absoluteText.get(walk.painted) ?? 0) + 1,
          );
        }
      }

      next.painted = !isRoot && isCardFill(decl) ? el : walk.painted;
      visit(el, next);
    }
  };
  visit(root, {
    painted: null,
    freeform: false,
    footer: false,
    inToken: false,
    fontPx: null,
    depth: 0,
  });

  if (!importedSource) {
    for (const [card, count] of absoluteText) {
      const height = lengthPx(
        splitDeclarations(attr(card, "style") ?? "").get("height"),
      );
      if (
        count >= 2 &&
        !isChartLike(card) &&
        (height === null || height <= MAX_STACKED_CARD_HEIGHT)
      ) {
        add(
          "stacked-absolute-text",
          keyOf("stacked-absolute-text", card),
          snippetOf(card),
          String(count),
        );
      }
    }
    const top = deepest as { depth: number; el: P5.Element } | null;
    if (top && top.depth > MAX_NESTING) {
      add("deep-nesting", "deep-nesting", snippetOf(top.el), String(top.depth));
    }
  }
  return findings;
}

/**
 * Warnings for one slide, grouped by code. With `previousHtml` only findings the
 * edit introduced are reported, so a slide that already had a problem is not
 * blamed on every later touch.
 */
export function lintSlideHtml(
  html: string,
  opts?: { previousHtml?: string },
): SlideHygieneWarning[] {
  let findings = collect(html);
  if (opts?.previousHtml !== undefined && opts.previousHtml !== html) {
    const seen = new Map<string, number>();
    for (const finding of collect(opts.previousHtml)) {
      seen.set(finding.key, (seen.get(finding.key) ?? 0) + 1);
    }
    findings = findings.filter((finding) => {
      const left = seen.get(finding.key) ?? 0;
      if (left <= 0) return true;
      seen.set(finding.key, left - 1);
      return false;
    });
  } else if (opts?.previousHtml === html) {
    findings = [];
  }

  const groups = new Map<SlideHygieneCode, Finding[]>();
  for (const finding of findings) {
    groups.set(finding.code, [...(groups.get(finding.code) ?? []), finding]);
  }
  return [...groups].map(([code, group]) => ({
    code,
    severity: SEVERITY[code],
    message: MESSAGE[code](group.map((finding) => finding.detail ?? "")),
    snippet: group[0].snippet,
    count: group.length,
  }));
}

/**
 * The `hygieneWarnings` field for an action result: warnings of all the written
 * slides, one entry per code with the slides that have it, errors first and
 * capped. `undefined` when there is nothing to say, so clean writes keep their
 * result shape.
 */
export function slideHygieneReport(
  slides: ReadonlyArray<{
    slideId: string;
    html: string;
    previousHtml?: string;
  }>,
): SlideHygieneReport | undefined {
  const entries = new Map<SlideHygieneCode, SlideHygieneReportEntry>();
  for (const { slideId, html, previousHtml } of slides) {
    let warnings: SlideHygieneWarning[];
    try {
      warnings = lintSlideHtml(html, { previousHtml });
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown_error";
      warnings = [
        {
          code: "hygiene-lint-failed",
          severity: SEVERITY["hygiene-lint-failed"],
          message: MESSAGE["hygiene-lint-failed"]([name]),
          snippet: name,
          count: 1,
        },
      ];
    }
    for (const warning of warnings) {
      const entry = entries.get(warning.code);
      if (!entry) {
        entries.set(warning.code, { ...warning, slideIds: [slideId] });
        continue;
      }
      entry.count += warning.count;
      if (entry.slideIds.length < MAX_SLIDE_IDS) entry.slideIds.push(slideId);
    }
  }
  if (entries.size === 0) return undefined;
  const sorted = [...entries.values()].sort(
    (a, b) =>
      Number(b.severity === "error") - Number(a.severity === "error") ||
      b.count - a.count,
  );
  const omitted = sorted.length - MAX_REPORT_ENTRIES;
  return {
    warnings: sorted.slice(0, MAX_REPORT_ENTRIES),
    ...(omitted > 0 ? { omitted } : {}),
  };
}

/** Spread into an action result: `{ hygieneWarnings }` or nothing. */
export function slideHygieneResult(
  slides: Parameters<typeof slideHygieneReport>[0],
): { hygieneWarnings?: SlideHygieneReport } {
  const hygieneWarnings = slideHygieneReport(slides);
  return hygieneWarnings ? { hygieneWarnings } : {};
}

/** Appended to the description of every action that returns `hygieneWarnings`. */
export const HYGIENE_ACTION_DESCRIPTION =
  " The result may include `hygieneWarnings` (never blocks the write): problems this write introduced in the slide HTML, one entry per code with its slideIds, such as inline svg or other markup the sanitizer silently removes, typed page numbers, fixed px heights on text, and tiny text. Fix them with update-slide before finishing; a missing field means the lint found nothing.";
