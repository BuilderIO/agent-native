const SPACE_SEPARATED_IDREF_ATTRIBUTES = [
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "headers",
] as const;

const SINGLE_IDREF_ATTRIBUTES = ["for", "form", "list"] as const;
const FRAGMENT_REFERENCE_ATTRIBUTES = ["href", "xlink:href"] as const;

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function rewriteUrlIdReferences(value: string, idMap: Map<string, string>) {
  return value.replace(
    /url\(\s*(["']?)#([^\s)'";]+)\1\s*\)/g,
    (match, quote: string, id: string) => {
      const replacement = idMap.get(id);
      return replacement ? `url(${quote}#${replacement}${quote})` : match;
    },
  );
}

/**
 * Give every authored HTML/SVG id in a cloned subtree a fresh value and keep
 * the subtree's own references attached to the clone rather than the original.
 *
 * Duplicate source ids are already invalid HTML. Every occurrence still gets
 * a unique id; references follow the first occurrence, matching the browser's
 * normal getElementById/querySelector behavior before cloning.
 */
export function reassignClonedAuthoredIds(
  root: Element,
  createId: () => string,
): Map<string, string> {
  const elements = allElements(root);
  const idMap = new Map<string, string>();

  for (const element of elements) {
    const previousId = element.getAttribute("id");
    if (!previousId) continue;
    const nextId = createId();
    element.setAttribute("id", nextId);
    if (!idMap.has(previousId)) idMap.set(previousId, nextId);
  }

  if (idMap.size === 0) return idMap;

  for (const element of elements) {
    for (const attribute of SPACE_SEPARATED_IDREF_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      element.setAttribute(
        attribute,
        value
          .trim()
          .split(/\s+/)
          .map((id) => idMap.get(id) ?? id)
          .join(" "),
      );
    }

    for (const attribute of SINGLE_IDREF_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      const replacement = value ? idMap.get(value) : undefined;
      if (replacement) element.setAttribute(attribute, replacement);
    }

    for (const attribute of FRAGMENT_REFERENCE_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (!value?.startsWith("#")) continue;
      const replacement = idMap.get(value.slice(1));
      if (replacement) element.setAttribute(attribute, `#${replacement}`);
    }

    // SVG paint/filter/mask/clip/marker references and inline CSS commonly
    // use url(#id). Checking every attribute is both bounded to the cloned
    // subtree and more future-proof than maintaining a partial SVG list.
    for (const attribute of Array.from(element.attributes)) {
      if (!attribute.value.includes("url(")) continue;
      const rewritten = rewriteUrlIdReferences(attribute.value, idMap);
      if (rewritten !== attribute.value) {
        element.setAttribute(attribute.name, rewritten);
      }
    }

    // SMIL animation references use `id.event` rather than #id/url(#id).
    for (const attribute of ["begin", "end"] as const) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const rewritten = value
        .split(";")
        .map((part) => {
          const trimmed = part.trim();
          const separator = trimmed.indexOf(".");
          if (separator <= 0) return trimmed;
          const replacement = idMap.get(trimmed.slice(0, separator));
          return replacement
            ? `${replacement}${trimmed.slice(separator)}`
            : trimmed;
        })
        .join("; ");
      if (rewritten !== value) element.setAttribute(attribute, rewritten);
    }
  }

  return idMap;
}
