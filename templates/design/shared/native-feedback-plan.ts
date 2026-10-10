import {
  feedbackUniformProperties,
  type FeedbackUniformSlot,
} from "./effect-graph";
import {
  validateEffectDocument,
  type EffectDefinition,
} from "./native-effects";

export type NativeFeedbackFormat = "rgba16float";

export interface NativeFeedbackDefinition {
  abi: "texture-feedback-v1";
  id: string;
  version: number;
  source?: {
    repository: string;
    commit: string;
    file: string;
    license: string;
  };
  grid: {
    width: number;
    height: number;
    format: NativeFeedbackFormat;
    workgroup: readonly [8, 8];
  };
  timing: {
    fixedDt: number;
    maxStepsPerCall: number;
    maxStepIndex: number;
  };
  uniformProperties?: Record<FeedbackUniformSlot, string>;
  computeWgsl: string;
  resolveWgsl: string;
}

export interface NativeFeedbackPlan {
  width: number;
  height: number;
  workgroupsX: number;
  workgroupsY: number;
  stateBytes: number;
  displayBytes: number;
  totalTextureBytes: number;
}

export type NativeFeedbackPlanResult =
  | { ok: true; plan: NativeFeedbackPlan }
  | {
      ok: false;
      code:
        | "feedback-definition-invalid"
        | "feedback-grid-limit"
        | "feedback-resource-budget";
    };

export interface NativeFeedbackClockState {
  completedStep: number;
}

export type NativeFeedbackAdapterResult =
  | {
      ok: true;
      definition: NativeFeedbackDefinition & {
        uniformProperties: Record<FeedbackUniformSlot, string>;
      };
    }
  | { ok: false; code: "feedback-definition-invalid" };

export function adaptNativeFeedbackDefinition(
  definition: EffectDefinition,
): NativeFeedbackAdapterResult {
  const feedback = definition.feedback;
  const [compute, resolve] = definition.passes;
  if (
    !feedback ||
    validateEffectDocument({
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
    }).errors.length ||
    compute?.kind !== "compute" ||
    resolve?.kind !== "render"
  )
    return { ok: false, code: "feedback-definition-invalid" };
  const upstream = definition.provenance.upstream;
  return {
    ok: true,
    definition: {
      abi: feedback.abi,
      id: definition.id,
      version: definition.version,
      ...(upstream
        ? {
            source: {
              repository: upstream.repository,
              commit: upstream.commit,
              file: upstream.file,
              license: upstream.license,
            },
          }
        : {}),
      grid: feedback.grid,
      timing: feedback.timing,
      uniformProperties: feedbackUniformProperties(feedback),
      computeWgsl: compute.wgsl,
      resolveWgsl: resolve.wgsl,
    },
  };
}

export type NativeFeedbackAdvanceResult =
  | { ok: true; steps: readonly number[]; targetStep: number }
  | {
      ok: false;
      code:
        | "feedback-time-invalid"
        | "feedback-seek-backward"
        | "feedback-step-limit";
    };

const MAX_GRID_SIDE = 2_048;
const MAX_GRID_PIXELS = 2_097_152;
const MAX_INSTANCE_BYTES = 134_217_728;
const BYTES_PER_RGBA16FLOAT_TEXEL = 8;

export function planNativeFeedback(
  definition: NativeFeedbackDefinition,
  deviceLimits: {
    maxTextureDimension2D: number;
    maxComputeWorkgroupsPerDimension: number;
  },
  existingResourceBytes = 0,
): NativeFeedbackPlanResult {
  const { width, height, format, workgroup } = definition.grid;
  if (
    definition.abi !== "texture-feedback-v1" ||
    !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(definition.id) ||
    !Number.isSafeInteger(definition.version) ||
    definition.version < 1 ||
    typeof definition.computeWgsl !== "string" ||
    !definition.computeWgsl.trim() ||
    definition.computeWgsl.length > 32_000 ||
    typeof definition.resolveWgsl !== "string" ||
    !definition.resolveWgsl.trim() ||
    definition.resolveWgsl.length > 32_000 ||
    !Array.isArray(workgroup) ||
    workgroup.length !== 2 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    format !== "rgba16float" ||
    workgroup[0] !== 8 ||
    workgroup[1] !== 8 ||
    !Number.isFinite(definition.timing.fixedDt) ||
    definition.timing.fixedDt < 1 / 240 ||
    definition.timing.fixedDt > 1 / 15 ||
    !Number.isSafeInteger(definition.timing.maxStepsPerCall) ||
    definition.timing.maxStepsPerCall < 1 ||
    definition.timing.maxStepsPerCall > 512 ||
    !Number.isSafeInteger(definition.timing.maxStepIndex) ||
    definition.timing.maxStepIndex < 0 ||
    definition.timing.maxStepIndex > 36_000 ||
    !Number.isSafeInteger(deviceLimits.maxTextureDimension2D) ||
    !Number.isSafeInteger(deviceLimits.maxComputeWorkgroupsPerDimension) ||
    !Number.isSafeInteger(existingResourceBytes) ||
    existingResourceBytes < 0
  )
    return { ok: false, code: "feedback-definition-invalid" };
  const workgroupsX = Math.ceil(width / workgroup[0]);
  const workgroupsY = Math.ceil(height / workgroup[1]);
  if (
    width > MAX_GRID_SIDE ||
    height > MAX_GRID_SIDE ||
    width * height > MAX_GRID_PIXELS ||
    width > deviceLimits.maxTextureDimension2D ||
    height > deviceLimits.maxTextureDimension2D ||
    workgroupsX > deviceLimits.maxComputeWorkgroupsPerDimension ||
    workgroupsY > deviceLimits.maxComputeWorkgroupsPerDimension
  )
    return { ok: false, code: "feedback-grid-limit" };
  const stateBytes = width * height * BYTES_PER_RGBA16FLOAT_TEXEL;
  const totalTextureBytes = stateBytes * 3;
  if (totalTextureBytes + existingResourceBytes > MAX_INSTANCE_BYTES)
    return { ok: false, code: "feedback-resource-budget" };
  return {
    ok: true,
    plan: {
      width,
      height,
      workgroupsX,
      workgroupsY,
      stateBytes,
      displayBytes: stateBytes,
      totalTextureBytes,
    },
  };
}

export function planNativeFeedbackAdvance(
  definition: NativeFeedbackDefinition,
  state: NativeFeedbackClockState,
  timeSeconds: number,
  mode: "deterministic" | "interactive" = "deterministic",
): NativeFeedbackAdvanceResult {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
    return { ok: false, code: "feedback-time-invalid" };
  if (!Number.isSafeInteger(state.completedStep) || state.completedStep < -1)
    return { ok: false, code: "feedback-time-invalid" };
  const targetStep = Math.floor(timeSeconds / definition.timing.fixedDt + 1e-7);
  if (!Number.isSafeInteger(targetStep))
    return { ok: false, code: "feedback-time-invalid" };
  if (mode === "deterministic" && targetStep > definition.timing.maxStepIndex)
    return { ok: false, code: "feedback-step-limit" };
  if (targetStep < state.completedStep)
    return { ok: false, code: "feedback-seek-backward" };
  const count = targetStep - state.completedStep;
  if (count > definition.timing.maxStepsPerCall)
    return { ok: false, code: "feedback-step-limit" };
  const steps: number[] = [];
  for (let index = state.completedStep + 1; index <= targetStep; index += 1)
    steps.push(index);
  return { ok: true, steps, targetStep };
}
