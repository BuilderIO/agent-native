/**
 * One definition of "which attributes may survive into an exported SVG".
 *
 * Two exporters need it and must agree: the editor's Download SVG walks the
 * live preview DOM (`stripNonStaticXmlAttributes`), while the `export-svg`
 * action tokenizes stored HTML text (`normalizeStartTagForXml`). They had
 * separate copies of these rules, so a directive taught to one stayed unknown
 * to the other and the same design exported clean from one path and unparsable
 * from the other.
 */

/**
 * Alpine/Vue/Angular-style runtime bindings. Anything in Alpine's `x-`
 * namespace counts: `x-collapse.duration.500ms` and `x-modelable` are legal
 * XML QNames, so the QName check below cannot catch them, and an exported
 * snapshot has no framework runtime to give them meaning.
 */
export function isFrameworkDirectiveAttributeName(name: string): boolean {
  return name.startsWith("@") || name.startsWith(":") || /^x-[a-z]/i.test(name);
}

/** Namespaced attributes that inline SVG icons legitimately carry. */
function isStandardNamespaceAttributeName(name: string): boolean {
  return /^(?:xmlns:xlink|xlink:href|xml:lang|xml:space)$/i.test(name);
}

/**
 * XML rejects any attribute name that is not a QName, and an unbound prefix
 * (`foo:bar`) is just as fatal as a leading `:`. Colons are therefore allowed
 * only for the standard namespaces above.
 */
export function isXmlSafeAttributeName(name: string): boolean {
  return (
    isStandardNamespaceAttributeName(name) ||
    /^[A-Za-z_][A-Za-z0-9._-]*$/.test(name)
  );
}

function isInlineEventHandlerName(name: string): boolean {
  return /^on/i.test(name);
}

/** Attribute names allowed to survive serialization into a static SVG. */
export function isStaticXmlAttributeName(name: string): boolean {
  return (
    !isFrameworkDirectiveAttributeName(name) &&
    !isInlineEventHandlerName(name) &&
    isXmlSafeAttributeName(name)
  );
}

/**
 * Values that execute when the exported file is opened, independent of the
 * attribute name being well-formed.
 */
export function isActiveXmlAttributeValue(
  name: string,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (/^(?:href|src|action|formaction|poster|xlink:href)$/i.test(name)) {
    if (/^(?:javascript|vbscript):/i.test(trimmed)) return true;
    if (
      /^data:/i.test(trimmed) &&
      !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(trimmed)
    ) {
      return true;
    }
  }
  if (
    name.toLowerCase() === "style" &&
    /(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(value)
  ) {
    return true;
  }
  return false;
}

/** Elements that must never appear in a static exported snapshot. */
export const NON_STATIC_EXPORT_ELEMENT_SELECTOR =
  "script,iframe,object,embed,base,meta[http-equiv],foreignObject,animate,set";

const ALWAYS_NON_STATIC_ELEMENT_RE =
  /^(?:script|iframe|object|embed|base|foreignObject|animate|set)$/i;

/**
 * Mirrors NON_STATIC_EXPORT_ELEMENT_SELECTOR for callers that only have a tag
 * name and cannot run a CSS selector. `<meta>` is conditional: a plain
 * `<meta charset>` is inert and worth keeping, while `http-equiv` carries
 * refresh and CSP directives that must not survive into an exported file.
 */
export function isNonStaticExportElement(
  tagName: string,
  options?: { hasHttpEquiv?: boolean },
): boolean {
  if (ALWAYS_NON_STATIC_ELEMENT_RE.test(tagName)) return true;
  return /^meta$/i.test(tagName) && options?.hasHttpEquiv === true;
}

/**
 * Removable elements with no end tag. A tokenizer that looks for `</meta>`
 * finds nothing and swallows the rest of the document, so this list has to
 * stay in step with `isNonStaticExportElement`.
 */
export const VOID_NON_STATIC_EXPORT_ELEMENT_RE = /^(?:embed|base|meta)$/i;
