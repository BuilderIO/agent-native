import type {
  EffectColor,
  EffectDefinition,
  EffectProperty,
  EffectValue,
} from "./native-effects";

export type NativeParameterEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "step";

export interface NativeParameterKey {
  time: number;
  value: EffectValue;
  easing?: NativeParameterEasing;
}

export interface NativeParameterAnimation {
  duration: number;
  loop: boolean;
  tracks: Record<string, { keys: NativeParameterKey[] }>;
}

const EASINGS = new Set<NativeParameterEasing>([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step",
]);

export function nativeParameterCanAnimate(
  definition: EffectDefinition,
  name: string,
): boolean {
  const property = definition.properties[name];
  if (!property || property.rebuild) return false;
  if (
    (definition.feedback &&
      (definition.feedback.uniformProperties?.seed ?? "seed") === name) ||
    definition.feedback?.resetProperties?.includes(name)
  )
    return false;
  if (
    Object.values(definition.inputs ?? {}).some(
      (input) => input.enabledWhen?.property === name,
    )
  )
    return false;
  if (
    definition.interaction?.positionProperty === name ||
    definition.interaction?.activeProperty === name
  )
    return false;
  if (
    property.type === "texture" ||
    property.type === "position" ||
    property.type === "color-array"
  )
    return false;
  return definition.simulation?.count.property !== name;
}

export function validateNativeParameterAnimation(
  definition: EffectDefinition,
  animation: unknown,
  validateValue: (
    property: EffectProperty,
    value: unknown,
    name: string,
    errors: string[],
  ) => void,
): string[] {
  if (animation === undefined) return [];
  const errors: string[] = [];
  if (!animation || typeof animation !== "object" || Array.isArray(animation))
    return ["animation must be an object"];
  const value = animation as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => key !== "duration" && key !== "loop" && key !== "tracks",
    )
  )
    errors.push("animation has unknown fields");
  if (
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    value.duration > 60
  )
    errors.push("animation duration must be within (0, 60] seconds");
  if (typeof value.loop !== "boolean")
    errors.push("animation loop must be boolean");
  const tracks = value.tracks;
  if (!tracks || typeof tracks !== "object" || Array.isArray(tracks)) {
    errors.push("animation tracks must be an object");
    return errors;
  }
  const entries = Object.entries(tracks);
  if (entries.length < 1 || entries.length > 16)
    errors.push("animation needs 1–16 tracks");
  for (const [name, candidate] of entries) {
    const prefix = `animation track ${name}`;
    if (!nativeParameterCanAnimate(definition, name)) {
      errors.push(`${prefix} is not animatable`);
      continue;
    }
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const track = candidate as Record<string, unknown>;
    if (Object.keys(track).some((key) => key !== "keys"))
      errors.push(`${prefix} has unknown fields`);
    if (
      !Array.isArray(track.keys) ||
      track.keys.length < 2 ||
      track.keys.length > 32
    ) {
      errors.push(`${prefix} needs 2–32 keys`);
      continue;
    }
    const property = definition.properties[name];
    let previousTime = -1;
    let colorSpace: EffectColor["space"] | undefined;
    for (const [index, item] of track.keys.entries()) {
      const keyPrefix = `${prefix} key ${index}`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${keyPrefix} must be an object`);
        continue;
      }
      const key = item as Record<string, unknown>;
      if (
        Object.keys(key).some(
          (field) => !["time", "value", "easing"].includes(field),
        )
      )
        errors.push(`${keyPrefix} has unknown fields`);
      if (
        typeof key.time !== "number" ||
        !Number.isFinite(key.time) ||
        key.time < 0 ||
        key.time > (typeof value.duration === "number" ? value.duration : 0) ||
        key.time <= previousTime
      )
        errors.push(`${keyPrefix} time must increase within duration`);
      else previousTime = key.time;
      validateValue(property, key.value, name, errors);
      if (
        key.easing !== undefined &&
        !EASINGS.has(key.easing as NativeParameterEasing)
      )
        errors.push(`${keyPrefix} has invalid easing`);
      if (
        (property.type === "bool" || property.type === "enum") &&
        key.easing !== undefined &&
        key.easing !== "step"
      )
        errors.push(`${keyPrefix} must use step easing`);
      if (
        property.type === "color" &&
        key.value &&
        typeof key.value === "object"
      ) {
        const space = (key.value as EffectColor).space;
        if (colorSpace && colorSpace !== space)
          errors.push(`${prefix} color keys must share a color space`);
        if (space !== property.default.space)
          errors.push(`${prefix} color keys must use the declared color space`);
        colorSpace = space;
      }
    }
    if ((track.keys[0] as NativeParameterKey)?.time !== 0)
      errors.push(`${prefix} must start at time 0`);
    if (
      (track.keys[track.keys.length - 1] as NativeParameterKey)?.time !==
      value.duration
    )
      errors.push(`${prefix} must end at duration`);
  }
  return errors;
}

function eased(progress: number, easing: NativeParameterEasing): number {
  switch (easing) {
    case "ease-in":
      return progress * progress;
    case "ease-out":
      return 1 - (1 - progress) * (1 - progress);
    case "ease-in-out":
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - 2 * (1 - progress) * (1 - progress);
    case "step":
      return 0;
    default:
      return progress;
  }
}

function interpolate(
  property: EffectProperty,
  a: EffectValue,
  b: EffectValue,
  progress: number,
): EffectValue {
  if (property.type === "bool" || property.type === "enum") return a;
  if (property.type === "float" || property.type === "int") {
    const value = (a as number) + ((b as number) - (a as number)) * progress;
    return property.type === "int" ? Math.round(value) : value;
  }
  if (property.type === "vec2") {
    const from = a as [number, number];
    const to = b as [number, number];
    return [
      from[0] + (to[0] - from[0]) * progress,
      from[1] + (to[1] - from[1]) * progress,
    ];
  }
  if (property.type === "color") {
    const from = a as EffectColor;
    const to = b as EffectColor;
    return {
      space: from.space,
      components: [0, 1, 2].map(
        (index) =>
          from.components[index] +
          (to.components[index] - from.components[index]) * progress,
      ) as [number, number, number],
      alpha: from.alpha + (to.alpha - from.alpha) * progress,
    };
  }
  throw new Error(`Unsupported animated property type ${property.type}`);
}

export function resolveNativeParameterAnimation(
  definition: EffectDefinition,
  params: Record<string, EffectValue>,
  animation: NativeParameterAnimation | undefined,
  localTime: number,
): Record<string, EffectValue> {
  if (!animation) return params;
  if (!Number.isFinite(localTime) || localTime < 0)
    throw new Error("Animation local time must be finite and nonnegative");
  const time = animation.loop
    ? localTime % animation.duration
    : Math.min(localTime, animation.duration);
  const resolved = { ...params };
  for (const [name, track] of Object.entries(animation.tracks)) {
    const property = definition.properties[name];
    if (!nativeParameterCanAnimate(definition, name) || !property)
      throw new Error(`Animation track ${name} is not animatable`);
    const keys = track.keys;
    if (time <= keys[0].time) {
      resolved[name] = keys[0].value;
      continue;
    }
    const last = keys[keys.length - 1];
    if (time >= last.time) {
      resolved[name] = last.value;
      continue;
    }
    for (let index = 0; index < keys.length - 1; index++) {
      const from = keys[index];
      const to = keys[index + 1];
      if (time >= to.time) continue;
      const progress = (time - from.time) / (to.time - from.time);
      resolved[name] = interpolate(
        property,
        from.value,
        to.value,
        eased(progress, from.easing ?? "linear"),
      );
      break;
    }
  }
  return resolved;
}
