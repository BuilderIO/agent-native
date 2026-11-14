import { isNativeHtmlElement, isNativeSvgRoot } from "./native-dom";

export type NativeScenePresentationElement = HTMLElement | SVGSVGElement;

export function isNativeScenePresentationElement(
  element: Element,
): element is NativeScenePresentationElement {
  // Adopted editor nodes retain their creation realm's prototypes.
  return isNativeHtmlElement(element) || isNativeSvgRoot(element);
}
