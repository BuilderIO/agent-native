import {
  checkEffectAssetUrl,
  type EffectDefinition,
  type EffectInputBinding,
  type EffectInstance,
  type EffectTextureRef,
} from "./native-effects";

export type NativeExternalTextureInput =
  | { kind: "builtin"; source: "source" | "mask" | "backdrop" }
  | {
      kind: "asset";
      url: string;
      sampleEncoding?:
        | "srgb-color"
        | "srgb-color-premultiplied"
        | "linear-data"
        | "srgb-encoded-straight";
      preprocess?: "paper-liquid-mask" | "paper-gem-smoke-mask-32";
      mipmap?: "generated";
    }
  | { kind: "fallback"; source: "transparent-data" };

export type NativeInputPlan =
  | { ok: true; inputs: ReadonlyMap<string, NativeExternalTextureInput> }
  | { ok: false; code: string; detail: string };

const BUILTINS = new Set(["source", "mask", "backdrop"]);

function sameInput(
  a: NativeExternalTextureInput,
  b: NativeExternalTextureInput,
): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === "asset"
      ? a.url === (b as typeof a).url
      : a.source === (b as typeof a).source)
  );
}

export function planNativeInputResources(
  definition: EffectDefinition,
  instance: EffectInstance,
): NativeInputPlan {
  const produced = new Set(
    definition.passes.flatMap((pass) => [
      pass.output,
      ...(pass.additionalOutputs ?? []),
    ]),
  );
  const needed = new Set(
    definition.passes
      .flatMap((pass) => pass.reads)
      .filter((read) => !produced.has(read)),
  );
  const inputs = new Map<string, NativeExternalTextureInput>();
  for (const [portName, port] of Object.entries(definition.inputs ?? {})) {
    if (port.kind !== "texture-2d" && port.kind !== "mask") continue;
    const resource = port.resource;
    if (!resource) continue;
    const optionalNoise =
      definition.optionalImage !== undefined &&
      definition.passes[0]?.reads[1] === "noise" &&
      portName === "noise";
    let binding: EffectInputBinding | null =
      instance.bindings &&
      Object.prototype.hasOwnProperty.call(instance.bindings, portName)
        ? instance.bindings[portName]
        : null;
    for (const [name, property] of Object.entries(definition.properties)) {
      if (property.type !== "texture" || property.input !== portName) continue;
      const value = Object.prototype.hasOwnProperty.call(instance.params, name)
        ? instance.params[name]
        : property.default;
      if (value === null) continue;
      if (binding)
        return {
          ok: false,
          code: "input-binding-conflict",
          detail: `Texture property ${name} conflicts with binding ${portName}.`,
        };
      binding = value as EffectTextureRef;
    }
    if (!binding && needed.has(resource) && BUILTINS.has(resource))
      binding = {
        kind: "builtin",
        source: resource as "source" | "mask" | "backdrop",
      };
    if (!binding) {
      if (optionalNoise && needed.has(resource))
        return {
          ok: false,
          code: "optional-noise-asset-required",
          detail: "The second input needs a resolved linear data asset.",
        };
      if (
        needed.has(resource) &&
        port.optional &&
        port.fallback === "transparent-data"
      )
        inputs.set(resource, { kind: "fallback", source: "transparent-data" });
      continue;
    }
    if (
      (portName === definition.optionalImage?.port || optionalNoise) &&
      binding.kind !== "asset"
    )
      return {
        ok: false,
        code: optionalNoise
          ? "optional-noise-asset-required"
          : "optional-image-asset-required",
        detail: `Input ${portName} needs a decoded asset rather than an authored or composed source.`,
      };
    if (binding.kind === "authored-node")
      return {
        ok: false,
        code: "input-authored-node-unsupported",
        detail: `Input ${portName} needs an authored-node capture path.`,
      };
    if (binding.kind === "asset") {
      const checked = checkEffectAssetUrl(binding.url);
      if (!checked.ok)
        return {
          ok: false,
          code: "input-asset-invalid",
          detail: `Input ${portName} has an invalid local asset path (${checked.reason}).`,
        };
      const resourceSpec = definition.resources?.find(
        (candidate) => candidate.name === resource,
      );
      binding = {
        kind: "asset",
        url: checked.url,
        ...(resourceSpec?.sampleEncoding
          ? { sampleEncoding: resourceSpec.sampleEncoding }
          : {}),
        ...(resourceSpec?.preprocess
          ? { preprocess: resourceSpec.preprocess }
          : {}),
        ...(resourceSpec?.mipmap ? { mipmap: resourceSpec.mipmap } : {}),
      };
    }
    if (
      binding.kind === "builtin" &&
      binding.source === "backdrop" &&
      instance.placement !== "backdrop"
    )
      return {
        ok: false,
        code: "input-placement-unsupported",
        detail: `Input ${portName} cannot sample a backdrop on a ${instance.placement} instance.`,
      };
    if (
      binding.kind === "builtin" &&
      definition.resources?.some(
        (candidate) =>
          candidate.name === resource &&
          candidate.sampleEncoding === "linear-data",
      )
    )
      return {
        ok: false,
        code: "input-encoding-unsupported",
        detail: `Resource ${resource} needs a raw data asset, not a composed color source.`,
      };
    const existing = inputs.get(resource);
    if (existing && !sameInput(existing, binding))
      return {
        ok: false,
        code: "input-resource-ambiguous",
        detail: `Resource ${resource} has conflicting input bindings.`,
      };
    inputs.set(resource, binding);
  }
  for (const resource of needed) {
    if (inputs.has(resource)) continue;
    if (resource === "source" || resource === "mask") {
      inputs.set(resource, { kind: "builtin", source: resource });
      continue;
    }
    if (resource === "backdrop" && instance.placement === "backdrop") {
      inputs.set(resource, { kind: "builtin", source: "backdrop" });
      continue;
    }
    return {
      ok: false,
      code: "input-resource-missing",
      detail: `Pass input ${resource} has no available texture binding.`,
    };
  }
  for (const resource of inputs.keys())
    if (!needed.has(resource))
      return {
        ok: false,
        code: "input-resource-unused",
        detail: `Bound input ${resource} is not read by a pass.`,
      };
  return { ok: true, inputs };
}
