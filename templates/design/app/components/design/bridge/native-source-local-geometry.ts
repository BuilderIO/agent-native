export interface NativeSourceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeAxisTransform {
  anchorX: number;
  anchorY: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export function projectNativeSourceBox(
  box: NativeSourceBox,
  targetOrigin: { x: number; y: number },
  descendants: readonly NativeAxisTransform[],
): NativeSourceBox | null {
  if (
    ![
      box.x,
      box.y,
      box.width,
      box.height,
      targetOrigin.x,
      targetOrigin.y,
    ].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0
  )
    return null;
  let projected = { ...box };
  for (const transform of descendants) {
    if (
      ![
        transform.anchorX,
        transform.anchorY,
        transform.originX,
        transform.originY,
        transform.scaleX,
        transform.scaleY,
        transform.translateX,
        transform.translateY,
      ].every(Number.isFinite) ||
      transform.scaleX <= 0 ||
      transform.scaleY <= 0
    )
      return null;
    const pivotX = transform.anchorX + transform.originX;
    const pivotY = transform.anchorY + transform.originY;
    projected = {
      x:
        pivotX +
        (projected.x - pivotX) * transform.scaleX +
        transform.translateX,
      y:
        pivotY +
        (projected.y - pivotY) * transform.scaleY +
        transform.translateY,
      width: projected.width * transform.scaleX,
      height: projected.height * transform.scaleY,
    };
  }
  return {
    x: projected.x - targetOrigin.x,
    y: projected.y - targetOrigin.y,
    width: projected.width,
    height: projected.height,
  };
}
