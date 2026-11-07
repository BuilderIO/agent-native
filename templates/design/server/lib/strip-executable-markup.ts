import { decodeHTML } from "entities";
import { parse } from "parse5";

const EXECUTABLE_ELEMENTS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
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

type Range = { start: number; end: number; replacement: string };
type Location = { startOffset: number; endOffset: number };
type ParsedNode = {
  nodeName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  content?: { childNodes?: ParsedNode[] };
  sourceCodeLocation?: Location & { attrs?: Record<string, Location> };
};

function isExecutableAttribute(name: string, value: string): boolean {
  if (name.startsWith("on") || name === "srcdoc") return true;
  // Browsers ignore control characters and whitespace inside a scheme.
  const decoded = decodeHTML(value).replace(/[\u0000- ]+/g, "");
  if (URL_ATTRIBUTES.has(name)) {
    return (name === "srcset" ? decoded.split(",") : [decoded]).some(
      (candidate) => EXECUTABLE_SCHEME.test(candidate),
    );
  }
  return name === "style" && /expression\(|javascript:/i.test(decoded);
}

/**
 * Removes script-capable elements and attributes the way a browser parses
 * them, so slash-separated attributes (`<svg/onload=…>`) and entity-encoded
 * schemes (`jav&#x61;script:`) are caught. Only the offending source ranges
 * change; everything else keeps its exact bytes.
 */
export function stripExecutableMarkup(html: string): string {
  const ranges: Range[] = [];
  const visit = (node: ParsedNode) => {
    const location = node.sourceCodeLocation;
    if (node.nodeName && EXECUTABLE_ELEMENTS.has(node.nodeName)) {
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
      if (!isExecutableAttribute(attribute.name, attribute.value)) continue;
      const attributeLocation = location?.attrs?.[attribute.name];
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
  visit(parse(html, { sourceCodeLocationInfo: true }) as ParsedNode);
  return ranges
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, range) =>
        result.slice(0, range.start) +
        range.replacement +
        result.slice(range.end),
      html,
    );
}
