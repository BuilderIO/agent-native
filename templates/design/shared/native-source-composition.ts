export interface NativeSourceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativePaintFootprint {
  box: NativeSourceBox;
  opacityGroups: number[];
}

export interface NativeStackingFootprint {
  box: NativeSourceBox;
  zIndex: string;
  phase: "context-own" | "flow" | "positioned";
}

export interface NativeCornerRadii {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

export function nativeBoxesOverlap(
  a: NativeSourceBox,
  b: NativeSourceBox,
): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export function hasOverlappingOpacityGroup(
  paints: NativePaintFootprint[],
): boolean {
  if (paints.every((paint) => paint.opacityGroups.length === 0)) return false;
  for (let earlier = 0; earlier < paints.length; earlier++)
    for (let later = earlier + 1; later < paints.length; later++)
      if (
        nativeBoxesOverlap(paints[earlier].box, paints[later].box) &&
        paints[earlier].opacityGroups.some((group) =>
          paints[later].opacityGroups.includes(group),
        )
      )
        return true;
  return false;
}

export function hasUnsupportedStackingOrder(
  siblings: NativeStackingFootprint[],
): boolean {
  for (let earlier = 0; earlier < siblings.length; earlier++)
    for (let later = earlier + 1; later < siblings.length; later++) {
      const first = siblings[earlier];
      const second = siblings[later];
      if (!nativeBoxesOverlap(first.box, second.box)) continue;
      if (first.phase === "context-own") continue;
      if (second.phase === "context-own") return true;
      const firstRank = first.zIndex === "auto" ? 0 : Number(first.zIndex);
      const secondRank = second.zIndex === "auto" ? 0 : Number(second.zIndex);
      if (
        !Number.isInteger(firstRank) ||
        !Number.isInteger(secondRank) ||
        firstRank > secondRank ||
        (firstRank === secondRank &&
          first.phase === "positioned" &&
          second.phase === "flow")
      )
        return true;
    }
  return false;
}

export function hasUnsupportedSourceMask(
  clipPath: string,
  maskImage: string,
): boolean {
  return (
    (clipPath !== "none" && clipPath !== "") ||
    (maskImage !== "none" && maskImage !== "")
  );
}

export function nativeSourceOpacityProduct(
  opacitiesFromLeaf: readonly number[],
  ownOpacityAlreadyBaked: boolean,
): number {
  return opacitiesFromLeaf.reduce(
    (product, opacity, index) =>
      product * (ownOpacityAlreadyBaked && index === 0 ? 1 : opacity),
    1,
  );
}

export function roundedClipMayAffect(
  visible: NativeSourceBox,
  clip: NativeSourceBox,
  radii: NativeCornerRadii,
): boolean {
  const corners: NativeSourceBox[] = [
    {
      x: clip.x,
      y: clip.y,
      width: radii.topLeft.x,
      height: radii.topLeft.y,
    },
    {
      x: clip.x + clip.width - radii.topRight.x,
      y: clip.y,
      width: radii.topRight.x,
      height: radii.topRight.y,
    },
    {
      x: clip.x + clip.width - radii.bottomRight.x,
      y: clip.y + clip.height - radii.bottomRight.y,
      width: radii.bottomRight.x,
      height: radii.bottomRight.y,
    },
    {
      x: clip.x,
      y: clip.y + clip.height - radii.bottomLeft.y,
      width: radii.bottomLeft.x,
      height: radii.bottomLeft.y,
    },
  ];
  return corners.some((corner) => nativeBoxesOverlap(visible, corner));
}
