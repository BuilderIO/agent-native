import {
  isNativePositionValue,
  packNativePosition,
} from "./native-effect-position";
import {
  checkEffectAssetUrl,
  type EffectDefinition,
  type EffectValue,
} from "./native-effects";

export type NativeStatefulResetValues = readonly (readonly [string, string])[];

export class NativeStatefulResetValueError extends Error {
  readonly code = "stateful-params-invalid";

  constructor(name: string) {
    super(`Reset property ${name} has an invalid value.`);
  }
}

function colorValue(
  value: unknown,
): readonly [string, number, number, number, number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const color = value as Record<string, unknown>;
  const components = color.components;
  if (
    (color.space !== "srgb" && color.space !== "display-p3") ||
    !Array.isArray(components) ||
    components.length !== 3 ||
    !Array.from({ length: 4 }, (_, index) =>
      index === 3 ? color.alpha : components[index],
    ).every(
      (part) =>
        typeof part === "number" &&
        Number.isFinite(part) &&
        part >= 0 &&
        part <= 1,
    )
  )
    return null;
  return [
    color.space,
    components[0],
    components[1],
    components[2],
    color.alpha as number,
  ];
}

export function snapshotNativeStatefulResetValues(
  definition: EffectDefinition,
  params: Readonly<Record<string, EffectValue>>,
  names: readonly string[],
): NativeStatefulResetValues {
  return names.map((name) => {
    const property = definition.properties[name];
    if (!property) throw new NativeStatefulResetValueError(name);
    const value: unknown = Object.prototype.hasOwnProperty.call(params, name)
      ? params[name]
      : property.default;
    let normalized: unknown;
    switch (property.type) {
      case "float":
      case "int":
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (property.type === "int" && !Number.isInteger(value)) ||
          (property.min !== undefined && value < property.min) ||
          (property.max !== undefined && value > property.max)
        )
          throw new NativeStatefulResetValueError(name);
        normalized = value;
        break;
      case "bool":
        if (typeof value !== "boolean")
          throw new NativeStatefulResetValueError(name);
        normalized = value;
        break;
      case "enum":
        if (typeof value !== "string" || !property.options.includes(value))
          throw new NativeStatefulResetValueError(name);
        normalized = value;
        break;
      case "color":
        normalized = colorValue(value);
        if (!normalized) throw new NativeStatefulResetValueError(name);
        break;
      case "vec2":
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          ![value[0], value[1]].every(
            (part) => typeof part === "number" && Number.isFinite(part),
          ) ||
          (property.min !== undefined &&
            value.some((part) => part < property.min!)) ||
          (property.max !== undefined &&
            value.some((part) => part > property.max!))
        )
          throw new NativeStatefulResetValueError(name);
        normalized = [...value];
        break;
      case "position":
        if (!isNativePositionValue(value))
          throw new NativeStatefulResetValueError(name);
        normalized = packNativePosition(value);
        break;
      case "color-array":
        if (!Array.isArray(value) || value.length > property.maxCount)
          throw new NativeStatefulResetValueError(name);
        normalized = Array.from(value, (item) => {
          const color = colorValue(item);
          if (!color) throw new NativeStatefulResetValueError(name);
          return color;
        });
        break;
      case "texture":
        if (value === null) {
          normalized = null;
          break;
        }
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !("kind" in value) ||
          value.kind !== "asset" ||
          !("url" in value) ||
          !checkEffectAssetUrl(value.url).ok
        )
          throw new NativeStatefulResetValueError(name);
        normalized = value.url;
        break;
    }
    return [name, JSON.stringify([property.type, normalized])] as const;
  });
}

export function nativeStatefulResetValuesChanged(
  previous: NativeStatefulResetValues,
  next: NativeStatefulResetValues,
): boolean {
  return (
    previous.length !== next.length ||
    previous.some(
      ([name, value], index) =>
        next[index]?.[0] !== name || next[index]?.[1] !== value,
    )
  );
}
