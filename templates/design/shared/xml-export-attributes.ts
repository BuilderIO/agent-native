export function isFrameworkDirectiveAttributeName(name: string): boolean {
  return name.startsWith("@") || name.startsWith(":") || /^x-[a-z]/i.test(name);
}

function isStandardNamespaceAttributeName(name: string): boolean {
  return /^(?:xmlns:xlink|xlink:href|xml:lang|xml:space)$/i.test(name);
}

export function isXmlSafeAttributeName(name: string): boolean {
  return (
    isStandardNamespaceAttributeName(name) ||
    /^[A-Za-z_][A-Za-z0-9._-]*$/.test(name)
  );
}

function isInlineEventHandlerName(name: string): boolean {
  return /^on/i.test(name);
}

export function isStaticXmlAttributeName(name: string): boolean {
  return (
    !isFrameworkDirectiveAttributeName(name) &&
    !isInlineEventHandlerName(name) &&
    isXmlSafeAttributeName(name)
  );
}

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

export const NON_STATIC_EXPORT_ELEMENT_SELECTOR =
  "script,iframe,object,embed,base,meta[http-equiv],foreignObject,animate,set";

const ALWAYS_NON_STATIC_ELEMENT_RE =
  /^(?:script|iframe|object|embed|base|foreignObject|animate|set)$/i;

export function isNonStaticExportElement(
  tagName: string,
  options?: { hasHttpEquiv?: boolean },
): boolean {
  if (ALWAYS_NON_STATIC_ELEMENT_RE.test(tagName)) return true;
  return /^meta$/i.test(tagName) && options?.hasHttpEquiv === true;
}

export const VOID_NON_STATIC_EXPORT_ELEMENT_RE = /^(?:embed|base|meta)$/i;
