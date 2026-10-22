// Slide-number tokens: `<span data-slide-number></span>` and
// `<span data-slide-total></span>` (value `pad` for two digits, `04 / 08`).
// The saved HTML only ever holds the empty tokens; digits come from CSS
// counters seeded on the slide's canvas root, so reordering, inserting or
// deleting a slide never leaves a stale footer behind. Substituting digits into
// the live DOM instead would be serialized straight back into the slide by the
// editor and the in-place text session.

/** 1-based position of a slide in the sequence the surface renders. */
export interface SlidePosition {
  number: number;
  count: number;
}

const NUMBER_ATTR = "data-slide-number";
const TOTAL_ATTR = "data-slide-total";
const INDEX_ATTR = "data-slide-index";
const COUNT_ATTR = "data-slide-count";

/** Attributes for a slide canvas root. `data-slide-count` gates the CSS: an unset counter renders `0`. */
export function slideNumberRootAttrs(
  position: SlidePosition | undefined,
): Record<string, number> {
  if (!position) return {};
  return {
    [INDEX_ATTR]: position.number,
    [COUNT_ATTR]: position.count,
  };
}

/** Custom properties the counter rule reads; a React style object or `slideNumberInlineStyle`. */
export function slideNumberRootVars(
  position: SlidePosition | undefined,
): Record<string, number> {
  if (!position) return {};
  return {
    "--slide-index": position.number,
    "--slide-count": position.count,
  };
}

export function slideNumberInlineStyle(
  position: SlidePosition | undefined,
): string {
  return Object.entries(slideNumberRootVars(position))
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}

// Twin of the rules in app/global.css (slide-number.test.ts keeps them equal);
// the standalone HTML export has no access to the app stylesheet.
export const SLIDE_NUMBER_CSS = `[data-slide-count] {
  counter-set: slide-number var(--slide-index) slide-total var(--slide-count);
}
[data-slide-count] [data-slide-number]::before {
  content: counter(slide-number);
}
[data-slide-count] [data-slide-number="pad"]::before {
  content: counter(slide-number, decimal-leading-zero);
}
[data-slide-count] [data-slide-total]::before {
  content: counter(slide-total);
}
[data-slide-count] [data-slide-total="pad"]::before {
  content: counter(slide-total, decimal-leading-zero);
}`;

function tokenText(value: number, padAttr: string | null): string {
  const text = String(value);
  return padAttr === "pad" ? text.padStart(2, "0") : text;
}

/**
 * Writes digits into the tokens under a slide canvas root. Only for throwaway
 * export clones: exporters such as dom-to-pptx read DOM text and cannot see
 * pseudo-element content. The position attributes come off the root afterwards
 * so the counter rules no longer match and the pseudo-element cannot add the
 * digits a second time. A root with no position (a deck-less surface) is left
 * with empty tokens, matching what the CSS renders there.
 */
export function materializeSlideNumberTokens(root: HTMLElement): void {
  const number = positionAttr(root, INDEX_ATTR);
  const count = positionAttr(root, COUNT_ATTR);
  if (number === null || count === null) return;
  for (const token of root.querySelectorAll<HTMLElement>(
    `[${NUMBER_ATTR}],[${TOTAL_ATTR}]`,
  )) {
    const attr = token.hasAttribute(NUMBER_ATTR) ? NUMBER_ATTR : TOTAL_ATTR;
    token.textContent = tokenText(
      attr === NUMBER_ATTR ? number : count,
      token.getAttribute(attr),
    );
  }
  root.removeAttribute(INDEX_ATTR);
  root.removeAttribute(COUNT_ATTR);
}

const EMPTY_TOKEN_RE =
  /(<([a-z][a-z0-9]*)\b[^>]*\sdata-slide-(number|total)\b(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?[^>]*>)(<\/\2>)/gi;

/**
 * Fills empty tokens in saved slide HTML for server-side exports that have no
 * DOM and no stylesheet to render the counters.
 */
export function fillSlideNumberTokensInHtml(
  html: string,
  position: SlidePosition,
): string {
  return html.replace(
    EMPTY_TOKEN_RE,
    (_match, open, _tag, kind, dq, sq, bare, close) =>
      `${open}${tokenText(
        kind.toLowerCase() === "number" ? position.number : position.count,
        dq ?? sq ?? bare ?? null,
      )}${close}`,
  );
}

function positionAttr(root: HTMLElement, name: string): number | null {
  const raw = root.getAttribute(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}
