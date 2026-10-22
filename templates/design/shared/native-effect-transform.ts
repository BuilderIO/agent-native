import type { EffectTransform2D } from "./native-effects";

export type NativeEffectTransformPlan =
  | {
      ok: true;
      rows: readonly [
        readonly [number, number, number, number],
        readonly [number, number, number, number],
      ];
    }
  | { ok: false; code: "effect-transform-invalid"; detail: string };

export function planNativeEffectTransform(
  transform: EffectTransform2D | undefined,
  geometry: {
    width: number;
    height: number;
    pixelRatio: number;
    target: { x: number; y: number; width: number; height: number };
  },
): NativeEffectTransformPlan {
  const { width, height, pixelRatio, target } = geometry;
  const translate = transform?.translate ?? [0, 0];
  const scale = transform?.scale ?? [1, 1];
  const angle = transform?.rotate ?? 0;
  const origin = transform?.origin ?? [0.5, 0.5];
  if (
    ![width, height, pixelRatio, target.width, target.height].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    ![target.x, target.y, angle, ...translate, ...scale, ...origin].every(
      Number.isFinite,
    ) ||
    scale.some((value) => value <= 0 || value > 100) ||
    origin.some((value) => value < 0 || value > 1) ||
    translate.some((value) => Math.abs(value) > 100_000) ||
    Math.abs(angle) > 100 * Math.PI
  )
    return {
      ok: false,
      code: "effect-transform-invalid",
      detail: "Effect transform or target geometry is outside its bounds.",
    };

  const ox = target.x + origin[0] * target.width;
  const oy = target.y + origin[1] * target.height;
  const tx = translate[0] * pixelRatio;
  const ty = translate[1] * pixelRatio;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const a = cosine / scale[0];
  const b = sine / scale[0];
  const d = -sine / scale[1];
  const e = cosine / scale[1];
  // Project output UVs back into the effect texture; the target clip stays in output space.
  const rows = [
    [a, (b * height) / width, (ox - a * (ox + tx) - b * (oy + ty)) / width, 0],
    [(d * width) / height, e, (oy - d * (ox + tx) - e * (oy + ty)) / height, 0],
  ] as const;
  if (
    rows.some((row) =>
      row.some((value) => !Number.isFinite(Math.fround(value))),
    )
  )
    return {
      ok: false,
      code: "effect-transform-invalid",
      detail: "Effect transform cannot be represented by GPU float uniforms.",
    };
  return { ok: true, rows };
}
