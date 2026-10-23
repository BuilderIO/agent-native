export function isNativeNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof value.nodeType === "number"
  );
}

export function isNativeElement(value: unknown): value is Element {
  return isNativeNode(value) && value.nodeType === 1;
}

export function isNativeHtmlElement(value: unknown): value is HTMLElement {
  return (
    isNativeElement(value) &&
    value.namespaceURI === "http://www.w3.org/1999/xhtml"
  );
}

export function isNativeHtmlTag<K extends keyof HTMLElementTagNameMap>(
  value: unknown,
  tag: K,
): value is HTMLElementTagNameMap[K] {
  return isNativeHtmlElement(value) && value.localName === tag;
}

export function isNativeSvgElement(value: unknown): value is SVGElement {
  return (
    isNativeElement(value) &&
    value.namespaceURI === "http://www.w3.org/2000/svg"
  );
}

export function isNativeSvgRoot(value: unknown): value is SVGSVGElement {
  return isNativeSvgElement(value) && value.localName === "svg";
}
