import { NativeEffectParameterConstraintError } from "@shared/native-effect-parameter-constraints";
import type { EffectDefinition, EffectValue } from "@shared/native-effects";

function orderedEndpoint(
  peer: number,
  gap: number,
  upper: boolean,
  scale: number,
): number {
  const roundTrip = (value: number) =>
    Number((Number((value * scale).toPrecision(12)) / scale).toPrecision(12));
  if (!Number.isFinite(scale) || scale <= 0)
    throw new NativeEffectParameterConstraintError([
      "ordered control scale is unreadable",
    ]);
  let value = roundTrip(peer + (upper ? -gap : gap));
  const valid = () =>
    Number.isFinite(value) &&
    roundTrip(value) === value &&
    (upper ? peer - value : value - peer) >= gap;
  if (valid()) return value;
  // Bounds pass through the same twelve-digit display/storage conversion as values.
  // Move an outward rounded endpoint by one displayed unit before offering it.
  const displayed = Number((value * scale).toPrecision(12));
  const unit = 10 ** (Math.floor(Math.log10(Math.abs(displayed))) - 11);
  if (!Number.isFinite(unit) || unit <= 0)
    throw new NativeEffectParameterConstraintError([
      "ordered control endpoint is unrepresentable",
    ]);
  value = roundTrip((displayed + (upper ? -unit : unit)) / scale);
  if (!valid())
    throw new NativeEffectParameterConstraintError([
      "ordered control endpoint is unrepresentable",
    ]);
  return value;
}

export function nativeOrderedNumericBounds(
  definition: EffectDefinition,
  name: string,
  values: Readonly<Record<string, EffectValue>>,
): { min: number | undefined; max: number | undefined } {
  const property = definition.properties[name];
  if (!property || (property.type !== "float" && property.type !== "int"))
    throw new NativeEffectParameterConstraintError([
      "numeric control property is missing",
    ]);
  let min = property.min;
  let max = property.max;
  for (const constraint of definition.parameterConstraints ?? []) {
    if (constraint.kind !== "ordered-floats") continue;
    const upper = constraint.lesser === name;
    if (!upper && constraint.greater !== name) continue;
    const peerName = upper ? constraint.greater : constraint.lesser;
    const peer = Object.prototype.hasOwnProperty.call(values, peerName)
      ? values[peerName]
      : definition.properties[peerName]?.default;
    if (typeof peer !== "number" || !Number.isFinite(peer))
      throw new NativeEffectParameterConstraintError([
        "ordered control peer is unreadable",
      ]);
    const endpoint = orderedEndpoint(
      peer,
      constraint.minGap,
      upper,
      property.displayScale ?? 1,
    );
    if (upper) max = max === undefined ? endpoint : Math.min(max, endpoint);
    else min = min === undefined ? endpoint : Math.max(min, endpoint);
  }
  if (min !== undefined && max !== undefined && min > max)
    throw new NativeEffectParameterConstraintError([
      "ordered control range is exhausted",
    ]);
  return { min, max };
}
