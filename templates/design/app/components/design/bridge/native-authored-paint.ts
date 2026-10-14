import { NativeSourceError } from "./native-source-provider";

const NATIVE_SUPPRESSION_ATTRIBUTES = [
  "data-an-native-fill-suppressed",
  "data-an-native-text-suppressed",
  "data-an-native-layer-suppressed",
  "data-an-native-scene-suppressed",
] as const;

export type NativeAuthoredPaintSnapshot = Readonly<{
  opacity: number;
  backgroundColor: string;
  backgroundImage: string;
  borderTopColor: string;
  borderRightColor: string;
  borderBottomColor: string;
  borderLeftColor: string;
  borderImageSource: string;
  color: string;
  textFillColor: string;
}>;

export function readNativeAuthoredPaint(
  target: HTMLElement,
): NativeAuthoredPaintSnapshot {
  const present = NATIVE_SUPPRESSION_ATTRIBUTES.filter((attribute) =>
    target.hasAttribute(attribute),
  );
  try {
    for (const attribute of present) target.removeAttribute(attribute);
    const computed = getComputedStyle(target);
    const opacity = Number(computed.opacity);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new NativeSourceError(
        "source-opacity-invalid",
        "Authored source opacity is not a finite value in [0, 1].",
      );
    return Object.freeze({
      opacity,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderTopColor: computed.borderTopColor,
      borderRightColor: computed.borderRightColor,
      borderBottomColor: computed.borderBottomColor,
      borderLeftColor: computed.borderLeftColor,
      borderImageSource: computed.borderImageSource,
      color: computed.color,
      textFillColor: computed.getPropertyValue("-webkit-text-fill-color"),
    });
  } finally {
    for (const attribute of present) target.setAttribute(attribute, "");
  }
}

export function clearNativeAuthoredOpacityIfUnsuppressed(
  target: HTMLElement,
): void {
  if (
    !target.hasAttribute("data-an-native-fill-suppressed") &&
    !target.hasAttribute("data-an-native-layer-suppressed") &&
    !target.hasAttribute("data-an-native-scene-suppressed")
  )
    target.removeAttribute("data-an-native-authored-opacity");
}
