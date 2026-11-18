import { decodeHTML } from "entities";
import { parse, serialize } from "parse5";

const EXECUTABLE_ELEMENTS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  // Markup with scripting off and plain text with it on, so content one
  // parser read as text is live markup to the next.
  "noscript",
]);
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);
const EXECUTABLE_SCHEME = /^(?:javascript|vbscript):/i;
// Following one of these opens its URL as a document, and a data URL document
// is markup of the imported file's choosing.
const NAVIGATION_ATTRIBUTES = new Set([
  "action",
  "formaction",
  "href",
  "xlink:href",
]);
// SVG elements whose link only paints an image.
const IMAGE_LINK_ELEMENTS = new Set(["image", "feimage"]);
// SVG animation sets another attribute after parsing, so it can turn a safe
// link into a `javascript:` one the static checks never saw.
const ANIMATION_ELEMENTS = new Set([
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "set",
]);
const ANIMATION_VALUE_ATTRIBUTES = new Set(["by", "from", "to", "values"]);

type Range = { start: number; end: number; replacement: string };
type Location = { startOffset: number; endOffset: number };
type ParsedNode = {
  nodeName?: string;
  attrs?: Array<{ name: string; value: string; prefix?: string }>;
  childNodes?: ParsedNode[];
  content?: { childNodes?: ParsedNode[] };
  sourceCodeLocation?: Location & { attrs?: Record<string, Location> };
};

function hasExecutableScheme(value: string): boolean {
  return EXECUTABLE_SCHEME.test(
    decodeHTML(value).replace(/[\u0000-\u0020]+/g, ""),
  );
}

/** An animation that targets a link or handler, or animates to a script URL. */
function isExecutableAnimation(
  attrs: ReadonlyArray<{ name: string; value: string }>,
): boolean {
  return attrs.some(({ name, value }) => {
    const attribute = name.toLowerCase();
    if (attribute === "attributename") {
      const target = value.trim().toLowerCase();
      return (
        URL_ATTRIBUTES.has(target) ||
        target.startsWith("on") ||
        target === "style"
      );
    }
    return (
      ANIMATION_VALUE_ATTRIBUTES.has(attribute) &&
      value.split(";").some(hasExecutableScheme)
    );
  });
}

function isExecutableAttribute(
  name: string,
  value: string,
  nodeName: string,
): boolean {
  if (name.startsWith("on") || name === "srcdoc") return true;
  // Browsers ignore control characters and whitespace inside a scheme.
  const decoded = decodeHTML(value).replace(/[\u0000- ]+/g, "");
  if (NAVIGATION_ATTRIBUTES.has(name) && /^data:/i.test(decoded)) {
    return !(
      IMAGE_LINK_ELEMENTS.has(nodeName) && /^data:image\//i.test(decoded)
    );
  }
  if (URL_ATTRIBUTES.has(name)) {
    return (name === "srcset" ? decoded.split(",") : [decoded]).some(
      (candidate) => EXECUTABLE_SCHEME.test(candidate),
    );
  }
  return name === "style" && /expression\(|javascript:/i.test(decoded);
}

// Each pass can only remove markup, so a few passes settle any real file.
const MAX_PASSES = 8;

/**
 * Removes script-capable elements and attributes the way a browser parses
 * them, so slash-separated attributes (`<svg/onload=…>`) and entity-encoded
 * schemes (`jav&#x61;script:`) are caught. Only the offending source ranges
 * change; everything else keeps its exact bytes.
 *
 * The screen is parsed again later (with scripting on and off, and after the
 * DOM is serialized), so the result must read as safe every one of those ways:
 * a removal can join new markup, and some markup reparses differently once
 * serialized. Markup that still turns executable on a reparse is refused.
 */
export function stripExecutableMarkup(html: string): string {
  let current = html;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const ranges =
      [true, false]
        .map((scriptingEnabled) => executableRanges(current, scriptingEnabled))
        .find((found) => found.length) ?? [];
    if (!ranges.length) {
      if (changesWhenReparsed(current)) {
        throw new Error(
          "Imported markup turns executable when it is parsed again.",
        );
      }
      return current;
    }
    current = ranges
      .sort((left, right) => right.start - left.start)
      .reduce(
        (result, range) =>
          result.slice(0, range.start) +
          range.replacement +
          result.slice(range.end),
        current,
      );
  }
  throw new Error("Imported markup kept forming executable markup.");
}

function changesWhenReparsed(html: string): boolean {
  return [true, false].some((scriptingEnabled) => {
    const serialized = serialize(parse(html, { scriptingEnabled }));
    return [true, false].some(
      (reparseScripting) =>
        executableRanges(serialized, reparseScripting).length > 0,
    );
  });
}

function executableRanges(html: string, scriptingEnabled: boolean): Range[] {
  const ranges: Range[] = [];
  const visit = (node: ParsedNode) => {
    const location = node.sourceCodeLocation;
    const nodeName = node.nodeName?.toLowerCase();
    if (
      nodeName &&
      (EXECUTABLE_ELEMENTS.has(nodeName) ||
        (ANIMATION_ELEMENTS.has(nodeName) &&
          isExecutableAnimation(node.attrs ?? [])))
    ) {
      if (!location) {
        throw new Error("Could not locate an executable element to remove.");
      }
      ranges.push({
        start: location.startOffset,
        end: location.endOffset,
        replacement: "",
      });
      return;
    }
    for (const attribute of node.attrs ?? []) {
      // `xlink:href` parses as name `href` with prefix `xlink`, beside a plain
      // `href`; check and locate it by its qualified name, not the bare one.
      const qualifiedName = attribute.prefix
        ? `${attribute.prefix}:${attribute.name}`
        : attribute.name;
      if (
        !isExecutableAttribute(qualifiedName, attribute.value, nodeName ?? "")
      )
        continue;
      const attributeLocation = location?.attrs?.[qualifiedName];
      if (!attributeLocation) {
        throw new Error("Could not locate an executable attribute to remove.");
      }
      // A space, not nothing: `<svg/onload=…>` must not become `<svg/>`.
      ranges.push({
        start: attributeLocation.startOffset,
        end: attributeLocation.endOffset,
        replacement: " ",
      });
    }
    for (const child of [
      ...(node.childNodes ?? []),
      ...(node.content?.childNodes ?? []),
    ]) {
      visit(child);
    }
  };
  visit(
    parse(html, {
      sourceCodeLocationInfo: true,
      scriptingEnabled,
    }) as ParsedNode,
  );
  return ranges;
}
