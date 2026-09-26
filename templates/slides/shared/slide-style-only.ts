import { fail } from "@agent-native/core/action";
import { parseHTML } from "linkedom/worker";
import postcss from "postcss";

function parseSlideHtml(content: string): Element {
  const { document } = parseHTML("<html><body></body></html>");
  const container = document.createElement("div");
  container.innerHTML = content;
  return container;
}

function styleInvariant(content: string): string {
  const container = parseSlideHtml(content);
  const serialize = (node: Node): unknown => {
    if (node.nodeType !== 1) {
      return [node.nodeType, node.nodeName, node.nodeValue];
    }

    const element = node as Element;
    const attributes = Array.from(element.attributes)
      .filter((attribute) => attribute.name.toLowerCase() !== "style")
      .map(
        (attribute) => [attribute.name.toLowerCase(), attribute.value] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right));
    const children =
      element.localName.toLowerCase() === "style"
        ? []
        : Array.from(element.childNodes, serialize);

    return ["element", element.localName.toLowerCase(), attributes, children];
  };

  return JSON.stringify(Array.from(container.childNodes, serialize));
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
  "border",
  "border-width",
  "border-style",
  "border-block",
  "border-block-width",
  "border-block-style",
  "border-block-start",
  "border-block-start-width",
  "border-block-start-style",
  "border-block-end",
  "border-block-end-width",
  "border-block-end-style",
  "border-inline",
  "border-inline-width",
  "border-inline-style",
  "border-inline-start",
  "border-inline-start-width",
  "border-inline-start-style",
  "border-inline-end",
  "border-inline-end-width",
  "border-inline-end-style",
  "border-top",
  "border-top-width",
  "border-top-style",
  "border-right",
  "border-right-width",
  "border-right-style",
  "border-bottom",
  "border-bottom-width",
  "border-bottom-style",
  "border-left",
  "border-left-width",
  "border-left-style",
  "gap",
  "row-gap",
  "column-gap",
  "columns",
  "column-count",
  "column-width",
  "column-fill",
  "column-span",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "syntax",
  "inherits",
  "initial-value",
  "src",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "inline-size",
  "min-inline-size",
  "max-inline-size",
  "block-size",
  "min-block-size",
  "max-block-size",
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "float",
  "clear",
  "break-before",
  "break-after",
  "break-inside",
  "orphans",
  "widows",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "display",
  "visibility",
  "content",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "text-wrap",
  "text-wrap-mode",
  "text-wrap-style",
  "line-break",
  "line-clamp",
  "hyphens",
  "word-spacing",
  "word-break",
  "overflow-wrap",
  "text-overflow",
  "text-transform",
  "all",
  "direction",
  "unicode-bidi",
  "writing-mode",
  "flex",
  "flex-flow",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "order",
  "grid",
  "grid-template",
  "grid-template-areas",
  "grid-auto-flow",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-template-columns",
  "grid-template-rows",
  "grid-area",
  "grid-column",
  "grid-column-start",
  "grid-column-end",
  "grid-row",
  "grid-row-start",
  "grid-row-end",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "place-content",
  "place-items",
  "place-self",
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "scale",
  "clip",
  "clip-path",
  "text-indent",
  "box-sizing",
  "aspect-ratio",
  "object-fit",
  "object-position",
  "contain",
  "zoom",
  "contain-intrinsic-size",
  "contain-intrinsic-width",
  "contain-intrinsic-height",
  "contain-intrinsic-block-size",
  "contain-intrinsic-inline-size",
  "content-visibility",
  "container-name",
  "container-type",
  "offset",
  "offset-path",
  "offset-distance",
  "offset-position",
  "offset-anchor",
  "offset-rotate",
  "table-layout",
  "border-spacing",
  "border-collapse",
]);

function protectedStyleInvariant(content: string): string {
  const container = parseSlideHtml(content);
  const signatures: string[] = [];
  for (const styleElement of container.querySelectorAll("style")) {
    appendProtectedCssSignatures(
      styleElement.textContent ?? "",
      "stylesheet",
      signatures,
    );
  }

  let elementIndex = 0;
  for (const element of container.querySelectorAll("*")) {
    const style = element.getAttribute("style");
    if (style !== null) {
      appendProtectedCssSignatures(style, `inline:${elementIndex}`, signatures);
    }
    elementIndex += 1;
  }
  return JSON.stringify(signatures);
}

function decodeCssIdentifier(identifier: string): string {
  return identifier.replace(
    /\\([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\r\n\f])/g,
    (_escape, hex: string | undefined, character: string | undefined) => {
      if (hex === undefined) return character ?? "";

      const codePoint = Number.parseInt(hex, 16);
      return String.fromCodePoint(
        codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? 0xfffd
          : codePoint,
      );
    },
  );
}

function cssAtRuleName(node: postcss.AtRule, css: string): string {
  const offset = node.source?.start?.offset;
  const source = offset === undefined ? "" : css.slice(offset);
  const match =
    /^@((?:[A-Za-z0-9_-]|\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[\t\n\f\r ])?|[^\r\n\f]))+)/.exec(
      source,
    );
  return decodeCssIdentifier(match?.[1] ?? node.name).toLowerCase();
}

function isProtectedStyleProperty(property: string): boolean {
  const unprefixed = property.replace(/^-(?:webkit|moz|ms|o)-/, "");
  return (
    protectedStyleProperties.has(unprefixed) ||
    unprefixed.startsWith("--") ||
    unprefixed.startsWith("font-") ||
    unprefixed === "animation" ||
    unprefixed.startsWith("animation-")
  );
}

function cssNodeContext(
  node: postcss.Node | undefined,
  source: string,
): string[] {
  const context = [source];
  let parent = node;
  while (parent && parent.type !== "root") {
    if (parent.type === "rule") {
      context.unshift(`rule:${(parent as postcss.Rule).selector}`);
    }
    if (parent.type === "atrule") {
      const atRule = parent as postcss.AtRule;
      context.unshift(`at:${atRule.name}:${atRule.params}`);
    }
    parent = parent.parent;
  }
  return context;
}

function appendProtectedCssSignatures(
  css: string,
  source: string,
  signatures: string[],
): void {
  const root = postcss.parse(css);
  root.walk((node) => {
    if (node.type === "atrule") {
      const name = cssAtRuleName(node, css);
      if (
        name !== "import" &&
        name !== "charset" &&
        name !== "namespace" &&
        !(name === "layer" && node.nodes === undefined)
      ) {
        return;
      }
      signatures.push(
        JSON.stringify([
          ...cssNodeContext(node.parent, source),
          `at:${name}`,
          node.params,
          `hasBlock:${node.nodes !== undefined}`,
        ]),
      );
      return;
    }
    if (node.type !== "decl") return;

    const decodedProperty = decodeCssIdentifier(node.prop);
    const property = decodedProperty.startsWith("--")
      ? decodedProperty
      : decodedProperty.toLowerCase();
    if (!isProtectedStyleProperty(property)) return;

    signatures.push(
      JSON.stringify([
        ...cssNodeContext(node.parent, source),
        property,
        node.value,
        node.important,
      ]),
    );
  });
}

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
