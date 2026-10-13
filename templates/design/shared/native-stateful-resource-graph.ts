import type { EffectPass, EffectResourceSpec } from "./effect-graph";
import {
  isLinearResourceDispatch,
  linearResourceWorkgroupSize,
} from "./native-linear-resource-graph";

interface EffectStatefulResourceGraphBase {
  timing: {
    fixedDt: number;
    maxStepsPerCall: number;
    maxStepIndex: number;
  };
  stateResources: string[];
  sourceHistory?: "sequential-captures";
  resetProperties?: string[];
}

export type EffectStatefulResourceGraphSpec =
  | (EffectStatefulResourceGraphBase & { abi: "stateful-resource-v1" })
  | (EffectStatefulResourceGraphBase & { abi: "stateful-resource-v2" });

export function isStatefulResourceGraph(
  value: { abi: string } | undefined,
): value is EffectStatefulResourceGraphSpec {
  return (
    value?.abi === "stateful-resource-v1" ||
    value?.abi === "stateful-resource-v2"
  );
}

export interface EffectStatefulResourceDraw {
  vertices: 6;
  instances: { property: string; max: number };
}

const RESOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_GRAPH_BYTES = 64 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isStatefulResourceDraw(
  value: unknown,
): value is EffectStatefulResourceDraw {
  if (!record(value) || Object.keys(value).length !== 2) return false;
  const instances = value.instances;
  return (
    value.vertices === 6 &&
    record(instances) &&
    Object.keys(instances).length === 2 &&
    typeof instances.property === "string" &&
    RESOURCE_NAME.test(instances.property) &&
    Number.isSafeInteger(instances.max) &&
    (instances.max as number) >= 1 &&
    (instances.max as number) <= 4096
  );
}

export function validateStatefulResourceGraph(
  value: unknown,
  passes: readonly EffectPass[],
  resources: ReadonlyMap<string, EffectResourceSpec>,
  output: string | undefined,
  properties?: Readonly<
    Record<
      string,
      { type: string; min?: number; max?: number; default?: unknown }
    >
  >,
): string[] {
  if (!record(value)) return ["stateful resource graph is malformed"];
  const timing = value.timing;
  const stateResources = value.stateResources;
  const resetProperties = value.resetProperties;
  if (
    (value.abi !== "stateful-resource-v1" &&
      value.abi !== "stateful-resource-v2") ||
    Object.keys(value).some(
      (key) =>
        ![
          "abi",
          "timing",
          "stateResources",
          "sourceHistory",
          "resetProperties",
        ].includes(key),
    ) ||
    !record(timing) ||
    Object.keys(timing).length !== 3 ||
    !Number.isFinite(timing.fixedDt) ||
    (timing.fixedDt as number) < 1 / 240 ||
    (timing.fixedDt as number) > 1 / 15 ||
    !Number.isSafeInteger(timing.maxStepsPerCall) ||
    (timing.maxStepsPerCall as number) < 1 ||
    (timing.maxStepsPerCall as number) > 512 ||
    !Number.isSafeInteger(timing.maxStepIndex) ||
    (timing.maxStepIndex as number) < 0 ||
    (timing.maxStepIndex as number) > 36_000 ||
    !Array.isArray(stateResources) ||
    stateResources.length < 1 ||
    stateResources.length > 8 ||
    !stateResources.every(
      (name) => typeof name === "string" && RESOURCE_NAME.test(name),
    ) ||
    new Set(stateResources).size !== stateResources.length ||
    (value.sourceHistory !== undefined &&
      value.sourceHistory !== "sequential-captures") ||
    (resetProperties !== undefined &&
      (!Array.isArray(resetProperties) ||
        resetProperties.length > 16 ||
        !resetProperties.every(
          (name) => typeof name === "string" && RESOURCE_NAME.test(name),
        ) ||
        new Set(resetProperties).size !== resetProperties.length ||
        resetProperties.some((name) => !properties?.[name])))
  )
    return ["stateful resource graph is malformed or unbounded"];

  const errors: string[] = [];
  const external = [...resources.values()].filter(
    (resource) => resource.external,
  );
  if (value.abi === "stateful-resource-v1") {
    if (external.length !== 1 || external[0]?.name !== "source")
      errors.push("stateful graph needs exactly one external source texture");
  } else if (
    external.length < 2 ||
    external.length > 4 ||
    !external.some((resource) => resource.name === "source")
  ) {
    errors.push(
      "stateful v2 graph needs source and one to three named external textures",
    );
  }
  if (
    value.abi === "stateful-resource-v2" &&
    external.some(
      (resource) => !passes.some((pass) => pass.reads.includes(resource.name)),
    )
  )
    errors.push("stateful v2 graph has an unread external texture");
  const state = new Set(stateResources as string[]);
  const producerIndex = new Map<string, number>();
  for (const [index, pass] of passes.entries()) {
    producerIndex.set(pass.output, index);
  }
  if (
    !output ||
    passes[passes.length - 1]?.output !== output ||
    passes[passes.length - 1]?.kind !== "render" ||
    resources.get(output)?.kind !== "texture-2d" ||
    !resources.get(output)?.usage?.includes("sampled")
  )
    errors.push("stateful graph needs a final produced sampled render texture");

  let retainedBytes = 0;
  let graphBytes = 0;
  for (const resource of resources.values()) {
    if (resource.external) {
      if (
        resource.kind !== "texture-2d" ||
        resource.usage?.length !== 1 ||
        resource.usage[0] !== "sampled" ||
        resource.persistent
      )
        errors.push(
          `stateful external resource ${resource.name} must be sampled`,
        );
      continue;
    }
    if (
      resource.preprocess ||
      resource.mipmap ||
      resource.size === "source" ||
      resource.usage?.some(
        (usage) => usage === "copy-src" || usage === "copy-dst",
      )
    )
      errors.push(`stateful resource ${resource.name} uses unsupported setup`);
    if (Boolean(resource.persistent) !== state.has(resource.name))
      errors.push(`stateful resource ${resource.name} has ambiguous lifetime`);
    let bytes = 0;
    if (resource.kind === "buffer") {
      if (
        resource.size !== "fixed" ||
        !Number.isSafeInteger(resource.byteLength) ||
        !resource.byteLength ||
        resource.byteLength % 16 !== 0 ||
        resource.byteLength > MAX_STATE_BYTES ||
        resource.format !== undefined ||
        resource.usage?.length !== 1 ||
        resource.usage[0] !== "storage"
      )
        errors.push(`stateful buffer ${resource.name} must be bounded storage`);
      bytes = resource.byteLength ?? 0;
    } else {
      if (
        (resource.format !== "rgba16float" &&
          resource.format !== "rgba8unorm") ||
        (resource.size !== "fixed" && resource.size !== "viewport") ||
        !resource.usage?.includes("sampled") ||
        !resource.usage.some(
          (usage) => usage === "storage" || usage === "render",
        )
      )
        errors.push(`stateful texture ${resource.name} has invalid usage`);
      if (resource.size === "fixed") {
        const pixels = (resource.width ?? 0) * (resource.height ?? 0);
        if (
          !Number.isSafeInteger(resource.width) ||
          !Number.isSafeInteger(resource.height) ||
          !resource.width ||
          !resource.height ||
          resource.width > 2048 ||
          resource.height > 2048 ||
          pixels > 2_097_152
        )
          errors.push(`stateful texture ${resource.name} exceeds fixed bounds`);
        bytes = pixels * (resource.format === "rgba16float" ? 8 : 4);
      }
      if (
        state.has(resource.name) &&
        (resource.size !== "fixed" || resource.format !== "rgba16float")
      )
        errors.push(
          `stateful texture ${resource.name} needs fixed rgba16float state`,
        );
    }
    if (state.has(resource.name)) retainedBytes += bytes;
    graphBytes += bytes * (state.has(resource.name) ? 3 : 1);
  }
  if (retainedBytes > MAX_STATE_BYTES || graphBytes > MAX_GRAPH_BYTES)
    errors.push("stateful graph exceeds fixed GPU resource budget");
  for (const name of state) {
    if (!resources.has(name) || !producerIndex.has(name))
      errors.push(`stateful resource ${name} needs one declared producer`);
    if (!passes.some((pass) => pass.previousFrameReads?.includes(name)))
      errors.push(`stateful resource ${name} needs a previous-frame read`);
  }

  for (const [index, pass] of passes.entries()) {
    const written = resources.get(pass.output);
    if (
      pass.original !== undefined ||
      pass.additionalOutputs !== undefined ||
      pass.persistent !== undefined ||
      pass.reads.length + (pass.previousFrameReads?.length ?? 0) > 16
    )
      errors.push(
        `stateful pass ${pass.id} uses unsupported outputs or bindings`,
      );
    for (const name of pass.reads) {
      const input = resources.get(name);
      const producer = producerIndex.get(name);
      if (!input || (producer !== undefined && producer >= index))
        errors.push(
          `stateful pass ${pass.id} has a missing or forward read ${name}`,
        );
    }
    for (const name of pass.previousFrameReads ?? []) {
      if (!state.has(name))
        errors.push(`stateful pass ${pass.id} has undeclared history ${name}`);
    }
    if (pass.kind === "compute") {
      const dispatch = pass.dispatch;
      if (
        !isLinearResourceDispatch(dispatch) ||
        (dispatch.elements === "output-texture") !==
          (written?.kind === "texture-2d") ||
        !written?.usage?.includes("storage")
      ) {
        errors.push(`stateful compute pass ${pass.id} needs storage dispatch`);
      } else {
        const declared = linearResourceWorkgroupSize(pass.wgsl);
        if (
          !declared ||
          declared.some(
            (dimension, axis) => dimension !== dispatch.workgroupSize[axis],
          )
        )
          errors.push(
            `stateful compute pass ${pass.id} has mismatched workgroup`,
          );
      }
      if (pass.draw !== undefined)
        errors.push(`stateful compute pass ${pass.id} cannot draw`);
    } else if (
      pass.dispatch !== undefined ||
      written?.kind !== "texture-2d" ||
      !written.usage?.includes("render")
    ) {
      errors.push(
        `stateful render pass ${pass.id} needs render texture output`,
      );
    }
    if (pass.draw !== undefined) {
      if (!isStatefulResourceDraw(pass.draw)) {
        errors.push(`stateful pass ${pass.id} has unbounded instanced draw`);
      } else {
        const count = properties?.[pass.draw.instances.property];
        if (
          count?.type !== "int" ||
          !Number.isSafeInteger(count.default) ||
          (count.default as number) < 1 ||
          (count.default as number) > pass.draw.instances.max ||
          !Number.isSafeInteger(count.min) ||
          (count.min as number) < 1 ||
          !Number.isSafeInteger(count.max) ||
          (count.max as number) > pass.draw.instances.max ||
          !pass.reads.some((name) => resources.get(name)?.kind === "buffer")
        )
          errors.push(
            `stateful pass ${pass.id} needs bounded buffer-backed draw`,
          );
      }
    }
  }
  return errors;
}
