import { fail } from "@agent-native/core/action";

function styleInvariant(content: string): string {
  return content
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const protectedStyleProperties = new Set([
  "padding",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap",
  "row-gap",
  "column-gap",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-inline",
  "display",
  "visibility",
  "content",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "word-break",
  "overflow-wrap",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "grid",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "transform",
  "clip",
  "clip-path",
  "text-indent",
  "box-sizing",
  "aspect-ratio",
  "object-fit",
  "object-position",
]);

function protectedStyleInvariant(content: string): string {
  const styleBlocks = Array.from(
    content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
    (match) => match[1] ?? "",
  );
  const inlineStyles = Array.from(
    content.matchAll(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const ruleSignatures: string[] = [];
  for (const stylesheet of styleBlocks) {
    const source = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = protectedCssDeclarations(rule[2]);
      if (declarations.length > 0) {
        ruleSignatures.push(
          `rule:${rule[1].replace(/\s+/g, " ").trim()}{${declarations.join(";")}}`,
        );
      }
    }
  }
  const inlineSignatures: string[] = [];
  let inlineIndex = 0;
  for (const style of inlineStyles) {
    const declarations = protectedCssDeclarations(style);
    if (declarations.length > 0) {
      inlineSignatures.push(`inline:${inlineIndex}{${declarations.join(";")}}`);
      inlineIndex += 1;
    }
  }
  return [...ruleSignatures.sort(), ...inlineSignatures].join("|");
}

function protectedCssDeclarations(style: string): string[] {
  const declarations: string[] = [];
  const source = style.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(
    /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g,
  )) {
    const property = match[1].toLowerCase();
    if (protectedStyleProperties.has(property) || property.startsWith("--")) {
      declarations.push(`${property}:${match[2].replace(/\s+/g, " ").trim()}`);
    }
  }
  return declarations.sort();
}

// A rejection the model cannot act on costs the whole turn here, not one
// retry: "restyle every slide" fans out one update-slide call per slide, so
// every call is already in flight when the first rejection comes back, and the
// framework's across-arguments breaker ends the run before a corrected call is
// ever made. The legacy fields carry everything needed to write the accepted
// call, so echo that call back instead of only naming the rule.
const SUGGESTION_ECHO_LIMIT = 200;

function resendAsEdits(edit: unknown): string {
  return (
    'Resend this exact change as "edits": [' +
    JSON.stringify(edit) +
    "] with styleOnly still true, keeping the same baseContentHash."
  );
}

function styleOnlyGenericSuggestion(): string {
  return (
    'Read the slide first with get-deck (slideId, compact=false), then send one "edits" entry per CSS declaration you are changing, for example: ' +
    // guard:allow-raw-color — sample values inside agent-facing slide HTML, not app theme CSS; slide markup keeps the literal colors it declares.
    '"edits": [{"find":"background:#111111","replace":"background:#f4f0e8","occurrence":1}], passing that read\'s contentHash as baseContentHash.'
  );
}

// objectId swaps an element's INNER content and never touches the opening tag,
// so it cannot move that element's own style attribute — the usual target of a
// style edit. Echoing it back would hand over a call that either misses the
// declaration or trips the style-only structure invariant.
function styleOnlyObjectIdSuggestion(): string {
  return (
    "A style change cannot go through \"objectId\": it replaces only the element's inner content and leaves the element's own style attribute untouched. " +
    styleOnlyGenericSuggestion()
  );
}

export function styleOnlyEditsSuggestion(args: {
  find?: string;
  objectId?: string;
  replace?: string;
}): string {
  if (args.objectId !== undefined) return styleOnlyObjectIdSuggestion();
  const replace = args.replace;
  if (replace === undefined || replace.length > SUGGESTION_ECHO_LIMIT) {
    return styleOnlyGenericSuggestion();
  }
  if (
    args.find !== undefined &&
    args.find.length > 0 &&
    args.find.length <= SUGGESTION_ECHO_LIMIT
  ) {
    // occurrence:1, not expectedMatches:1 — the edits path rejects an ambiguous
    // literal outright, so expectedMatches would turn a legacy call that would
    // have replaced the first match into a second rejection whenever the
    // declaration appears more than once on the slide.
    return resendAsEdits({ find: args.find, replace, occurrence: 1 });
  }
  return styleOnlyGenericSuggestion();
}

export function assertStyleOnlyEdit(
  previousContent: string,
  nextContent: string,
): void {
  if (styleInvariant(previousContent) !== styleInvariant(nextContent)) {
    fail(
      "Style-only slide edits must preserve text, markup, element order, and layout structure; use edits that change only CSS declarations",
      { errorCode: "style_only_slide_structure_changed" },
    );
  }
  if (
    protectedStyleInvariant(previousContent) !==
    protectedStyleInvariant(nextContent)
  ) {
    fail(
      "Style-only slide edits must preserve text, markup, and protected layout CSS; use edits that change only the requested visual CSS declarations",
      { errorCode: "style_only_slide_layout_changed" },
    );
  }
}
