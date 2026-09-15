import { deviceViewportFloorForWidth } from "./frame-geometry";
import {
  clampScreenDimension,
  type ScreenSizeConstraints,
} from "./screen-sizing";

export type ScreenHeightMode = "auto" | "fixed" | "hug";

export function resolveScreenHeightMode(
  heightMode: unknown,
  heightPinned: boolean | undefined,
): ScreenHeightMode {
  if (heightMode === "fixed" || heightMode === "hug") return heightMode;
  return heightPinned === true ? "fixed" : "auto";
}

export function resolveAutoFitScreenHeight(args: {
  mode: ScreenHeightMode;
  width: number;
  currentHeight: number;
  measuredHeight: number;
  sizeConstraints?: ScreenSizeConstraints;
}): number {
  const height =
    args.mode === "fixed"
      ? args.currentHeight
      : args.mode === "hug"
        ? Math.max(1, args.measuredHeight)
        : Math.max(
            deviceViewportFloorForWidth(args.width),
            args.currentHeight,
            args.measuredHeight,
          );
  return args.sizeConstraints
    ? clampScreenDimension(height, "height", args.sizeConstraints)
    : height;
}
