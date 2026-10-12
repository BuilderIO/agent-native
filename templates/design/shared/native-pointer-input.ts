import { planNativeEffectTransform } from "./native-effect-transform";
import {
  packNativeProperties,
  propertySlots,
  type EffectDefinition,
  type EffectInstance,
  type EffectValue,
} from "./native-effects";

export interface NativePointerState {
  x: number;
  y: number;
  active: boolean;
}

export class NativePointerInputError extends Error {
  readonly code = "native-pointer-invalid";
  constructor() {
    super(
      "Native pointer coordinates must be finite GPU-representable numbers.",
    );
    this.name = "NativePointerInputError";
  }
}

function finiteGpuNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(Math.fround(value));
}

export function mapNativePointerInput(options: {
  clientX: number;
  clientY: number;
  clientToTarget: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  targetSize: { width: number; height: number };
  width: number;
  height: number;
  pixelRatio: number;
  extent?: {
    left: number;
    top: number;
    sourceWidth: number;
    sourceHeight: number;
  } | null;
  transform?: EffectInstance["transform"];
}):
  | { ok: true; pointer: NativePointerState }
  | { ok: false; code: "effect-transform-invalid"; detail: string } {
  const { width, height, extent, clientToTarget, targetSize } = options;
  const plan = planNativeEffectTransform(options.transform, {
    width,
    height,
    pixelRatio: options.pixelRatio,
    target: {
      x: extent?.left ?? 0,
      y: extent?.top ?? 0,
      width: extent?.sourceWidth ?? width,
      height: extent?.sourceHeight ?? height,
    },
  });
  if (!plan.ok) return plan;
  if (
    !Number.isFinite(options.clientX) ||
    !Number.isFinite(options.clientY) ||
    !Object.values(clientToTarget).every(finiteGpuNumber) ||
    !Number.isFinite(targetSize.width) ||
    !Number.isFinite(targetSize.height) ||
    targetSize.width <= 0 ||
    targetSize.height <= 0
  )
    return {
      ok: false,
      code: "effect-transform-invalid",
      detail: "Pointer target geometry is outside its bounds.",
    };
  const targetX =
    (clientToTarget.a * options.clientX +
      clientToTarget.c * options.clientY +
      clientToTarget.e) /
    targetSize.width;
  const targetY =
    (clientToTarget.b * options.clientX +
      clientToTarget.d * options.clientY +
      clientToTarget.f) /
    targetSize.height;
  const outputX =
    ((extent?.left ?? 0) + targetX * (extent?.sourceWidth ?? width)) / width;
  const outputY =
    ((extent?.top ?? 0) + targetY * (extent?.sourceHeight ?? height)) / height;
  const x =
    plan.rows[0][0] * outputX + plan.rows[0][1] * outputY + plan.rows[0][2];
  const y =
    plan.rows[1][0] * outputX + plan.rows[1][1] * outputY + plan.rows[1][2];
  if (!finiteGpuNumber(x) || !finiteGpuNumber(y))
    return {
      ok: false,
      code: "effect-transform-invalid",
      detail:
        "Pointer coordinates cannot be represented by GPU float uniforms.",
    };
  return {
    ok: true,
    pointer: { x, y, active: x >= 0 && x <= 1 && y >= 0 && y <= 1 },
  };
}

export function packNativePointerProperties(
  definition: EffectDefinition,
  params: Record<string, EffectValue>,
  pointer: NativePointerState | null,
  deterministic: boolean,
): Float32Array {
  const packed = packNativeProperties(definition, params);
  if (!definition.interaction || !pointer || deterministic) return packed;
  if (
    !finiteGpuNumber(pointer.x) ||
    !finiteGpuNumber(pointer.y) ||
    typeof pointer.active !== "boolean"
  )
    throw new NativePointerInputError();
  let slot = 0;
  for (const [name, property] of Object.entries(definition.properties)) {
    if (name === definition.interaction.positionProperty) {
      packed[slot * 4] = Math.max(0, Math.min(1, pointer.x));
      packed[slot * 4 + 1] = Math.max(0, Math.min(1, pointer.y));
    }
    if (name === definition.interaction.activeProperty)
      packed[slot * 4] = pointer.active ? 1 : 0;
    slot += propertySlots(property);
  }
  return packed;
}
