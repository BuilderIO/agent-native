import type { EffectDefinition } from "./native-effects";

export function nativeEffectRequiresStateSession(
  definition: EffectDefinition | null | undefined,
): boolean {
  return Boolean(
    definition &&
    (definition.kind === "simulation" ||
      definition.simulation ||
      definition.feedback ||
      definition.resourceGraph?.abi === "stateful-resource-v1" ||
      definition.resourceGraph?.abi === "stateful-resource-v2" ||
      definition.resourceGraph?.abi === "stateful-resource-v3"),
  );
}
