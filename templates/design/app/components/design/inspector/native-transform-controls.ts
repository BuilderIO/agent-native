import type { EffectTransform2D } from "@shared/native-effects";

export type NativeTransformField =
  | "translateX"
  | "translateY"
  | "scaleX"
  | "scaleY"
  | "rotate"
  | "originX"
  | "originY";

export class NativeTransformControlError extends Error {
  constructor() {
    super("Native transform value is outside its supported range.");
    this.name = "NativeTransformControlError";
  }
}

export function nativeTransformDisplayValue(
  transform: EffectTransform2D | undefined,
  field: NativeTransformField,
): number {
  switch (field) {
    case "translateX":
      return transform?.translate?.[0] ?? 0;
    case "translateY":
      return transform?.translate?.[1] ?? 0;
    case "scaleX":
      return (transform?.scale?.[0] ?? 1) * 100;
    case "scaleY":
      return (transform?.scale?.[1] ?? 1) * 100;
    case "rotate":
      return ((transform?.rotate ?? 0) * 180) / Math.PI;
    case "originX":
      return (transform?.origin?.[0] ?? 0.5) * 100;
    case "originY":
      return (transform?.origin?.[1] ?? 0.5) * 100;
  }
}

export function updateNativeTransform(
  current: EffectTransform2D | undefined,
  field: NativeTransformField,
  displayValue: number,
): EffectTransform2D {
  const limits: Record<NativeTransformField, [number, number]> = {
    translateX: [-100_000, 100_000],
    translateY: [-100_000, 100_000],
    scaleX: [0.01, 10_000],
    scaleY: [0.01, 10_000],
    rotate: [-18_000, 18_000],
    originX: [0, 100],
    originY: [0, 100],
  };
  const [min, max] = limits[field];
  if (
    !Number.isFinite(displayValue) ||
    displayValue < min ||
    displayValue > max
  )
    throw new NativeTransformControlError();
  const next = { ...current };
  switch (field) {
    case "translateX":
    case "translateY": {
      const pair: [number, number] = [
        current?.translate?.[0] ?? 0,
        current?.translate?.[1] ?? 0,
      ];
      pair[field === "translateX" ? 0 : 1] = displayValue;
      next.translate = pair;
      break;
    }
    case "scaleX":
    case "scaleY": {
      const pair: [number, number] = [
        current?.scale?.[0] ?? 1,
        current?.scale?.[1] ?? 1,
      ];
      pair[field === "scaleX" ? 0 : 1] = displayValue / 100;
      next.scale = pair;
      break;
    }
    case "rotate":
      next.rotate = (displayValue * Math.PI) / 180;
      break;
    case "originX":
    case "originY": {
      const pair: [number, number] = [
        current?.origin?.[0] ?? 0.5,
        current?.origin?.[1] ?? 0.5,
      ];
      pair[field === "originX" ? 0 : 1] = displayValue / 100;
      next.origin = pair;
      break;
    }
  }
  return next;
}
