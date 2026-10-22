import type { NativeClipRadii } from "./native-clip-geometry";
import type { NativeSourceBox } from "./native-source-composition";

export interface NativeSourceInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NativeSourceClipCandidate {
  borderBox: NativeSourceBox;
  localWidth: number;
  localHeight: number;
  scaleX: number;
  scaleY: number;
  axisAligned: boolean;
  border: NativeSourceInsets;
  padding: NativeSourceInsets;
  outerRadii: NativeClipRadii;
  edge: "border" | "padding" | "content";
  outset?: number;
}

export interface NativeSourceRoundedClip {
  rect: NativeSourceBox;
  radii: NativeClipRadii;
}

export type NativeSourceClipPlanResult =
  | {
      ok: true;
      clips: NativeSourceRoundedClip[];
      bounds: NativeSourceBox | null;
    }
  | {
      ok: false;
      reason:
        | "invalid-geometry"
        | "unsupported-transform"
        | "unsupported-curve"
        | "too-many-clips";
      detail: string;
    };

export const MAX_NATIVE_SOURCE_CLIPS = 8;

export type NativeOverflowClipResult =
  | {
      ok: true;
      edge: "none" | "border" | "padding" | "content";
      outset: number;
    }
  | {
      ok: false;
      reason:
        | "unsupported-overflow"
        | "overflow-unreadable"
        | "unsupported-clip-margin"
        | "clip-margin-unreadable"
        | "clip-margin-unavailable";
      detail: string;
    };

export function classifyNativeOverflowClip(
  overflowX: string,
  overflowY: string,
  overflowClipMargin: string,
  clipMarginSupported: boolean | null = null,
): NativeOverflowClipResult {
  if (!overflowX.trim() || !overflowY.trim())
    return {
      ok: false,
      reason: "overflow-unreadable",
      detail: "Computed overflow axes are unreadable.",
    };
  if (overflowX === "visible" && overflowY === "visible")
    return { ok: true, edge: "none", outset: 0 };
  if (overflowX === "hidden" && overflowY === "hidden")
    return { ok: true, edge: "padding", outset: 0 };
  if (overflowX === "clip" && overflowY === "clip") {
    if (clipMarginSupported === false)
      return {
        ok: false,
        reason: "clip-margin-unavailable",
        detail: "This browser does not expose overflow-clip-margin geometry.",
      };
    const margin = overflowClipMargin.trim().toLowerCase();
    if (!margin)
      return {
        ok: false,
        reason: "clip-margin-unreadable",
        detail: "Computed overflow-clip-margin geometry is unreadable.",
      };
    const tokens = margin.split(/\s+/);
    const boxes = tokens.filter((token) =>
      ["border-box", "padding-box", "content-box"].includes(token),
    );
    const lengths = tokens.filter((token) =>
      /^(?:0|\+?(?:\d+(?:\.\d*)?|\.\d+)px)$/.test(token),
    );
    if (
      tokens.length > 2 ||
      boxes.length > 1 ||
      lengths.length > 1 ||
      boxes.length + lengths.length !== tokens.length
    )
      return {
        ok: false,
        reason: "unsupported-clip-margin",
        detail:
          "Overflow clip margin needs one visual box and a finite nonnegative pixel outset.",
      };
    const outset = lengths.length ? Number.parseFloat(lengths[0]) : 0;
    if (!Number.isFinite(outset) || outset < 0)
      return {
        ok: false,
        reason: "unsupported-clip-margin",
        detail: "Overflow clip margin needs a finite nonnegative pixel outset.",
      };
    return {
      ok: true,
      edge:
        boxes[0] === "border-box"
          ? "border"
          : boxes[0] === "content-box"
            ? "content"
            : "padding",
      outset,
    };
  }
  return {
    ok: false,
    reason: "unsupported-overflow",
    detail:
      "Mixed-axis, scroll, and auto overflow need a separate source clip path.",
  };
}

export function classifyNativeComputedOverflowClip(
  style: CSSStyleDeclaration,
): NativeOverflowClipResult {
  const supported =
    typeof CSS !== "undefined" && typeof CSS.supports === "function"
      ? CSS.supports("overflow-clip-margin", "0px")
      : null;
  return classifyNativeOverflowClip(
    style.overflowX,
    style.overflowY,
    style.getPropertyValue("overflow-clip-margin"),
    supported,
  );
}

function validBox(box: NativeSourceBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    Number.isFinite(box.x + box.width) &&
    Number.isFinite(box.y + box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function validInsets(insets: NativeSourceInsets): boolean {
  return Object.values(insets).every(
    (value) => Number.isFinite(value) && value >= 0,
  );
}

function validRadii(
  radii: NativeClipRadii,
  width: number,
  height: number,
): boolean {
  const values = Object.values(radii);
  if (
    values.some(
      (corner) =>
        !Number.isFinite(corner.x) ||
        !Number.isFinite(corner.y) ||
        corner.x < 0 ||
        corner.y < 0,
    )
  )
    return false;
  const tolerance = 0.00001;
  return (
    radii.topLeft.x + radii.topRight.x <= width + tolerance &&
    radii.bottomLeft.x + radii.bottomRight.x <= width + tolerance &&
    radii.topLeft.y + radii.bottomLeft.y <= height + tolerance &&
    radii.topRight.y + radii.bottomRight.y <= height + tolerance
  );
}

function intersection(a: NativeSourceBox, b: NativeSourceBox): NativeSourceBox {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

function outsetAdjustedRadius(
  radius: { x: number; y: number },
  width: number,
  height: number,
  outsetX: number,
  outsetY: number,
): { x: number; y: number } {
  const coverage = 2 * Math.min(radius.x / width, radius.y / height);
  const dimension = (value: number, outset: number): number => {
    if (outset <= 0) return Math.max(0, value + outset);
    if (value > outset || coverage > 1) return value + outset;
    const ratio = value / outset;
    return value + outset * (1 - (1 - ratio) ** 3 * (1 - coverage ** 3));
  };
  return {
    x: dimension(radius.x, outsetX),
    y: dimension(radius.y, outsetY),
  };
}

function normalizeRadii(
  radii: NativeClipRadii,
  width: number,
  height: number,
): NativeClipRadii {
  const limit = (extent: number, sum: number): number =>
    sum > 0 ? extent / sum : 1;
  const factor = Math.min(
    1,
    limit(width, radii.topLeft.x + radii.topRight.x),
    limit(width, radii.bottomLeft.x + radii.bottomRight.x),
    limit(height, radii.topLeft.y + radii.bottomLeft.y),
    limit(height, radii.topRight.y + radii.bottomRight.y),
  );
  return {
    topLeft: { x: radii.topLeft.x * factor, y: radii.topLeft.y * factor },
    topRight: { x: radii.topRight.x * factor, y: radii.topRight.y * factor },
    bottomRight: {
      x: radii.bottomRight.x * factor,
      y: radii.bottomRight.y * factor,
    },
    bottomLeft: {
      x: radii.bottomLeft.x * factor,
      y: radii.bottomLeft.y * factor,
    },
  };
}

function projectClip(
  candidate: NativeSourceClipCandidate,
): NativeSourceClipPlanResult {
  const {
    borderBox,
    localWidth,
    localHeight,
    scaleX,
    scaleY,
    border,
    padding,
    outerRadii,
  } = candidate;
  if (!candidate.axisAligned || scaleX <= 0 || scaleY <= 0)
    return {
      ok: false,
      reason: "unsupported-transform",
      detail:
        "Source clips require positive axis-aligned translation and scale.",
    };
  if (
    !validBox(borderBox) ||
    !Number.isFinite(localWidth) ||
    !Number.isFinite(localHeight) ||
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    !Number.isFinite(candidate.outset ?? 0) ||
    (candidate.outset ?? 0) < 0 ||
    localWidth <= 0 ||
    localHeight <= 0 ||
    !validInsets(border) ||
    !validInsets(padding) ||
    !validRadii(outerRadii, localWidth, localHeight) ||
    Math.abs(borderBox.width - localWidth * scaleX) >
      Math.max(0.01, borderBox.width * 0.001) ||
    Math.abs(borderBox.height - localHeight * scaleY) >
      Math.max(0.01, borderBox.height * 0.001)
  )
    return {
      ok: false,
      reason: "invalid-geometry",
      detail: "Source clip geometry or projected scale is unreadable.",
    };

  const originInset = {
    top:
      (candidate.edge === "border" ? 0 : border.top) +
      (candidate.edge === "content" ? padding.top : 0),
    right:
      (candidate.edge === "border" ? 0 : border.right) +
      (candidate.edge === "content" ? padding.right : 0),
    bottom:
      (candidate.edge === "border" ? 0 : border.bottom) +
      (candidate.edge === "content" ? padding.bottom : 0),
    left:
      (candidate.edge === "border" ? 0 : border.left) +
      (candidate.edge === "content" ? padding.left : 0),
  };
  const outset = candidate.outset ?? 0;
  const inset = {
    top: originInset.top - outset,
    right: originInset.right - outset,
    bottom: originInset.bottom - outset,
    left: originInset.left - outset,
  };
  const width = localWidth - inset.left - inset.right;
  const height = localHeight - inset.top - inset.bottom;
  if (
    width < 0 ||
    height < 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  )
    return {
      ok: false,
      reason: "invalid-geometry",
      detail: "Source clip insets exceed the border box.",
    };

  // An inner edge cutting past an opposite outer corner center is not a quarter ellipse.
  if (
    outerRadii.topLeft.x > localWidth - inset.right ||
    outerRadii.bottomLeft.x > localWidth - inset.right ||
    outerRadii.topRight.x > localWidth - inset.left ||
    outerRadii.bottomRight.x > localWidth - inset.left ||
    outerRadii.topLeft.y > localHeight - inset.bottom ||
    outerRadii.topRight.y > localHeight - inset.bottom ||
    outerRadii.bottomLeft.y > localHeight - inset.top ||
    outerRadii.bottomRight.y > localHeight - inset.top
  )
    return {
      ok: false,
      reason: "unsupported-curve",
      detail:
        "The inner clip curve crosses an opposite edge and is not a quarter ellipse.",
    };

  const corner = (
    radius: { x: number; y: number },
    horizontalInset: number,
    verticalInset: number,
  ) =>
    outsetAdjustedRadius(
      radius,
      localWidth,
      localHeight,
      -horizontalInset,
      -verticalInset,
    );
  const adjustedRadii = {
    topLeft: corner(outerRadii.topLeft, inset.left, inset.top),
    topRight: corner(outerRadii.topRight, inset.right, inset.top),
    bottomRight: corner(outerRadii.bottomRight, inset.right, inset.bottom),
    bottomLeft: corner(outerRadii.bottomLeft, inset.left, inset.bottom),
  };
  const localRadii =
    outset > 0 ? normalizeRadii(adjustedRadii, width, height) : adjustedRadii;
  const scaled = (radius: { x: number; y: number }) => ({
    x: radius.x * scaleX,
    y: radius.y * scaleY,
  });
  const clip: NativeSourceRoundedClip = {
    rect: {
      x: borderBox.x + inset.left * scaleX,
      y: borderBox.y + inset.top * scaleY,
      width: width * scaleX,
      height: height * scaleY,
    },
    radii: {
      topLeft: scaled(localRadii.topLeft),
      topRight: scaled(localRadii.topRight),
      bottomRight: scaled(localRadii.bottomRight),
      bottomLeft: scaled(localRadii.bottomLeft),
    },
  };
  if (
    !validBox(clip.rect) ||
    (outset > 0 && !validRadii(clip.radii, clip.rect.width, clip.rect.height))
  )
    return {
      ok: false,
      reason: "invalid-geometry",
      detail: "Expanded source clip geometry is unreadable.",
    };
  return { ok: true, clips: [clip], bounds: clip.rect };
}

export function planNativeSourceClips(
  candidates: readonly NativeSourceClipCandidate[],
): NativeSourceClipPlanResult {
  if (candidates.length > MAX_NATIVE_SOURCE_CLIPS)
    return {
      ok: false,
      reason: "too-many-clips",
      detail: `Source composition supports at most ${MAX_NATIVE_SOURCE_CLIPS} rounded clips per record.`,
    };
  const clips: NativeSourceRoundedClip[] = [];
  let bounds: NativeSourceBox | null = null;
  for (const candidate of candidates) {
    const result = projectClip(candidate);
    if (!result.ok) return result;
    const clip = result.clips[0];
    clips.push(clip);
    bounds = bounds ? intersection(bounds, clip.rect) : clip.rect;
  }
  return {
    ok: true,
    clips,
    bounds,
  };
}

export function nativePointInsideSourceClips(
  x: number,
  y: number,
  clips: readonly NativeSourceRoundedClip[],
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const clip of clips) {
    const { rect, radii } = clip;
    if (
      x < rect.x ||
      y < rect.y ||
      x > rect.x + rect.width ||
      y > rect.y + rect.height
    )
      return false;
    const corners = [
      [
        rect.x + radii.topLeft.x,
        rect.y + radii.topLeft.y,
        radii.topLeft,
        x < rect.x + radii.topLeft.x && y < rect.y + radii.topLeft.y,
      ],
      [
        rect.x + rect.width - radii.topRight.x,
        rect.y + radii.topRight.y,
        radii.topRight,
        x > rect.x + rect.width - radii.topRight.x &&
          y < rect.y + radii.topRight.y,
      ],
      [
        rect.x + rect.width - radii.bottomRight.x,
        rect.y + rect.height - radii.bottomRight.y,
        radii.bottomRight,
        x > rect.x + rect.width - radii.bottomRight.x &&
          y > rect.y + rect.height - radii.bottomRight.y,
      ],
      [
        rect.x + radii.bottomLeft.x,
        rect.y + rect.height - radii.bottomLeft.y,
        radii.bottomLeft,
        x < rect.x + radii.bottomLeft.x &&
          y > rect.y + rect.height - radii.bottomLeft.y,
      ],
    ] as const;
    for (const [cx, cy, radius, inCorner] of corners)
      if (
        inCorner &&
        radius.x > 0 &&
        radius.y > 0 &&
        ((x - cx) / radius.x) ** 2 + ((y - cy) / radius.y) ** 2 > 1
      )
        return false;
  }
  return true;
}
