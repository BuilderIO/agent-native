import type { ElementInfo } from "@/components/design/types";

type PositionCoordinateContext = Pick<
  ElementInfo,
  | "positionReferenceRect"
  | "positionContainingBlockOrigin"
  | "positionContainingBlockTransform"
>;

type PositionTransform = NonNullable<
  ElementInfo["positionContainingBlockTransform"]
>;

const IDENTITY_TRANSFORM: PositionTransform = { a: 1, b: 0, c: 0, d: 1 };

function documentRect(element: Element, view: Window) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x + view.scrollX,
    y: rect.y + view.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

function establishesContainingBlock(styles: CSSStyleDeclaration): boolean {
  const translate = styles.getPropertyValue("translate");
  const rotate = styles.getPropertyValue("rotate");
  const scale = styles.getPropertyValue("scale");
  const backdropFilter = styles.getPropertyValue("backdrop-filter");
  return (
    (translate !== "" && translate !== "none") ||
    (rotate !== "" && rotate !== "none") ||
    (scale !== "" && scale !== "none") ||
    styles.transform !== "none" ||
    styles.perspective !== "none" ||
    styles.filter !== "none" ||
    (backdropFilter !== "" && backdropFilter !== "none") ||
    /(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(styles.contain) ||
    /transform|perspective|filter|contain/.test(styles.willChange) ||
    styles.contentVisibility === "auto"
  );
}

function absoluteContainingBlock(styles: CSSStyleDeclaration): boolean {
  return styles.position !== "static" || establishesContainingBlock(styles);
}

function fixedContainingBlock(styles: CSSStyleDeclaration): boolean {
  return establishesContainingBlock(styles);
}

function multiplyTransforms(
  left: PositionTransform,
  right: PositionTransform,
): PositionTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
  };
}

function elementTransform(styles: CSSStyleDeclaration): PositionTransform {
  const transform =
    styles.transform === "none"
      ? IDENTITY_TRANSFORM
      : new DOMMatrixReadOnly(styles.transform);
  let result = {
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
  };

  const scaleValue = styles.getPropertyValue("scale");
  if (scaleValue && scaleValue !== "none") {
    const [scaleX = "1", scaleY = scaleX] = scaleValue.trim().split(/\s+/u);
    const parsedScaleX = Number.parseFloat(scaleX);
    const parsedScaleY = Number.parseFloat(scaleY);
    result = multiplyTransforms(
      { a: parsedScaleX, b: 0, c: 0, d: parsedScaleY },
      result,
    );
  }

  const rotateValue = styles.getPropertyValue("rotate");
  if (rotateValue && rotateValue !== "none") {
    const parts = rotateValue.trim().split(/\s+/u);
    const angle = parts[parts.length - 1] ?? "0deg";
    const axis = parts.length > 1 ? parts[0] : "z";
    const rotateFunction =
      axis === "x" || axis === "y" ? `rotate${axis.toUpperCase()}` : "rotate";
    const rotation = new DOMMatrixReadOnly(`${rotateFunction}(${angle})`);
    result = multiplyTransforms(
      { a: rotation.a, b: rotation.b, c: rotation.c, d: rotation.d },
      result,
    );
  }

  const zoom = Number.parseFloat(styles.getPropertyValue("zoom"));
  if (Number.isFinite(zoom) && zoom !== 1) {
    result = multiplyTransforms({ a: zoom, b: 0, c: 0, d: zoom }, result);
  }
  return result;
}

function containingBlockTransform(
  element: Element,
  view: Window,
): PositionTransform {
  let transform = IDENTITY_TRANSFORM;
  for (
    let ancestor: Element | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    transform = multiplyTransforms(
      elementTransform(view.getComputedStyle(ancestor)),
      transform,
    );
  }
  return transform;
}

function positionContainingBlock(
  element: Element,
  view: Window,
): Element | null {
  const fixed = view.getComputedStyle(element).position === "fixed";
  for (
    let ancestor = element.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const styles = view.getComputedStyle(ancestor);
    if (
      fixed ? fixedContainingBlock(styles) : absoluteContainingBlock(styles)
    ) {
      return ancestor;
    }
  }
  return null;
}

function paddingEdgeOrigin(
  element: Element,
  view: Window,
  transform: PositionTransform,
): { x: number; y: number } {
  const htmlElement = element as HTMLElement;
  const quaddedElement = element as Element & {
    getBoxQuads?: (options?: { box?: string }) => Array<{
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      p4: { x: number; y: number };
    }>;
  };
  const paddingQuad = quaddedElement.getBoxQuads?.({ box: "padding" })?.[0];
  const scrollX = htmlElement.scrollLeft || 0;
  const scrollY = htmlElement.scrollTop || 0;
  if (paddingQuad) {
    return {
      x:
        paddingQuad.p1.x +
        view.scrollX -
        transform.a * scrollX -
        transform.c * scrollY,
      y:
        paddingQuad.p1.y +
        view.scrollY -
        transform.b * scrollX -
        transform.d * scrollY,
    };
  }

  const rect = documentRect(element, view);
  return {
    x:
      rect.x +
      transform.a * (htmlElement.clientLeft - scrollX) +
      transform.c * (htmlElement.clientTop - scrollY),
    y:
      rect.y +
      transform.b * (htmlElement.clientLeft - scrollX) +
      transform.d * (htmlElement.clientTop - scrollY),
  };
}

export function measurePositionCoordinateContext(
  element: Element,
  view: Window,
): PositionCoordinateContext {
  let frame = element.parentElement;
  while (frame && frame.getAttribute("data-an-primitive") !== "frame") {
    frame = frame.parentElement;
  }

  const documentRoot = element.ownerDocument.documentElement;
  const positionReferenceRect = frame
    ? documentRect(frame, view)
    : {
        x: 0,
        y: 0,
        width: documentRoot.clientWidth,
        height: documentRoot.clientHeight,
      };
  const containingBlock = positionContainingBlock(element, view);
  if (!containingBlock) {
    return {
      positionReferenceRect,
      positionContainingBlockOrigin: { x: 0, y: 0 },
      positionContainingBlockTransform: IDENTITY_TRANSFORM,
    };
  }

  const transform = containingBlockTransform(containingBlock, view);
  return {
    positionReferenceRect,
    positionContainingBlockOrigin: paddingEdgeOrigin(
      containingBlock,
      view,
      transform,
    ),
    positionContainingBlockTransform: transform,
  };
}
