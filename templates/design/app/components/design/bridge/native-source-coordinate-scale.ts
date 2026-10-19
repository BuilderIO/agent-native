export type NativeSourceCoordinateSpace =
  | "target-local"
  | "target-local-global"
  | "target-viewport-axis-aligned";

export function planNativeSourceCoordinateScale(input: {
  spaces: readonly NativeSourceCoordinateSpace[];
  sourceWidth: number;
  sourceHeight: number;
  localWidth: number;
  localHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}):
  | { ok: true; x: number; y: number }
  | {
      ok: false;
      code:
        | "source-coordinate-space-mixed"
        | "source-coordinate-space-unreadable";
    } {
  const first = input.spaces[0] ?? "target-local";
  if (
    (first !== "target-local" &&
      first !== "target-local-global" &&
      first !== "target-viewport-axis-aligned") ||
    input.spaces.some((space) => space !== first)
  )
    return { ok: false, code: "source-coordinate-space-mixed" };
  const width =
    first === "target-viewport-axis-aligned"
      ? input.viewportWidth
      : input.localWidth;
  const height =
    first === "target-viewport-axis-aligned"
      ? input.viewportHeight
      : input.localHeight;
  const x = input.sourceWidth / width;
  const y = input.sourceHeight / height;
  if (
    ![input.sourceWidth, input.sourceHeight, width, height, x, y].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return { ok: false, code: "source-coordinate-space-unreadable" };
  return { ok: true, x, y };
}
