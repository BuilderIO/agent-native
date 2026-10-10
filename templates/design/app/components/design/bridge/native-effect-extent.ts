import type {
  EffectExtent,
  EffectExtentInsets,
  EffectInstance,
} from "../../../../shared/native-effects";

export interface NativeEffectExtentPlan {
  pixelRatio: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  expanded: boolean;
}

export type NativeEffectExtentResult =
  | { ok: true; plan: NativeEffectExtentPlan }
  | { ok: false; code: string; detail: string };

const SIDES: (keyof EffectExtentInsets)[] = ["top", "right", "bottom", "left"];

function checkedInsets(value: EffectExtentInsets | undefined): boolean {
  return (
    value === undefined ||
    SIDES.every(
      (side) =>
        typeof value[side] === "number" &&
        Number.isFinite(value[side]) &&
        value[side] >= 0 &&
        value[side] <= 128,
    )
  );
}

function checkedCaptureInsets(value: EffectExtentInsets | undefined): boolean {
  return (
    value === undefined ||
    SIDES.every(
      (side) =>
        typeof value[side] === "number" &&
        Number.isFinite(value[side]) &&
        value[side] >= 0,
    )
  );
}

export function planNativeEffectExtent(input: {
  extent: EffectExtent | undefined;
  captureInsets?: EffectExtentInsets;
  placement: EffectInstance["placement"];
  clip: EffectInstance["clip"];
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  maxDimension: number;
  maxPixels: number;
}): NativeEffectExtentResult {
  const {
    extent,
    captureInsets,
    placement,
    clip,
    cssWidth,
    cssHeight,
    pixelRatio,
    maxDimension,
    maxPixels,
  } = input;
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    !Number.isFinite(pixelRatio) ||
    cssWidth <= 0 ||
    cssHeight <= 0 ||
    pixelRatio <= 0 ||
    pixelRatio > 4
  )
    return {
      ok: false,
      code: "effect-extent-size-invalid",
      detail: "Effect bounds or render density are invalid.",
    };
  if (!checkedInsets(extent?.source) || !checkedInsets(extent?.output))
    return {
      ok: false,
      code: "effect-extent-invalid",
      detail:
        "Effect extent sides must be finite CSS pixels between 0 and 128.",
    };
  if (!checkedCaptureInsets(captureInsets))
    return {
      ok: false,
      code: "source-capture-geometry-invalid",
      detail: "The expanded source capture has invalid CSS insets.",
    };
  if (extent?.source && SIDES.some((side) => extent.source![side] > 0))
    return {
      ok: false,
      code: "effect-source-extent-unsupported",
      detail: "Source overscan beyond the selected layer is not supported yet.",
    };
  const output = extent?.output;
  const outputExpanded = !!output && SIDES.some((side) => output[side] > 0);
  const captureExpanded =
    !!captureInsets && SIDES.some((side) => captureInsets[side] > 0);
  const expanded = outputExpanded || captureExpanded;
  if (outputExpanded && (placement !== "layer" || clip !== "bounds"))
    return {
      ok: false,
      code: "effect-output-extent-unsupported",
      detail:
        "Expanded output currently needs a layer processor with bounds clipping.",
    };
  if (captureExpanded && clip === "text")
    return {
      ok: false,
      code: "source-capture-text-unsupported",
      detail: "An expanded text clip needs a separate glyph coverage origin.",
    };
  const sourceWidth = Math.ceil(cssWidth * pixelRatio);
  const sourceHeight = Math.ceil(cssHeight * pixelRatio);
  const captureTop = -Math.floor(-(captureInsets?.top ?? 0) * pixelRatio);
  const captureLeft = -Math.floor(-(captureInsets?.left ?? 0) * pixelRatio);
  const captureRight =
    Math.ceil((cssWidth + (captureInsets?.right ?? 0)) * pixelRatio) -
    sourceWidth;
  const captureBottom =
    Math.ceil((cssHeight + (captureInsets?.bottom ?? 0)) * pixelRatio) -
    sourceHeight;
  const top = captureTop + Math.ceil((output?.top ?? 0) * pixelRatio);
  const right = captureRight + Math.ceil((output?.right ?? 0) * pixelRatio);
  const bottom = captureBottom + Math.ceil((output?.bottom ?? 0) * pixelRatio);
  const left = captureLeft + Math.ceil((output?.left ?? 0) * pixelRatio);
  const width = sourceWidth + left + right;
  const height = sourceHeight + top + bottom;
  if (
    ![sourceWidth, sourceHeight, top, right, bottom, left, width, height].every(
      Number.isSafeInteger,
    ) ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  )
    return {
      ok: false,
      code: "effect-extent-budget-exceeded",
      detail: "Expanded effect bounds exceed the supported texture dimensions.",
    };
  return {
    ok: true,
    plan: {
      pixelRatio,
      width,
      height,
      sourceWidth,
      sourceHeight,
      top,
      right,
      bottom,
      left,
      expanded,
    },
  };
}

export function planNativeChainedEffectExtent(input: {
  extent: EffectExtent | undefined;
  captureInsets?: EffectExtentInsets;
  placement: EffectInstance["placement"];
  clip: EffectInstance["clip"];
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  maxDimension: number;
  maxPixels: number;
  previous?: NativeEffectExtentPlan;
}): NativeEffectExtentResult {
  const own = planNativeEffectExtent(input);
  if (!own.ok || !input.previous) return own;
  const previous = input.previous;
  if (
    previous.pixelRatio !== own.plan.pixelRatio ||
    previous.sourceWidth !== own.plan.sourceWidth ||
    previous.sourceHeight !== own.plan.sourceHeight
  )
    return {
      ok: false,
      code: "effect-layer-chain-size-changed",
      detail:
        "The previous processor output has a different target resolution.",
    };
  if (
    previous.expanded &&
    (input.placement !== "layer" || input.clip !== "bounds")
  )
    return {
      ok: false,
      code: "effect-layer-chain-clip-unsupported",
      detail:
        "A processor following expanded output must preserve its bounds clip.",
    };
  const top = previous.top + own.plan.top;
  const right = previous.right + own.plan.right;
  const bottom = previous.bottom + own.plan.bottom;
  const left = previous.left + own.plan.left;
  const width = own.plan.sourceWidth + left + right;
  const height = own.plan.sourceHeight + top + bottom;
  if (
    width > input.maxDimension ||
    height > input.maxDimension ||
    width * height > input.maxPixels
  )
    return {
      ok: false,
      code: "effect-extent-budget-exceeded",
      detail: "Chained effect bounds exceed the supported texture dimensions.",
    };
  return {
    ok: true,
    plan: {
      ...own.plan,
      width,
      height,
      top,
      right,
      bottom,
      left,
      expanded: previous.expanded || own.plan.expanded,
    },
  };
}
