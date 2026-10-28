import { deviceViewportFloorForWidth } from "./frame-geometry";
import {
  clampScreenDimension,
  type ScreenSizeConstraints,
} from "./screen-sizing";

export type ScreenHeightMode = "auto" | "fixed" | "hug";

const IMPORTED_STATIC_SCREEN_SOURCE_TYPES = new Set([
  "creative-context",
  "creative-context-clone",
  "creative-context-native-clone",
  "fig-frame",
  "fig-upload",
  "figma-clipboard-local-kiwi",
  "figma-clipboard-rest",
  "figma-import",
  "figma-paste-html",
  "html-import",
  "html-string",
  "html-upload",
]);

export function isImportedStaticScreenSource(sourceType: unknown): boolean {
  return (
    typeof sourceType === "string" &&
    IMPORTED_STATIC_SCREEN_SOURCE_TYPES.has(sourceType.toLowerCase())
  );
}

export function resolveScreenHeightMode(
  heightMode: unknown,
  heightPinned: boolean | undefined,
  sourceType?: unknown,
): ScreenHeightMode {
  if (heightMode === "auto") return "auto";
  if (heightMode === "fixed" || heightMode === "hug") return heightMode;
  if (isImportedStaticScreenSource(sourceType)) return "fixed";
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
