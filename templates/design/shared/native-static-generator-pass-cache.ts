import type { NativeEffectAnimationCapability } from "./native-effect-animation-capability";
import type { EffectDefinition, EffectInstance } from "./native-effects";

export interface NativeStaticGeneratorPassKeyInput {
  definition: EffectDefinition;
  instance: EffectInstance;
  executionHash: string;
  reviewedCapability: NativeEffectAnimationCapability;
  width: number;
  height: number;
  pixelRatio: number;
  workingFormat: string;
  colorSpace: string;
  dynamicRange: string;
  deviceEpoch: number;
  draftActive: boolean;
  instancePreviewActive: boolean;
}

export function nativeStaticGeneratorPassKey(
  input: NativeStaticGeneratorPassKeyInput,
): string | null {
  const { definition, instance } = input;
  if (
    definition.kind !== "generator" ||
    instance.placement !== "fill" ||
    input.reviewedCapability !== "static" ||
    instance.animation ||
    definition.interaction ||
    definition.simulation ||
    definition.feedback ||
    definition.statelessCompute ||
    (definition.resourceGraph &&
      definition.resourceGraph.abi !== "linear-resource-v1") ||
    definition.sourceSizing ||
    definition.optionalImage ||
    input.draftActive ||
    input.instancePreviewActive ||
    Object.keys(definition.inputs ?? {}).length > 0 ||
    Object.keys(instance.bindings ?? {}).length > 0 ||
    Object.values(definition.properties).some(
      (property) => property.type === "texture",
    ) ||
    definition.resources?.some((resource) => resource.external) ||
    !/^[a-f0-9]{64}$/.test(input.executionHash) ||
    !Number.isSafeInteger(input.width) ||
    input.width < 1 ||
    !Number.isSafeInteger(input.height) ||
    input.height < 1 ||
    !Number.isFinite(input.pixelRatio) ||
    input.pixelRatio <= 0 ||
    !Number.isSafeInteger(input.deviceEpoch) ||
    !Number.isFinite(instance.seed)
  )
    return null;

  const pass = definition.passes[0];
  if (!pass || definition.passes.length !== 1) return null;
  const shaderBody = pass.wgsl
    .replace("@group(0) @binding(2) var sourceTexture: texture_2d<f32>;", "")
    .replace("@group(0) @binding(3) var maskTexture: texture_2d<f32>;", "");
  const withoutSeedAndPixelRatio = shaderBody.replace(
    /\bglobals\s*\.\s*clock\s*\.\s*[yz]\b/g,
    "",
  );
  if (
    pass.kind !== "render" ||
    pass.reads.length > 0 ||
    pass.previousFrameReads?.length ||
    pass.additionalOutputs?.length ||
    /\b(?:sourceTexture|maskTexture)\b/.test(shaderBody) ||
    /\bglobals\s*\.\s*clock\b/.test(withoutSeedAndPixelRatio) ||
    /@binding\s*\(\s*(?:[2-9]|\d{2,})\s*\)/.test(shaderBody) ||
    (definition.output ?? pass.output) !== pass.output ||
    Object.keys(instance.params).some(
      (name) =>
        !Object.prototype.hasOwnProperty.call(definition.properties, name),
    )
  )
    return null;

  return JSON.stringify([
    input.executionHash,
    Object.entries(definition.properties).map(([name, property]) => [
      name,
      instance.params[name] ?? property.default,
    ]),
    instance.seed,
    input.width,
    input.height,
    input.pixelRatio,
    input.workingFormat,
    input.colorSpace,
    input.dynamicRange,
    input.deviceEpoch,
  ]);
}

export class NativeStaticGeneratorPassCache<T extends object> {
  private committed: { key: string; value: T } | null = null;

  read(key: string | null, retainedOutput: T | null): T | null {
    if (
      !key ||
      !retainedOutput ||
      this.committed?.key !== key ||
      this.committed.value !== retainedOutput
    ) {
      this.committed = null;
      return null;
    }
    return retainedOutput;
  }

  commit(key: string, output: T): void {
    this.committed = { key, value: output };
  }

  invalidate(): void {
    this.committed = null;
  }
}
