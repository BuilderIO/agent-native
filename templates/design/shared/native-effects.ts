import { parse } from "parse5";

import {
  FEEDBACK_UNIFORM_SLOTS,
  feedbackUniformProperties,
  planEffectGraph,
  type EffectFeedbackSpec,
  type EffectPass,
  type EffectResourceSpec,
  type EffectStatelessComputeSpec,
} from "./effect-graph";
import {
  NativeEffectParameterConstraintError,
  validateParameterConstraintDefinitions,
  validateResolvedParameterConstraints,
  type EffectParameterConstraint,
} from "./native-effect-parameter-constraints";
import {
  isNativePositionValue,
  packNativePosition,
  type NativePositionBasis,
  type NativePositionValue,
} from "./native-effect-position";
import {
  isNativeSourceSizing,
  type NativeSourceSizing,
} from "./native-source-sizing";
import { isStatelessComputeDispatch } from "./native-stateless-compute";
import { isFiniteNativeUniformTiming } from "./native-uniform-timing";

export type {
  EffectFeedbackSpec,
  EffectPass,
  EffectResourceSpec,
} from "./effect-graph";
export type { NativeSourceSizing } from "./native-source-sizing";
export type { EffectParameterConstraint } from "./native-effect-parameter-constraints";
export type {
  NativePositionBasis,
  NativePositionValue,
} from "./native-effect-position";

export const NATIVE_EFFECT_SCRIPT_TYPE = "application/x-agent-native-effects";
export const NATIVE_EFFECT_SCHEMA_VERSION = 2;
export function usesRetiredNativeImageAbi(
  definition: EffectDefinition,
  instance?: Pick<EffectInstance, "sourceSizing">,
): boolean {
  return Boolean(
    definition.sourceSizing ||
    definition.optionalImage ||
    definition.resources?.some(
      (resource) => resource.preprocess !== undefined,
    ) ||
    instance?.sourceSizing,
  );
}

export const MAX_EFFECT_MANIFEST_BYTES = 2_000_000;
const MAX_PROPERTY_SLOTS = 32;
const MAX_COLOR_ARRAY = 10;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const PROPERTY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function definitionKey(id: string, version: number): string {
  return `${id}\u0000${version}`;
}

export interface EffectColor {
  space: "srgb" | "display-p3";
  components: [number, number, number];
  alpha: number;
}

export interface EffectTextureRef {
  kind: "asset";
  url: string;
}

export interface EffectVisibilityCondition {
  property: string;
  equals: number | boolean | string;
}

export type EffectProperty = (
  | {
      type: "float" | "int";
      label: string;
      default: number;
      min?: number;
      max?: number;
      step?: number;
      displayScale?: number;
      group?: string;
      unit?: string;
      rebuild?: boolean;
    }
  | {
      type: "bool";
      label: string;
      default: boolean;
      group?: string;
      rebuild?: boolean;
    }
  | {
      type: "enum";
      label: string;
      default: string;
      options: string[];
      group?: string;
      rebuild?: boolean;
    }
  | {
      type: "color";
      label: string;
      default: EffectColor;
      group?: string;
      rebuild?: boolean;
    }
  | {
      type: "vec2";
      label: string;
      default: [number, number];
      min?: number;
      max?: number;
      step?: number;
      displayScale?: number;
      group?: string;
      unit?: string;
      rebuild?: boolean;
    }
  | {
      type: "position";
      label: string;
      default: NativePositionValue;
      basis: NativePositionBasis;
      group?: string;
      rebuild?: boolean;
    }
  | {
      type: "color-array";
      label: string;
      default: EffectColor[];
      maxCount: number;
      group?: string;
      rebuild?: boolean;
    }
  | {
      type: "texture";
      label: string;
      default: EffectTextureRef | null;
      input: string;
      group?: string;
      rebuild?: boolean;
    }
) & { visibleWhen?: EffectVisibilityCondition; advanced?: boolean };

export type EffectValue =
  | number
  | boolean
  | string
  | EffectColor
  | [number, number]
  | NativePositionValue
  | EffectColor[]
  | EffectTextureRef
  | null;

export type EffectInputBinding =
  | { kind: "builtin"; source: "source" | "mask" | "backdrop" }
  | {
      kind: "authored-node";
      nodeId: string;
      capture: "content" | "appearance";
    }
  | { kind: "asset"; url: string };

export interface EffectTransform2D {
  translate?: [number, number];
  scale?: [number, number];
  rotate?: number;
  origin?: [number, number];
}

export interface EffectExtentInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EffectExtent {
  source?: EffectExtentInsets;
  output?: EffectExtentInsets;
}

export interface EffectPortSpec {
  kind:
    | "float"
    | "int"
    | "bool"
    | "vec2"
    | "color"
    | "texture-2d"
    | "mask"
    | "buffer"
    | "signal";
  resource?: string;
  optional?: boolean;
  fallback?: "transparent-data";
}

export type RetiredNativeImageUvContract = {
  uv: "paper-image";
  intrinsicEncoding?: "srgb-encoded-straight";
  defaultSampling?: {
    min: "linear";
    mag: "linear";
    mipmap: "linear";
  };
};

export type RetiredNativeOptionalImageContract = {
  port: "image";
  abi: "paper-optional-image-v1";
};

export interface EffectDefinition {
  id: string;
  name: string;
  version: number;
  kind: "generator" | "processor" | "simulation";
  placements: ("fill" | "layer" | "backdrop")[];
  properties: Record<string, EffectProperty>;
  parameterConstraints?: EffectParameterConstraint[];
  passes: EffectPass[];
  inputs?: Record<string, EffectPortSpec>;
  outputs?: Record<string, EffectPortSpec>;
  resources?: EffectResourceSpec[];
  output?: string;
  extent?: EffectExtent;
  sourceSizing?: RetiredNativeImageUvContract;
  optionalImage?: RetiredNativeOptionalImageContract;
  feedback?: EffectFeedbackSpec;
  statelessCompute?: EffectStatelessComputeSpec;
  simulation?: {
    fixedDt: number;
    stateResource: string;
    bytesPerParticle: 32;
    count: {
      property: string;
      tiers: { low: 10000; medium: 25000; high: 50000 };
    };
    maxInteractiveSteps: 8;
    maxDeterministicSteps: 512;
    idlePointer: { x: number; y: number };
  };
  provenance: {
    origin: "design-original" | "user-authored" | "imported";
    note?: string;
    upstream?: {
      repository: string;
      commit: string;
      file: string;
      license: string;
      notice?: string;
    };
  };
}

export interface EffectInstance {
  id: string;
  nodeId: string;
  definitionId: string;
  definitionVersion: number;
  placement: "fill" | "layer" | "backdrop";
  params: Record<string, EffectValue>;
  enabled: boolean;
  opacity: number;
  seed: number;
  clip: "bounds" | "text";
  blend: "normal";
  timing: {
    speed: number;
    paused: boolean;
    time: number;
    seekRevision?: number;
  };
  bindings?: Record<string, EffectInputBinding>;
  transform?: EffectTransform2D;
  sourceSizing?: NativeSourceSizing;
}

export interface EffectPreset {
  id: string;
  name: string;
  definitionId: string;
  definitionVersion: number;
  placement: EffectInstance["placement"];
  params: Record<string, EffectValue>;
  clip: EffectInstance["clip"];
  bindings?: EffectInstance["bindings"];
  transform?: EffectTransform2D;
  sourceSizing?: NativeSourceSizing;
  timing?: Pick<EffectInstance["timing"], "speed" | "paused" | "time">;
  provenance: { origin: "design-original" | "imported" | "user-authored" };
}

export interface EffectDocument {
  schemaVersion: 2;
  definitions: EffectDefinition[];
  instances: EffectInstance[];
  presets?: EffectPreset[];
  preview?: EffectPreviewPolicy;
}

export interface EffectPreviewPolicy {
  quality: "auto" | "performance" | "quality";
  frameRateTarget: 60 | 120;
  colorMode?: "srgb" | "display-p3";
  dynamicRange?: "sdr" | "hdr";
}

export type EffectManifest = EffectDocument;

export interface EffectValidationResult {
  valid: boolean;
  errors: string[];
  document?: EffectDocument;
}

export interface EffectHtmlResult {
  html: string;
  errors: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteUnit(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function validImportedUpstream(value: unknown): boolean {
  return (
    record(value) &&
    ["repository", "commit", "file", "license"].every(
      (key) => typeof value[key] === "string" && !!value[key],
    )
  );
}

function validColor(value: unknown): value is EffectColor {
  return (
    record(value) &&
    (value.space === "srgb" || value.space === "display-p3") &&
    Array.isArray(value.components) &&
    value.components.length === 3 &&
    value.components.every(finiteUnit) &&
    finiteUnit(value.alpha)
  );
}

export type EffectAssetUrlCheck =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "invalid-type"
        | "non-local"
        | "unsafe-path"
        | "malformed-encoding";
    };

export function checkEffectAssetUrl(value: unknown): EffectAssetUrlCheck {
  if (typeof value !== "string") return { ok: false, reason: "invalid-type" };
  if (!value.startsWith("/") || value.startsWith("//"))
    return { ok: false, reason: "non-local" };
  if (value.length > 2048 || /[\\\s<>"'\u0000-\u001f]/.test(value))
    return { ok: false, reason: "unsafe-path" };
  try {
    const decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("%") ||
      decoded.split("/").includes("..") ||
      /[\\\u0000-\u001f]/.test(decoded)
    )
      return { ok: false, reason: "unsafe-path" };
    return { ok: true, url: value };
  } catch {
    return { ok: false, reason: "malformed-encoding" };
  }
}

function validateTransform(
  value: unknown,
  prefix: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!record(value)) {
    errors.push(`${prefix}.transform must be an object`);
    return;
  }
  if (
    value.translate !== undefined &&
    (!Array.isArray(value.translate) ||
      value.translate.length !== 2 ||
      !value.translate.every(
        (part) => finite(part) && Math.abs(part) <= 100_000,
      ))
  )
    errors.push(
      `${prefix}.transform.translate needs two bounded pixel offsets`,
    );
  if (
    value.scale !== undefined &&
    (!Array.isArray(value.scale) ||
      value.scale.length !== 2 ||
      !value.scale.every((part) => finite(part) && part > 0 && part <= 100))
  )
    errors.push(`${prefix}.transform.scale needs two positive bounded factors`);
  if (
    value.rotate !== undefined &&
    (!finite(value.rotate) || Math.abs(value.rotate) > 100 * Math.PI)
  )
    errors.push(`${prefix}.transform.rotate needs bounded radians`);
  if (
    value.origin !== undefined &&
    (!Array.isArray(value.origin) ||
      value.origin.length !== 2 ||
      !value.origin.every(finiteUnit))
  )
    errors.push(`${prefix}.transform.origin needs normalized coordinates`);
  for (const key of Object.keys(value))
    if (!["translate", "scale", "rotate", "origin"].includes(key))
      errors.push(`${prefix}.transform has unknown field "${key}"`);
}

function validateSourceSizing(
  value: unknown,
  definition: EffectDefinition | undefined,
  prefix: string,
  errors: string[],
): void {
  if (value === undefined) {
    if (definition?.sourceSizing?.intrinsicEncoding === "srgb-encoded-straight")
      errors.push(`${prefix}.sourceSizing needs an intrinsic-image source`);
    return;
  }
  if (definition?.sourceSizing?.uv !== "paper-image") {
    errors.push(
      `${prefix}.sourceSizing needs a processor definition with the saved image-UV contract`,
    );
    return;
  }
  if (!isNativeSourceSizing(value))
    errors.push(`${prefix}.sourceSizing is invalid`);
  else if (
    value.inputSpace === "intrinsic-image" &&
    definition.sourceSizing?.intrinsicEncoding !== "srgb-encoded-straight"
  )
    errors.push(
      `${prefix}.sourceSizing needs an encoded-straight intrinsic source ABI`,
    );
  else if (
    value.inputSpace === "rendered-surface" &&
    definition.sourceSizing?.intrinsicEncoding === "srgb-encoded-straight"
  )
    errors.push(`${prefix}.sourceSizing needs an intrinsic-image source`);
}

function validateBindings(
  value: unknown,
  definition: EffectDefinition | undefined,
  prefix: string,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!record(value) || Object.keys(value).length > 16) {
    errors.push(`${prefix}.bindings must contain at most 16 named inputs`);
    return;
  }
  for (const [name, binding] of Object.entries(value)) {
    const port =
      definition?.inputs &&
      Object.prototype.hasOwnProperty.call(definition.inputs, name)
        ? definition.inputs[name]
        : undefined;
    if (!port || !["texture-2d", "mask"].includes(port.kind)) {
      errors.push(
        `${prefix}.bindings.${name} needs a texture or mask input port`,
      );
      continue;
    }
    if (!record(binding)) {
      errors.push(`${prefix}.bindings.${name} is invalid`);
      continue;
    }
    const fields =
      binding.kind === "builtin"
        ? ["kind", "source"]
        : binding.kind === "authored-node"
          ? ["kind", "nodeId", "capture"]
          : binding.kind === "asset"
            ? ["kind", "url"]
            : ["kind"];
    if (Object.keys(binding).some((field) => !fields.includes(field)))
      errors.push(`${prefix}.bindings.${name} has unknown fields`);
    const optionalNoise =
      definition?.optionalImage &&
      definition.passes[0]?.reads[1] === "noise" &&
      name === "noise";
    if (
      (name === definition?.optionalImage?.port || optionalNoise) &&
      binding.kind !== "asset"
    )
      errors.push(
        `${prefix}.bindings.${name} needs an asset for optional image sampling`,
      );
    if (binding.kind === "builtin") {
      if (
        !["source", "mask", "backdrop"].includes(String(binding.source)) ||
        (port.kind === "mask" && binding.source !== "mask") ||
        (port.kind === "texture-2d" && binding.source === "mask")
      )
        errors.push(
          `${prefix}.bindings.${name} builtin source is incompatible`,
        );
    } else if (binding.kind === "authored-node") {
      if (
        typeof binding.nodeId !== "string" ||
        !ID_RE.test(binding.nodeId) ||
        !["content", "appearance"].includes(String(binding.capture))
      )
        errors.push(`${prefix}.bindings.${name} authored node is invalid`);
    } else if (binding.kind === "asset") {
      const asset = checkEffectAssetUrl(binding.url);
      if (!asset.ok)
        errors.push(
          `${prefix}.bindings.${name} asset needs a same-origin root path (${asset.reason})`,
        );
    } else {
      errors.push(`${prefix}.bindings.${name} kind is invalid`);
    }
  }
}

function validateTextureBindingConflicts(
  params: unknown,
  bindings: unknown,
  definition: EffectDefinition | undefined,
  prefix: string,
  errors: string[],
): void {
  if (!record(params) || !record(bindings) || !definition) return;
  for (const [name, property] of Object.entries(definition.properties)) {
    if (property.type !== "texture") continue;
    const value = Object.prototype.hasOwnProperty.call(params, name)
      ? params[name]
      : property.default;
    if (
      value !== null &&
      Object.prototype.hasOwnProperty.call(bindings, property.input)
    )
      errors.push(
        `${prefix} texture property "${name}" conflicts with input binding "${property.input}"`,
      );
  }
}

function validateValue(
  prop: EffectProperty,
  value: unknown,
  name: string,
  errors: string[],
): void {
  switch (prop.type) {
    case "float":
    case "int":
      if (
        !finite(value) ||
        (prop.type === "int" && !Number.isInteger(value)) ||
        (prop.min !== undefined && value < prop.min) ||
        (prop.max !== undefined && value > prop.max)
      ) {
        errors.push(
          `property "${name}" needs a finite ${prop.type} within bounds`,
        );
      }
      break;
    case "bool":
      if (typeof value !== "boolean")
        errors.push(`property "${name}" needs a boolean`);
      break;
    case "enum":
      if (typeof value !== "string" || !prop.options.includes(value)) {
        errors.push(`property "${name}" needs one of its options`);
      }
      break;
    case "color":
      if (!validColor(value))
        errors.push(`property "${name}" needs a normalized color`);
      break;
    case "vec2":
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !value.every(finite) ||
        (prop.min !== undefined && value.some((part) => part < prop.min!)) ||
        (prop.max !== undefined && value.some((part) => part > prop.max!))
      ) {
        errors.push(
          `property "${name}" needs two finite numbers within bounds`,
        );
      }
      break;
    case "position":
      if (!isNativePositionValue(value))
        errors.push(`property "${name}" needs a bounded 2D position`);
      break;
    case "color-array":
      if (
        !Array.isArray(value) ||
        value.length > prop.maxCount ||
        !value.every(validColor)
      ) {
        errors.push(
          `property "${name}" needs at most ${prop.maxCount} normalized colors`,
        );
      }
      break;
    case "texture":
      if (value !== null) {
        if (!record(value) || value.kind !== "asset") {
          errors.push(
            `property "${name}" needs a same-origin texture asset or null`,
          );
        } else {
          const asset = checkEffectAssetUrl(value.url);
          if (!asset.ok)
            errors.push(
              `property "${name}" needs a same-origin texture asset or null (${asset.reason})`,
            );
        }
      }
      break;
  }
}

export function propertySlots(prop: EffectProperty): number {
  if (prop.type === "texture") return 0;
  return prop.type === "color-array" ? 1 + prop.maxCount : 1;
}

function validatePorts(
  value: unknown,
  prefix: string,
  resources: unknown,
  errors: string[],
  isInput: boolean,
  optionalImagePort?: string,
): void {
  if (value === undefined) return;
  if (!record(value) || Object.keys(value).length > 32) {
    errors.push(`${prefix} must contain at most 32 named ports`);
    return;
  }
  const resourceNames = Array.isArray(resources)
    ? new Set(
        resources.map((resource) =>
          record(resource) ? resource.name : undefined,
        ),
      )
    : null;
  for (const [name, unknownPort] of Object.entries(value)) {
    if (
      !PROPERTY_RE.test(name) ||
      !record(unknownPort) ||
      ![
        "float",
        "int",
        "bool",
        "vec2",
        "color",
        "texture-2d",
        "mask",
        "buffer",
        "signal",
      ].includes(String(unknownPort.kind)) ||
      (unknownPort.optional !== undefined &&
        typeof unknownPort.optional !== "boolean")
    ) {
      errors.push(`${prefix}.${name} is invalid`);
      continue;
    }
    const needsResource = ["texture-2d", "mask", "buffer"].includes(
      String(unknownPort.kind),
    );
    if (
      needsResource &&
      (typeof unknownPort.resource !== "string" ||
        !resourceNames?.has(unknownPort.resource))
    ) {
      errors.push(`${prefix}.${name} needs a declared resource`);
    }
    if (!needsResource && unknownPort.resource !== undefined) {
      errors.push(`${prefix}.${name} cannot bind a texture/buffer resource`);
    }
    const resource = Array.isArray(resources)
      ? (resources.find(
          (candidate) =>
            record(candidate) && candidate.name === unknownPort.resource,
        ) as EffectResourceSpec | undefined)
      : undefined;
    if (
      resource &&
      ((unknownPort.kind === "buffer" && resource.kind !== "buffer") ||
        (["texture-2d", "mask"].includes(String(unknownPort.kind)) &&
          resource.kind !== "texture-2d"))
    ) {
      errors.push(`${prefix}.${name} resource kind does not match port kind`);
    }
    if (
      unknownPort.fallback !== undefined &&
      (!isInput ||
        unknownPort.fallback !== "transparent-data" ||
        unknownPort.optional !== true ||
        !["texture-2d", "mask"].includes(String(unknownPort.kind)) ||
        !(
          resource?.preprocess === "paper-liquid-mask" ||
          (name === optionalImagePort &&
            resource?.name === "image" &&
            (resource.sampleEncoding === "srgb-encoded-straight" ||
              resource.sampleEncoding === "linear-data"))
        ))
    )
      errors.push(`${prefix}.${name} has an unsupported input fallback`);
  }
}

function validateProperties(
  properties: unknown,
  prefix: string,
  errors: string[],
): void {
  if (!record(properties)) {
    errors.push(`${prefix}.properties must be an object`);
    return;
  }
  if (Object.keys(properties).length > 64)
    errors.push(`${prefix}.properties must contain at most 64 entries`);
  let slots = 0;
  for (const [name, unknownProp] of Object.entries(properties)) {
    if (!PROPERTY_RE.test(name))
      errors.push(`${prefix} property name "${name}" is invalid`);
    if (!record(unknownProp)) {
      errors.push(`${prefix} property "${name}" must be an object`);
      continue;
    }
    const prop = unknownProp as unknown as EffectProperty;
    if (
      ![
        "float",
        "int",
        "bool",
        "enum",
        "color",
        "vec2",
        "position",
        "color-array",
        "texture",
      ].includes(prop.type)
    ) {
      errors.push(`${prefix} property "${name}" has unsupported type`);
      continue;
    }
    if (
      typeof prop.label !== "string" ||
      !prop.label.trim() ||
      prop.label.length > 80
    ) {
      errors.push(`${prefix} property "${name}" needs a label ≤ 80 characters`);
    }
    if ("min" in prop && prop.min !== undefined && !finite(prop.min))
      errors.push(`${prefix} property "${name}" min must be finite`);
    if ("max" in prop && prop.max !== undefined && !finite(prop.max))
      errors.push(`${prefix} property "${name}" max must be finite`);
    if (
      "min" in prop &&
      "max" in prop &&
      prop.min !== undefined &&
      prop.max !== undefined &&
      prop.min > prop.max
    ) {
      errors.push(`${prefix} property "${name}" min exceeds max`);
    }
    if (
      "step" in prop &&
      prop.step !== undefined &&
      (!finite(prop.step) || prop.step <= 0)
    ) {
      errors.push(`${prefix} property "${name}" step must be positive`);
    }
    if (
      "displayScale" in prop &&
      prop.displayScale !== undefined &&
      (!finite(prop.displayScale) ||
        prop.displayScale <= 0 ||
        prop.displayScale > 1_000_000)
    ) {
      errors.push(
        `${prefix} property "${name}" displayScale must be positive and finite`,
      );
    }
    if (
      prop.type === "enum" &&
      (!Array.isArray(prop.options) ||
        !prop.options.length ||
        prop.options.length > 32 ||
        !prop.options.every(
          (option) =>
            typeof option === "string" && !!option && option.length <= 80,
        ) ||
        new Set(prop.options).size !== prop.options.length)
    ) {
      errors.push(`${prefix} property "${name}" needs distinct enum options`);
    }
    if (
      prop.type === "color-array" &&
      (!Number.isInteger(prop.maxCount) ||
        prop.maxCount < 1 ||
        prop.maxCount > MAX_COLOR_ARRAY)
    ) {
      errors.push(
        `${prefix} property "${name}" maxCount must be 1–${MAX_COLOR_ARRAY}`,
      );
      continue;
    }
    if (
      prop.type === "position" &&
      prop.basis !== "source" &&
      prop.basis !== "viewport"
    )
      errors.push(`${prefix} property "${name}" needs a position basis`);
    if (prop.rebuild !== undefined && typeof prop.rebuild !== "boolean")
      errors.push(`${prefix} property "${name}" rebuild must be boolean`);
    if (prop.advanced !== undefined && typeof prop.advanced !== "boolean")
      errors.push(`${prefix} property "${name}" advanced must be boolean`);
    if (
      prop.group !== undefined &&
      (typeof prop.group !== "string" || prop.group.length > 80)
    )
      errors.push(`${prefix} property "${name}" group is invalid`);
    if (
      "unit" in prop &&
      prop.unit !== undefined &&
      (typeof prop.unit !== "string" || prop.unit.length > 32)
    )
      errors.push(`${prefix} property "${name}" unit is invalid`);
    if (
      prop.type === "texture" &&
      (typeof prop.input !== "string" || !PROPERTY_RE.test(prop.input))
    )
      errors.push(`${prefix} property "${name}" needs a named texture input`);
    if (prop.type !== "enum" || Array.isArray(prop.options))
      validateValue(prop, prop.default, name, errors);
    slots += propertySlots(prop);
  }
  for (const [name, candidate] of Object.entries(properties)) {
    if (!record(candidate) || candidate.visibleWhen === undefined) continue;
    const condition = candidate.visibleWhen;
    if (
      !record(condition) ||
      typeof condition.property !== "string" ||
      condition.property === name ||
      !Object.prototype.hasOwnProperty.call(properties, condition.property)
    ) {
      errors.push(
        `${prefix} property "${name}" has an invalid visibility condition`,
      );
      continue;
    }
    const dependency = properties[condition.property];
    if (
      !record(dependency) ||
      !["bool", "enum", "int", "float"].includes(String(dependency.type)) ||
      !["boolean", "string", "number"].includes(typeof condition.equals) ||
      (dependency.type === "bool" && typeof condition.equals !== "boolean") ||
      (dependency.type === "enum" &&
        (!Array.isArray(dependency.options) ||
          !dependency.options.includes(condition.equals))) ||
      (["int", "float"].includes(String(dependency.type)) &&
        (!finite(condition.equals) ||
          (dependency.type === "int" && !Number.isInteger(condition.equals))))
    )
      errors.push(
        `${prefix} property "${name}" visibility condition mismatches its dependency`,
      );
  }
  for (const name of Object.keys(properties)) {
    const seen = new Set<string>();
    let current = name;
    while (true) {
      const property = properties[current];
      if (!record(property) || !record(property.visibleWhen)) break;
      const next = property.visibleWhen.property;
      if (
        typeof next !== "string" ||
        !Object.prototype.hasOwnProperty.call(properties, next)
      )
        break;
      if (seen.has(next) || next === name) {
        errors.push(`${prefix} property "${name}" has a visibility cycle`);
        break;
      }
      seen.add(next);
      current = next;
    }
  }
  if (slots > MAX_PROPERTY_SLOTS)
    errors.push(
      `${prefix} properties need ${slots} vec4 slots; max is ${MAX_PROPERTY_SLOTS}`,
    );
}

function validateDefinition(
  value: unknown,
  index: number,
  errors: string[],
): value is EffectDefinition {
  const prefix = `definition[${index}]`;
  if (!record(value)) {
    errors.push(`${prefix} must be an object`);
    return false;
  }
  if (typeof value.id !== "string" || !ID_RE.test(value.id))
    errors.push(`${prefix}.id is invalid`);
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 80
  )
    errors.push(`${prefix}.name is invalid`);
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    errors.push(`${prefix}.version must be a positive integer`);
  }
  if (!["generator", "processor", "simulation"].includes(String(value.kind)))
    errors.push(`${prefix}.kind is invalid`);
  if (
    value.sourceSizing !== undefined &&
    (value.kind !== "processor" ||
      !record(value.sourceSizing) ||
      Object.keys(value.sourceSizing).some(
        (key) =>
          key !== "uv" &&
          key !== "intrinsicEncoding" &&
          key !== "defaultSampling",
      ) ||
      value.sourceSizing.uv !== "paper-image" ||
      (value.sourceSizing.intrinsicEncoding !== undefined &&
        value.sourceSizing.intrinsicEncoding !== "srgb-encoded-straight") ||
      (value.sourceSizing.defaultSampling !== undefined &&
        (!record(value.sourceSizing.defaultSampling) ||
          Object.keys(value.sourceSizing.defaultSampling).length !== 3 ||
          value.sourceSizing.defaultSampling.min !== "linear" ||
          value.sourceSizing.defaultSampling.mag !== "linear" ||
          value.sourceSizing.defaultSampling.mipmap !== "linear" ||
          value.sourceSizing.intrinsicEncoding !== "srgb-encoded-straight")) ||
      !Array.isArray(value.passes) ||
      value.passes.length !== 1 ||
      value.passes[0]?.kind !== "render" ||
      !value.passes[0]?.reads?.includes("source"))
  )
    errors.push(
      `${prefix}.sourceSizing ABI needs one source-reading processor render pass`,
    );
  if (
    record(value.sourceSizing) &&
    value.sourceSizing.intrinsicEncoding === "srgb-encoded-straight"
  ) {
    const source = Array.isArray(value.resources)
      ? value.resources.find(
          (resource: unknown) => record(resource) && resource.name === "source",
        )
      : undefined;
    if (
      !record(source) ||
      source.kind !== "texture-2d" ||
      source.external !== true ||
      source.sampleEncoding !== "srgb-encoded-straight"
    )
      errors.push(
        `${prefix}.sourceSizing intrinsic source needs an encoded-straight external texture`,
      );
  }
  if (value.optionalImage !== undefined) {
    if (value.sourceSizing !== undefined)
      errors.push(`${prefix}.optionalImage cannot share sourceSizing UV rows`);
    if (
      ["imageMeta", "imagePresent", "intrinsicAspect"].some((key) =>
        Object.prototype.hasOwnProperty.call(value, key),
      )
    )
      errors.push(`${prefix}.optionalImage metadata is runtime-resolved`);
    const contract = value.optionalImage;
    const imageInput = record(value.inputs) ? value.inputs.image : undefined;
    const imageResource = Array.isArray(value.resources)
      ? value.resources.find(
          (resource: unknown) => record(resource) && resource.name === "image",
        )
      : undefined;
    const noiseInput = record(value.inputs) ? value.inputs.noise : undefined;
    const noiseResource = Array.isArray(value.resources)
      ? value.resources.find(
          (resource: unknown) => record(resource) && resource.name === "noise",
        )
      : undefined;
    const imageProperties = record(value.properties)
      ? Object.values(value.properties).filter(
          (property) =>
            record(property) &&
            property.type === "texture" &&
            property.input === "image",
        )
      : [];
    const imageSizingProperties = record(value.properties)
      ? value.properties
      : {};
    const fitProperty = imageSizingProperties.fit;
    const fitOptions =
      record(fitProperty) && Array.isArray(fitProperty.options)
        ? fitProperty.options
        : null;
    const sizedFloat = (name: string, min: number, max: number) => {
      const property = imageSizingProperties[name];
      return (
        record(property) &&
        property.type === "float" &&
        finite(property.default) &&
        property.default >= min &&
        property.default <= max &&
        finite(property.min) &&
        property.min >= min &&
        finite(property.max) &&
        property.max <= max
      );
    };
    const imageSizingValid =
      record(fitProperty) &&
      fitProperty.type === "enum" &&
      fitOptions?.length === 3 &&
      ["none", "contain", "cover"].every((option) =>
        fitOptions.includes(option),
      ) &&
      sizedFloat("scale", 0.01, 8) &&
      sizedFloat("rotation", 0, 360) &&
      sizedFloat("originX", 0, 1) &&
      sizedFloat("originY", 0, 1) &&
      sizedFloat("offsetX", -1, 1) &&
      sizedFloat("offsetY", -1, 1);
    const readsImage =
      Array.isArray(value.passes) &&
      value.passes.length === 1 &&
      value.passes[0]?.kind === "render" &&
      Array.isArray(value.passes[0]?.reads) &&
      value.passes[0].reads[0] === "image" &&
      value.passes[0].reads.length <= 2;
    const secondRead =
      Array.isArray(value.passes) && Array.isArray(value.passes[0]?.reads)
        ? value.passes[0].reads[1]
        : undefined;
    const noiseValid =
      secondRead === undefined ||
      (secondRead === "noise" &&
        record(noiseInput) &&
        noiseInput.kind === "texture-2d" &&
        noiseInput.resource === "noise" &&
        noiseInput.fallback === undefined &&
        record(noiseResource) &&
        noiseResource.kind === "texture-2d" &&
        noiseResource.external === true &&
        noiseResource.sampleEncoding === "linear-data" &&
        noiseResource.preprocess === undefined &&
        noiseResource.mipmap === undefined);
    if (
      !record(contract) ||
      Object.keys(contract).length !== 2 ||
      contract.port !== "image" ||
      contract.abi !== "paper-optional-image-v1" ||
      value.kind !== "generator" ||
      !record(imageInput) ||
      imageInput.kind !== "texture-2d" ||
      imageInput.resource !== "image" ||
      imageInput.optional !== true ||
      imageInput.fallback !== "transparent-data" ||
      !record(imageResource) ||
      imageResource.kind !== "texture-2d" ||
      imageResource.external !== true ||
      !(
        (imageResource.sampleEncoding === "srgb-encoded-straight" ||
          imageResource.sampleEncoding === "linear-data") &&
        (imageResource.preprocess === undefined ||
          (imageResource.sampleEncoding === "linear-data" &&
            imageResource.preprocess === "paper-gem-smoke-mask-32" &&
            imageResource.mipmap === "generated"))
      ) ||
      imageProperties.length !== 1 ||
      !record(imageProperties[0]) ||
      imageProperties[0].default !== null ||
      !imageSizingValid ||
      !readsImage ||
      !noiseValid
    )
      errors.push(
        `${prefix}.optionalImage needs one optional image asset input and one image-reading render pass`,
      );
  }
  if (
    value.optionalImage === undefined &&
    Array.isArray(value.resources) &&
    value.resources.some(
      (resource: unknown) =>
        record(resource) &&
        resource.name === "image" &&
        (resource.sampleEncoding === "srgb-encoded-straight" ||
          resource.sampleEncoding === "linear-data"),
    )
  )
    errors.push(`${prefix}.image resource needs the optional-image ABI`);
  if (
    !Array.isArray(value.placements) ||
    !value.placements.length ||
    !value.placements.every((placement) =>
      ["fill", "layer", "backdrop"].includes(placement),
    ) ||
    new Set(value.placements).size !== value.placements.length
  )
    errors.push(`${prefix}.placements are invalid`);
  if (value.extent !== undefined) {
    const extent = value.extent;
    if (
      !record(extent) ||
      Object.keys(extent).some((key) => key !== "source" && key !== "output") ||
      !Object.keys(extent).length
    ) {
      errors.push(`${prefix}.extent is invalid`);
    } else {
      for (const [kind, insets] of Object.entries(extent)) {
        if (
          !record(insets) ||
          Object.keys(insets).length !== 4 ||
          ["top", "right", "bottom", "left"].some(
            (side) =>
              !Object.prototype.hasOwnProperty.call(insets, side) ||
              typeof insets[side] !== "number" ||
              !Number.isFinite(insets[side]) ||
              (insets[side] as number) < 0 ||
              (insets[side] as number) > 128,
          )
        )
          errors.push(
            `${prefix}.extent.${kind} needs four bounded CSS-pixel sides`,
          );
      }
    }
  }
  if (value.statelessCompute !== undefined) {
    if (
      !record(value.statelessCompute) ||
      value.statelessCompute.abi !== "source-buffer-v1" ||
      value.kind !== "processor" ||
      value.simulation !== undefined ||
      value.feedback !== undefined ||
      value.extent !== undefined ||
      value.sourceSizing !== undefined ||
      value.optionalImage !== undefined
    )
      errors.push(
        `${prefix}.statelessCompute: stateless-compute-definition-invalid`,
      );
    if (
      record(value.statelessCompute) &&
      Array.isArray(value.passes) &&
      record(value.properties)
    ) {
      const dispatch = value.passes[0]?.dispatch;
      if (
        isStatelessComputeDispatch(dispatch) &&
        dispatch.elements === "source-row-blocks"
      ) {
        const property = value.properties[dispatch.blockProperty];
        if (
          !record(property) ||
          property.type !== "int" ||
          typeof property.min !== "number" ||
          property.min < 1 ||
          typeof property.max !== "number" ||
          property.max > 16
        )
          errors.push(
            `${prefix}.statelessCompute: stateless-compute-definition-invalid`,
          );
      }
    }
  }
  if (value.simulation !== undefined) {
    const simulation = value.simulation;
    const count = record(simulation) ? simulation.count : undefined;
    const tiers = record(count) ? count.tiers : undefined;
    const idlePointer = record(simulation) ? simulation.idlePointer : undefined;
    const stateResource =
      record(simulation) && Array.isArray(value.resources)
        ? value.resources?.find(
            (resource: unknown) =>
              record(resource) && resource.name === simulation.stateResource,
          )
        : undefined;
    const countProperty =
      record(simulation) && record(count) && record(value.properties)
        ? value.properties[String(count.property)]
        : undefined;
    if (
      value.kind !== "simulation" ||
      !record(simulation) ||
      Object.keys(simulation).some(
        (key) =>
          ![
            "fixedDt",
            "stateResource",
            "bytesPerParticle",
            "count",
            "maxInteractiveSteps",
            "maxDeterministicSteps",
            "idlePointer",
          ].includes(key),
      ) ||
      simulation.fixedDt !== 1 / 120 ||
      simulation.bytesPerParticle !== 32 ||
      simulation.maxInteractiveSteps !== 8 ||
      simulation.maxDeterministicSteps !== 512 ||
      !record(count) ||
      Object.keys(count).some((key) => key !== "property" && key !== "tiers") ||
      !record(tiers) ||
      Object.keys(tiers).length !== 3 ||
      tiers.low !== 10000 ||
      tiers.medium !== 25000 ||
      tiers.high !== 50000 ||
      !record(countProperty) ||
      countProperty.type !== "enum" ||
      !Array.isArray(countProperty.options) ||
      !["low", "medium", "high"].every((tier) =>
        (countProperty.options as unknown[]).includes(tier),
      ) ||
      !record(idlePointer) ||
      Object.keys(idlePointer).length !== 2 ||
      ![idlePointer.x, idlePointer.y].every(
        (coordinate) =>
          typeof coordinate === "number" &&
          Number.isFinite(coordinate) &&
          coordinate >= 0 &&
          coordinate <= 1,
      ) ||
      stateResource?.kind !== "buffer" ||
      !stateResource.persistent ||
      !stateResource.usage?.includes("storage") ||
      !stateResource.byteLength ||
      stateResource.byteLength < 50000 * 32 ||
      stateResource.byteLength > 16_777_216
    )
      errors.push(`${prefix}.simulation is invalid or unbounded`);
  } else if (value.kind === "simulation") {
    errors.push(`${prefix}.simulation is required`);
  }
  if (value.feedback !== undefined) {
    const feedback = value.feedback;
    const grid = record(feedback) ? feedback.grid : undefined;
    const timing = record(feedback) ? feedback.timing : undefined;
    const properties = record(value.properties) ? value.properties : {};
    const boundedFloat = (name: string, min: number, max: number): boolean => {
      const property = properties[name];
      return (
        record(property) &&
        property.type === "float" &&
        property.min === min &&
        property.max === max &&
        finite(property.default) &&
        property.default >= min &&
        property.default <= max
      );
    };
    const uniformProperties =
      record(feedback) && record(feedback.uniformProperties)
        ? feedback.uniformProperties
        : undefined;
    const aliasesValid =
      uniformProperties === undefined ||
      (Object.keys(uniformProperties).every(
        (slot) =>
          FEEDBACK_UNIFORM_SLOTS.includes(
            slot as (typeof FEEDBACK_UNIFORM_SLOTS)[number],
          ) &&
          typeof uniformProperties[slot] === "string" &&
          PROPERTY_RE.test(uniformProperties[slot]),
      ) &&
        new Set(
          FEEDBACK_UNIFORM_SLOTS.map((slot) => uniformProperties[slot] ?? slot),
        ).size === FEEDBACK_UNIFORM_SLOTS.length);
    const resolvedProperties =
      aliasesValid && record(feedback)
        ? feedbackUniformProperties(feedback as unknown as EffectFeedbackSpec)
        : undefined;
    if (
      value.kind !== "processor" ||
      !Array.isArray(value.placements) ||
      !value.placements.every((placement) =>
        ["layer", "backdrop"].includes(String(placement)),
      ) ||
      value.simulation !== undefined ||
      value.optionalImage !== undefined ||
      value.sourceSizing !== undefined ||
      !record(feedback) ||
      Object.keys(feedback).length !==
        (uniformProperties === undefined ? 5 : 6) ||
      !aliasesValid ||
      feedback.abi !== "texture-feedback-v1" ||
      !record(grid) ||
      Object.keys(grid).length !== 4 ||
      !Number.isSafeInteger(grid.width) ||
      !Number.isSafeInteger(grid.height) ||
      (grid.width as number) < 1 ||
      (grid.height as number) < 1 ||
      (grid.width as number) > 2048 ||
      (grid.height as number) > 2048 ||
      (grid.width as number) * (grid.height as number) > 2_097_152 ||
      grid.format !== "rgba16float" ||
      !Array.isArray(grid.workgroup) ||
      grid.workgroup.length !== 2 ||
      grid.workgroup[0] !== 8 ||
      grid.workgroup[1] !== 8 ||
      !record(timing) ||
      Object.keys(timing).length !== 3 ||
      !finite(timing.fixedDt) ||
      timing.fixedDt < 1 / 240 ||
      timing.fixedDt > 1 / 15 ||
      !Number.isSafeInteger(timing.maxStepsPerCall) ||
      (timing.maxStepsPerCall as number) < 1 ||
      (timing.maxStepsPerCall as number) > 512 ||
      !Number.isSafeInteger(timing.maxStepIndex) ||
      (timing.maxStepIndex as number) < 0 ||
      (timing.maxStepIndex as number) > 36_000 ||
      typeof feedback.stateResource !== "string" ||
      !PROPERTY_RE.test(feedback.stateResource) ||
      typeof feedback.displayResource !== "string" ||
      !PROPERTY_RE.test(feedback.displayResource) ||
      feedback.stateResource === feedback.displayResource ||
      !boundedFloat(resolvedProperties?.intensity ?? "intensity", 0, 1) ||
      !boundedFloat(resolvedProperties?.blockSize ?? "blockSize", 30, 150) ||
      !boundedFloat(resolvedProperties?.drift ?? "drift", 0, 1) ||
      !boundedFloat(resolvedProperties?.churn ?? "churn", 0, 1) ||
      !boundedFloat(resolvedProperties?.blend ?? "blend", 0, 1) ||
      (uniformProperties !== undefined &&
        !boundedFloat(resolvedProperties?.seed ?? "seed", 0, 100))
    )
      errors.push(`${prefix}.feedback is invalid or unbounded`);
  }
  validateProperties(value.properties, prefix, errors);
  errors.push(
    ...validateParameterConstraintDefinitions(
      value.parameterConstraints,
      value.properties,
    ).map((error) => `${prefix}.${error}`),
  );
  const provenance = value.provenance;
  if (
    !record(provenance) ||
    !["design-original", "user-authored", "imported"].includes(
      String(provenance.origin),
    ) ||
    (provenance.note !== undefined &&
      (typeof provenance.note !== "string" || provenance.note.length > 240))
  ) {
    errors.push(`${prefix}.provenance is invalid`);
  } else if (
    provenance.origin === "imported" &&
    !validImportedUpstream(provenance.upstream)
  ) {
    errors.push(
      `${prefix}.provenance imported source needs repository, commit, file, and license`,
    );
  }
  validatePorts(
    value.inputs,
    `${prefix}.inputs`,
    value.resources,
    errors,
    true,
    record(value.optionalImage) && value.optionalImage.port === "image"
      ? "image"
      : undefined,
  );
  validatePorts(
    value.outputs,
    `${prefix}.outputs`,
    value.resources,
    errors,
    false,
  );
  if (record(value.properties))
    for (const [name, candidate] of Object.entries(value.properties)) {
      if (!record(candidate) || candidate.type !== "texture") continue;
      const port =
        record(value.inputs) && typeof candidate.input === "string"
          ? value.inputs[candidate.input]
          : undefined;
      if (!record(port) || !["texture-2d", "mask"].includes(String(port.kind)))
        errors.push(
          `${prefix} texture property "${name}" needs a matching texture or mask input`,
        );
    }
  if (
    value.output !== undefined &&
    (typeof value.output !== "string" ||
      (record(value.outputs) &&
        !Object.values(value.outputs).some(
          (port) => record(port) && port.resource === value.output,
        )))
  ) {
    errors.push(`${prefix}.output needs a matching named output port`);
  }
  if (
    !Array.isArray(value.passes) ||
    !value.passes.length ||
    value.passes.length > 16
  ) {
    errors.push(`${prefix}.passes must contain 1–16 passes`);
  } else {
    if (value.simulation) {
      const computePasses = value.passes.filter(
        (pass: EffectPass) => pass.kind === "compute",
      );
      const renderPasses = value.passes.filter(
        (pass: EffectPass) => pass.kind === "render",
      );
      const stateName = record(value.simulation)
        ? value.simulation.stateResource
        : undefined;
      if (
        computePasses.length !== 1 ||
        renderPasses.length !== 2 ||
        computePasses[0]?.output !== stateName ||
        !computePasses[0]?.previousFrameReads?.includes(String(stateName)) ||
        !renderPasses[0]?.reads.includes(String(stateName)) ||
        !renderPasses[0]?.draw ||
        !!renderPasses[1]?.draw ||
        !renderPasses[1]?.reads.includes(renderPasses[0].output) ||
        !renderPasses[1]?.previousFrameReads?.includes(
          renderPasses[1].output,
        ) ||
        value.output !== renderPasses[1]?.output
      )
        errors.push(
          `${prefix}.simulation needs state compute, instanced particles, and a persistent trail pass`,
        );
    } else if (
      !value.feedback &&
      !value.statelessCompute &&
      value.passes.some(
        (pass: EffectPass) =>
          pass.dispatch || pass.draw || pass.additionalOutputs,
      )
    ) {
      errors.push(
        `${prefix}.passes use compute dispatch, draw, or extra outputs without an opt-in ABI`,
      );
    }
    for (const [passIndex, pass] of value.passes.entries()) {
      if (
        !record(pass) ||
        typeof pass.id !== "string" ||
        typeof pass.output !== "string" ||
        typeof pass.wgsl !== "string" ||
        !pass.wgsl.trim() ||
        pass.wgsl.length > 32_000 ||
        !Array.isArray(pass.reads) ||
        pass.reads.length > 16 ||
        !pass.reads.every((read) => typeof read === "string") ||
        new Set(pass.reads).size !== pass.reads.length ||
        (pass.previousFrameReads !== undefined &&
          (!Array.isArray(pass.previousFrameReads) ||
            pass.previousFrameReads.length > 16 ||
            !pass.previousFrameReads.every(
              (read) => typeof read === "string",
            ) ||
            new Set(pass.previousFrameReads).size !==
              pass.previousFrameReads.length)) ||
        (pass.persistent !== undefined &&
          typeof pass.persistent !== "boolean") ||
        (pass.additionalOutputs !== undefined &&
          (!Array.isArray(pass.additionalOutputs) ||
            pass.additionalOutputs.length !== 1 ||
            !pass.additionalOutputs.every(
              (output) => typeof output === "string",
            ))) ||
        (pass.dispatch !== undefined &&
          (!record(pass.dispatch) ||
            (!isStatelessComputeDispatch(pass.dispatch) &&
              Object.keys(pass.dispatch).length !== 2) ||
            pass.kind !== "compute" ||
            !(
              (pass.dispatch.workgroupSize === 256 &&
                pass.dispatch.elements === "simulation-count") ||
              (value.feedback &&
                Array.isArray(pass.dispatch.workgroupSize) &&
                pass.dispatch.workgroupSize.length === 2 &&
                pass.dispatch.workgroupSize[0] === 8 &&
                pass.dispatch.workgroupSize[1] === 8 &&
                pass.dispatch.elements === "fixed-grid") ||
              (value.statelessCompute &&
                isStatelessComputeDispatch(pass.dispatch))
            ))) ||
        (pass.draw !== undefined &&
          (!record(pass.draw) ||
            Object.keys(pass.draw).length !== 2 ||
            pass.kind !== "render" ||
            pass.draw.vertices !== 6 ||
            pass.draw.instances !== "simulation-count"))
      ) {
        errors.push(`${prefix}.passes[${passIndex}] is malformed`);
      } else {
        if (pass.original !== undefined) {
          if (!record(pass.original))
            errors.push(
              `${prefix}.passes[${passIndex}] retired original metadata is invalid`,
            );
        }
        if (value.simulation && pass.kind === "compute" && !pass.dispatch)
          errors.push(`${prefix}.passes[${passIndex}] needs bounded dispatch`);
        if (
          pass.kind === "render" &&
          pass.original === undefined &&
          (!/@vertex\s+fn\s+vs\s*\(/.test(pass.wgsl) ||
            !/@fragment\s+fn\s+fs\s*\(/.test(pass.wgsl))
        ) {
          errors.push(
            `${prefix}.passes[${passIndex}] must expose vertex vs and fragment fs`,
          );
        }
        if (
          pass.kind === "compute" &&
          !/@compute(?:\s*@workgroup_size\s*\([^)]*\))?\s+fn\s+cs\s*\(/.test(
            pass.wgsl,
          )
        ) {
          errors.push(`${prefix}.passes[${passIndex}] must expose compute cs`);
        }
      }
    }
    const hasRetiredExecution =
      value.passes.some((pass: EffectPass) => pass.original !== undefined) ||
      (Array.isArray(value.resources) &&
        value.resources.some(
          (resource: EffectResourceSpec) => resource.preprocess !== undefined,
        ));
    if (
      (!hasRetiredExecution || value.statelessCompute !== undefined) &&
      !errors.some((error) => error.startsWith(`${prefix}.passes[`))
    ) {
      errors.push(
        ...planEffectGraph(
          value as unknown as {
            passes: EffectPass[];
            resources?: EffectResourceSpec[];
            output?: string;
          },
        ).errors.map((error) => `${prefix}: ${error}`),
      );
    }
  }
  return !errors.some((error) => error.startsWith(prefix));
}

function validateInstance(
  value: unknown,
  index: number,
  definitions: Map<string, EffectDefinition>,
  errors: string[],
): value is EffectInstance {
  const prefix = `instance[${index}]`;
  if (!record(value)) {
    errors.push(`${prefix} must be an object`);
    return false;
  }
  if (typeof value.id !== "string" || !ID_RE.test(value.id))
    errors.push(`${prefix}.id is invalid`);
  if (typeof value.nodeId !== "string" || !ID_RE.test(value.nodeId))
    errors.push(`${prefix}.nodeId is invalid`);
  const definition = definitions.get(
    definitionKey(String(value.definitionId), Number(value.definitionVersion)),
  );
  if (!definition)
    errors.push(
      `${prefix}.definitionId and definitionVersion have no matching definition`,
    );
  if (
    definition?.optionalImage &&
    ["imageMeta", "imagePresent", "intrinsicAspect"].some((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  )
    errors.push(`${prefix}.optionalImage metadata is runtime-resolved`);
  if (
    !Number.isSafeInteger(value.definitionVersion) ||
    (value.definitionVersion as number) < 1
  )
    errors.push(`${prefix}.definitionVersion must be a positive integer`);
  if (
    !["fill", "layer", "backdrop"].includes(String(value.placement)) ||
    (definition &&
      !definition.placements.includes(
        value.placement as EffectInstance["placement"],
      ))
  ) {
    errors.push(`${prefix}.placement is not supported by its definition`);
  }
  if (!record(value.params)) errors.push(`${prefix}.params must be an object`);
  else if (definition && record(definition.properties)) {
    for (const [name, param] of Object.entries(value.params)) {
      const prop = Object.prototype.hasOwnProperty.call(
        definition.properties,
        name,
      )
        ? definition.properties[name]
        : undefined;
      if (!prop)
        errors.push(`${prefix}.params contains unknown property "${name}"`);
      else validateValue(prop, param, name, errors);
    }
  }
  if (typeof value.enabled !== "boolean")
    errors.push(`${prefix}.enabled must be boolean`);
  if (!finiteUnit(value.opacity))
    errors.push(`${prefix}.opacity must be within 0–1`);
  if (
    typeof value.seed !== "number" ||
    !Number.isSafeInteger(value.seed) ||
    value.seed < 0 ||
    value.seed > 1_000_000
  )
    errors.push(`${prefix}.seed must be an integer within 0–1000000`);
  if (value.clip !== "bounds" && value.clip !== "text")
    errors.push(`${prefix}.clip is invalid`);
  if (value.blend !== "normal") errors.push(`${prefix}.blend must be normal`);
  if (
    !record(value.timing) ||
    !isFiniteNativeUniformTiming(value.timing.speed) ||
    value.timing.speed < 0 ||
    typeof value.timing.paused !== "boolean" ||
    !isFiniteNativeUniformTiming(value.timing.time) ||
    value.timing.time < 0 ||
    (value.timing.seekRevision !== undefined &&
      (typeof value.timing.seekRevision !== "number" ||
        !Number.isSafeInteger(value.timing.seekRevision) ||
        value.timing.seekRevision < 0))
  ) {
    errors.push(`${prefix}.timing is invalid`);
  }
  if (definition && record(value.params))
    errors.push(
      ...validateResolvedParameterConstraints(
        definition.parameterConstraints,
        definition.properties,
        value.params,
      ).map((error) => `${prefix}.${error}`),
    );
  validateBindings(value.bindings, definition, prefix, errors);
  validateTransform(value.transform, prefix, errors);
  validateSourceSizing(value.sourceSizing, definition, prefix, errors);
  validateTextureBindingConflicts(
    value.params,
    value.bindings,
    definition,
    prefix,
    errors,
  );
  return !errors.some((error) => error.startsWith(prefix));
}

function validatePreset(
  value: unknown,
  index: number,
  definitions: Map<string, EffectDefinition>,
  errors: string[],
): value is EffectPreset {
  const prefix = `preset[${index}]`;
  if (!record(value)) {
    errors.push(`${prefix} must be an object`);
    return false;
  }
  if (typeof value.id !== "string" || !ID_RE.test(value.id))
    errors.push(`${prefix}.id is invalid`);
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 80
  )
    errors.push(`${prefix}.name is invalid`);
  if (
    !Number.isSafeInteger(value.definitionVersion) ||
    (value.definitionVersion as number) < 1
  )
    errors.push(`${prefix}.definitionVersion must be a positive integer`);
  const definition = definitions.get(
    definitionKey(String(value.definitionId), Number(value.definitionVersion)),
  );
  if (!definition)
    errors.push(
      `${prefix}.definitionId and definitionVersion have no matching definition`,
    );
  if (
    definition?.optionalImage &&
    ["imageMeta", "imagePresent", "intrinsicAspect"].some((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  )
    errors.push(`${prefix}.optionalImage metadata is runtime-resolved`);
  if (
    !["fill", "layer", "backdrop"].includes(String(value.placement)) ||
    (definition &&
      !definition.placements.includes(
        value.placement as EffectInstance["placement"],
      ))
  )
    errors.push(`${prefix}.placement is not supported by its definition`);
  if (value.clip !== "bounds" && value.clip !== "text")
    errors.push(`${prefix}.clip is invalid`);
  if (
    !record(value.provenance) ||
    !["design-original", "imported", "user-authored"].includes(
      String(value.provenance.origin),
    )
  )
    errors.push(`${prefix}.provenance is invalid`);
  if (
    value.timing !== undefined &&
    (!record(value.timing) ||
      !isFiniteNativeUniformTiming(value.timing.speed) ||
      value.timing.speed < 0 ||
      typeof value.timing.paused !== "boolean" ||
      !isFiniteNativeUniformTiming(value.timing.time) ||
      value.timing.time < 0 ||
      Object.keys(value.timing).some(
        (key) => !["speed", "paused", "time"].includes(key),
      ))
  )
    errors.push(`${prefix}.timing is invalid`);
  if (!record(value.params)) {
    errors.push(`${prefix}.params must be an object`);
  } else if (definition && record(definition.properties)) {
    for (const [name, param] of Object.entries(value.params)) {
      const prop = Object.prototype.hasOwnProperty.call(
        definition.properties,
        name,
      )
        ? definition.properties[name]
        : undefined;
      if (!prop)
        errors.push(`${prefix}.params contains unknown property "${name}"`);
      else {
        const valueErrors: string[] = [];
        validateValue(prop, param, name, valueErrors);
        errors.push(...valueErrors.map((error) => `${prefix}.params ${error}`));
      }
    }
  }
  if (definition && record(value.params))
    errors.push(
      ...validateResolvedParameterConstraints(
        definition.parameterConstraints,
        definition.properties,
        value.params,
      ).map((error) => `${prefix}.${error}`),
    );
  validateBindings(value.bindings, definition, prefix, errors);
  validateTransform(value.transform, prefix, errors);
  validateSourceSizing(value.sourceSizing, definition, prefix, errors);
  validateTextureBindingConflicts(
    value.params,
    value.bindings,
    definition,
    prefix,
    errors,
  );
  return !errors.some((error) => error.startsWith(prefix));
}

export function validateEffectDocument(value: unknown): EffectValidationResult {
  const errors: string[] = [];
  if (!record(value))
    return { valid: false, errors: ["effect document must be an object"] };
  if (value.schemaVersion !== NATIVE_EFFECT_SCHEMA_VERSION)
    errors.push("effect schemaVersion must be 2");
  if (!Array.isArray(value.definitions) || value.definitions.length > 64)
    errors.push("definitions must be an array of at most 64");
  if (!Array.isArray(value.instances) || value.instances.length > 256)
    errors.push("instances must be an array of at most 256");
  if (
    value.presets !== undefined &&
    (!Array.isArray(value.presets) || value.presets.length > 128)
  )
    errors.push("presets must be an array of at most 128");
  if (value.preview !== undefined) {
    if (
      !record(value.preview) ||
      Object.keys(value.preview).some(
        (key) =>
          key !== "quality" &&
          key !== "frameRateTarget" &&
          key !== "colorMode" &&
          key !== "dynamicRange",
      ) ||
      !["auto", "performance", "quality"].includes(
        value.preview.quality as string,
      ) ||
      (value.preview.frameRateTarget !== 60 &&
        value.preview.frameRateTarget !== 120) ||
      (value.preview.colorMode !== undefined &&
        value.preview.colorMode !== "srgb" &&
        value.preview.colorMode !== "display-p3") ||
      (value.preview.dynamicRange !== undefined &&
        value.preview.dynamicRange !== "sdr" &&
        value.preview.dynamicRange !== "hdr")
    )
      errors.push(
        "preview must specify quality and a 60 or 120 frameRateTarget, with supported optional output modes",
      );
  }
  const definitions = new Map<string, EffectDefinition>();
  if (Array.isArray(value.definitions))
    for (const [index, definition] of value.definitions.entries()) {
      if (validateDefinition(definition, index, errors)) {
        const key = definitionKey(definition.id, definition.version);
        if (definitions.has(key))
          errors.push(
            `duplicate definition id/version "${definition.id}" v${definition.version}`,
          );
        definitions.set(key, definition);
      }
    }
  const instanceIds = new Set<string>();
  if (Array.isArray(value.instances))
    for (const [index, instance] of value.instances.entries()) {
      if (validateInstance(instance, index, definitions, errors)) {
        if (instanceIds.has(instance.id))
          errors.push(`duplicate instance id "${instance.id}"`);
        instanceIds.add(instance.id);
      }
    }
  const presetIds = new Set<string>();
  if (Array.isArray(value.presets))
    for (const [index, preset] of value.presets.entries()) {
      if (validatePreset(preset, index, definitions, errors)) {
        if (presetIds.has(preset.id))
          errors.push(`duplicate preset id "${preset.id}"`);
        presetIds.add(preset.id);
      }
    }
  if (!errors.length) {
    try {
      const serialized = JSON.stringify(value);
      if (
        !serialized ||
        new TextEncoder().encode(serialized).byteLength >
          MAX_EFFECT_MANIFEST_BYTES
      ) {
        errors.push(
          `effect manifest exceeds ${MAX_EFFECT_MANIFEST_BYTES} bytes`,
        );
      }
    } catch {
      errors.push("effect manifest is not serializable JSON");
    }
  }
  return errors.length
    ? { valid: false, errors }
    : { valid: true, errors: [], document: value as unknown as EffectDocument };
}

interface ScriptBlock {
  start: number;
  end: number;
  body: string;
}

export interface AuthoredNodeInspection {
  activeCount: number;
  inertCount: number;
}

type HtmlNode = {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  content?: { childNodes?: HtmlNode[] };
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { endOffset: number };
    endTag?: { startOffset: number };
  };
};

interface HtmlInspection {
  activeScripts: ScriptBlock[];
  unclosedActiveScriptCount: number;
  inertScriptCount: number;
  target: AuthoredNodeInspection;
  bodyCloseStart: number | null;
}

function inspectHtml(html: string, nodeId?: string): HtmlInspection {
  const result: HtmlInspection = {
    activeScripts: [],
    unclosedActiveScriptCount: 0,
    inertScriptCount: 0,
    target: { activeCount: 0, inertCount: 0 },
    bodyCloseStart: null,
  };
  const visit = (node: HtmlNode, inTemplate: boolean): void => {
    const inert = inTemplate || node.tagName === "template";
    if (node.tagName === "body" && !inert)
      result.bodyCloseStart =
        node.sourceCodeLocation?.endTag?.startOffset ?? null;
    if (
      nodeId !== undefined &&
      node.tagName &&
      node.attrs?.some(
        (attr) =>
          attr.name === "data-agent-native-node-id" && attr.value === nodeId,
      )
    ) {
      if (inert) result.target.inertCount++;
      else result.target.activeCount++;
    }
    if (
      node.tagName === "script" &&
      node.attrs?.some(
        (attr) =>
          attr.name === "type" && attr.value === NATIVE_EFFECT_SCRIPT_TYPE,
      )
    ) {
      if (inert) result.inertScriptCount++;
      else {
        const location = node.sourceCodeLocation;
        if (location?.startTag && location.endTag)
          result.activeScripts.push({
            start: location.startOffset,
            end: location.endOffset,
            body: html.slice(
              location.startTag.endOffset,
              location.endTag.startOffset,
            ),
          });
        else result.unclosedActiveScriptCount++;
      }
    }
    for (const child of node.childNodes ?? []) visit(child, inert);
    for (const child of node.content?.childNodes ?? []) visit(child, true);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }) as HtmlNode, false);
  return result;
}

function parseInspectedEffects(inspection: HtmlInspection): {
  document: EffectDocument | null;
  errors: string[];
} {
  if (inspection.inertScriptCount)
    return {
      document: null,
      errors: ["native effect manifest inside a template is inert"],
    };
  if (inspection.unclosedActiveScriptCount)
    return {
      document: null,
      errors: ["native effect manifest has no closing script tag"],
    };
  const blocks = inspection.activeScripts;
  if (!blocks.length) return { document: null, errors: [] };
  if (blocks.length !== 1)
    return {
      document: null,
      errors: ["multiple native effect manifests found"],
    };
  if (
    new TextEncoder().encode(blocks[0].body).byteLength >
    MAX_EFFECT_MANIFEST_BYTES
  ) {
    return {
      document: null,
      errors: [
        `native effect manifest exceeds ${MAX_EFFECT_MANIFEST_BYTES} bytes`,
      ],
    };
  }
  try {
    const validation = validateEffectDocument(JSON.parse(blocks[0].body));
    return { document: validation.document ?? null, errors: validation.errors };
  } catch (error) {
    return {
      document: null,
      errors: [`native effect manifest is invalid JSON: ${String(error)}`],
    };
  }
}

export function inspectNativeEffectHtml(
  html: string,
  nodeId?: string,
): {
  document: EffectDocument | null;
  errors: string[];
  target: AuthoredNodeInspection;
} {
  const inspection = inspectHtml(html, nodeId);
  return { ...parseInspectedEffects(inspection), target: inspection.target };
}

export function parseEffectsFromHtml(html: string): {
  document: EffectDocument | null;
  errors: string[];
} {
  return parseInspectedEffects(inspectHtml(html));
}

export function writeEffectsToHtml(
  html: string,
  document: EffectDocument,
): string {
  const validation = validateEffectDocument(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const inspection = inspectHtml(html);
  if (inspection.inertScriptCount)
    throw new Error("native effect manifest inside a template is inert");
  if (inspection.unclosedActiveScriptCount)
    throw new Error("native effect manifest has no closing script tag");
  const blocks = inspection.activeScripts;
  if (blocks.length > 1)
    throw new Error("multiple native effect manifests found");
  const json = JSON.stringify(document).replace(
    /[<>&\u2028\u2029]/g,
    (character) => {
      return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    },
  );
  const script = `<script type="${NATIVE_EFFECT_SCRIPT_TYPE}">${json}</script>`;
  if (blocks.length)
    return html.slice(0, blocks[0].start) + script + html.slice(blocks[0].end);
  if (inspection.bodyCloseStart !== null)
    return (
      html.slice(0, inspection.bodyCloseStart) +
      script +
      "\n" +
      html.slice(inspection.bodyCloseStart)
    );
  return html + "\n" + script;
}

export function authoredNodeCount(html: string, nodeId: string): number {
  return inspectHtml(html, nodeId).target.activeCount;
}

function nextInstanceId(document: EffectDocument): string {
  let id: string;
  do {
    id = `an-effect-${crypto.randomUUID()}`;
  } while (document.instances.some((instance) => instance.id === id));
  return id;
}

export function applyNativeEffectToHtml(
  html: string,
  options: {
    nodeId: string;
    definition: EffectDefinition;
    placement: EffectInstance["placement"];
    params?: Record<string, EffectValue>;
    clip?: EffectInstance["clip"];
    bindings?: EffectInstance["bindings"];
    transform?: EffectTransform2D;
    sourceSizing?: NativeSourceSizing;
    timing?: EffectPreset["timing"];
  },
): EffectHtmlResult {
  if (
    options.sourceSizing !== undefined &&
    !isNativeSourceSizing(options.sourceSizing)
  )
    return { html, errors: ["sourceSizing is invalid"] };
  if (usesRetiredNativeImageAbi(options.definition, options))
    return { html, errors: ["legacy-image-abi-retired"] };
  const parsed = inspectNativeEffectHtml(html, options.nodeId);
  if (parsed.errors.length) return { html, errors: parsed.errors };
  const count = parsed.target.activeCount;
  if (count !== 1)
    return {
      html,
      errors: [
        count === 0 && parsed.target.inertCount
          ? `authored node "${options.nodeId}" exists only inside an inert template`
          : `expected one authored node "${options.nodeId}", found ${count}`,
      ],
    };
  const document: EffectDocument = parsed.document ?? {
    schemaVersion: 2,
    definitions: [],
    instances: [],
  };
  const existing = document.definitions.find(
    (definition) =>
      definition.id === options.definition.id &&
      definition.version === options.definition.version,
  );
  if (
    existing &&
    JSON.stringify(existing) !== JSON.stringify(options.definition)
  ) {
    return {
      html,
      errors: [
        `definition "${options.definition.id}" v${options.definition.version} already names different source`,
      ],
    };
  }
  const instance: EffectInstance = {
    id: nextInstanceId(document),
    nodeId: options.nodeId,
    definitionId: options.definition.id,
    definitionVersion: options.definition.version,
    placement: options.placement,
    params: options.params ?? {},
    enabled: true,
    opacity: 1,
    seed: Math.floor(Math.random() * 1_000_000),
    clip: options.clip ?? "bounds",
    blend: "normal",
    timing: options.timing ?? { speed: 1, paused: false, time: 0 },
    ...(options.bindings && { bindings: options.bindings }),
    ...(options.transform && { transform: options.transform }),
    ...(options.sourceSizing && { sourceSizing: options.sourceSizing }),
  };
  const next: EffectDocument = {
    schemaVersion: 2,
    definitions: existing
      ? document.definitions
      : [...document.definitions, options.definition],
    instances: [...document.instances, instance],
    ...(document.presets && { presets: document.presets }),
  };
  const validation = validateEffectDocument(next);
  if (!validation.valid) return { html, errors: validation.errors };
  return { html: writeEffectsToHtml(html, next), errors: [] };
}

export function updateNativeInstanceInHtml(
  html: string,
  instanceId: string,
  patch: Partial<
    Omit<EffectInstance, "id" | "nodeId" | "definitionId" | "definitionVersion">
  >,
): EffectHtmlResult {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length) return { html, errors: parsed.errors };
  if (!parsed.document)
    return { html, errors: ["native effect manifest is absent"] };
  const index = parsed.document.instances.findIndex(
    (instance) => instance.id === instanceId,
  );
  if (index < 0)
    return {
      html,
      errors: [`native effect instance "${instanceId}" not found`],
    };
  const next: EffectDocument = {
    ...parsed.document,
    instances: parsed.document.instances.map((instance, current) =>
      current === index
        ? {
            ...instance,
            ...patch,
            params: patch.params
              ? { ...instance.params, ...patch.params }
              : instance.params,
            timing: patch.timing
              ? { ...instance.timing, ...patch.timing }
              : instance.timing,
          }
        : instance,
    ),
  };
  const validation = validateEffectDocument(next);
  if (!validation.valid) return { html, errors: validation.errors };
  return { html: writeEffectsToHtml(html, next), errors: [] };
}

export function removeNativeInstanceFromHtml(
  html: string,
  instanceId: string,
): EffectHtmlResult {
  const parsed = parseEffectsFromHtml(html);
  if (parsed.errors.length) return { html, errors: parsed.errors };
  if (!parsed.document)
    return { html, errors: ["native effect manifest is absent"] };
  if (
    !parsed.document.instances.some((instance) => instance.id === instanceId)
  ) {
    return {
      html,
      errors: [`native effect instance "${instanceId}" not found`],
    };
  }
  const instances = parsed.document.instances.filter(
    (instance) => instance.id !== instanceId,
  );
  const used = new Set(
    instances.map((instance) =>
      definitionKey(instance.definitionId, instance.definitionVersion),
    ),
  );
  return {
    html: writeEffectsToHtml(html, {
      ...parsed.document,
      instances,
      definitions: parsed.document.definitions.filter((definition) =>
        used.has(definitionKey(definition.id, definition.version)),
      ),
    }),
    errors: [],
  };
}

export function packNativeProperties(
  definition: EffectDefinition,
  params: Record<string, EffectValue> = {},
): Float32Array {
  const validation = validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [],
  });
  const errors = [...validation.errors];
  for (const [name, value] of Object.entries(params)) {
    const prop = Object.prototype.hasOwnProperty.call(
      definition.properties,
      name,
    )
      ? definition.properties[name]
      : undefined;
    if (!prop) errors.push(`unknown property "${name}"`);
    else validateValue(prop, value, name, errors);
  }
  if (errors.length) throw new Error(errors.join("; "));
  const constraintErrors = validateResolvedParameterConstraints(
    definition.parameterConstraints,
    definition.properties,
    params,
  );
  if (constraintErrors.length)
    throw new NativeEffectParameterConstraintError(constraintErrors);
  const packed = new Float32Array(128);
  let slot = 0;
  for (const [name, prop] of Object.entries(definition.properties)) {
    if (prop.type === "texture") continue;
    const value = params[name] ?? prop.default;
    const offset = slot * 4;
    if (prop.type === "float" || prop.type === "int")
      packed[offset] = value as number;
    else if (prop.type === "bool") packed[offset] = value ? 1 : 0;
    else if (prop.type === "enum")
      packed[offset] = prop.options.indexOf(value as string);
    else if (prop.type === "vec2")
      packed.set(value as [number, number], offset);
    else if (prop.type === "position")
      packed.set(packNativePosition(value as NativePositionValue), offset);
    else if (prop.type === "color") {
      const color = value as EffectColor;
      packed.set([...linearSrgb(color), color.alpha], offset);
    } else {
      const colors = value as EffectColor[];
      packed[offset] = colors.length;
      for (const [index, color] of colors.entries())
        packed.set(
          [...linearSrgb(color), color.alpha],
          offset + (index + 1) * 4,
        );
    }
    slot += propertySlots(prop);
  }
  return packed;
}

function linearSrgb(color: EffectColor): [number, number, number] {
  const [r, g, b] = color.components.map((component) =>
    component <= 0.04045
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4,
  );
  if (color.space === "srgb") return [r, g, b];
  // Display-P3 and sRGB share D65 and transfer curve; convert primaries in linear light.
  return [
    1.2249401 * r - 0.2249401 * g,
    -0.0420569 * r + 1.0420569 * g,
    -0.0196376 * r - 0.0786361 * g + 1.0982737 * b,
  ];
}
