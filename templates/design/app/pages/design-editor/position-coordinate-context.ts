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

export type PositionCoordinateRenderOffset = { x: number; y: number };

const IDENTITY_TRANSFORM: PositionTransform = { a: 1, b: 0, c: 0, d: 1 };
const BOARD_CONTENT_OFFSET_X_ATTRIBUTE = "data-agent-native-content-offset-x";
const BOARD_CONTENT_OFFSET_Y_ATTRIBUTE = "data-agent-native-content-offset-y";

function boardRenderOffsetRoot(element: Element): Element | null {
  const body = element.ownerDocument.body;
  if (!body) return null;

  let root = element;
  while (root.parentElement && root.parentElement !== body) {
    root = root.parentElement;
  }
  return root.parentElement === body &&
    root.hasAttribute("data-agent-native-node-id")
    ? root
    : null;
}

function positionOriginWithRenderOffset(
  origin: { x: number; y: number },
  renderOffsetRoot: Element | null,
  originElement: Element | null,
  renderOffset: PositionCoordinateRenderOffset,
): { x: number; y: number } {
  if (
    !renderOffsetRoot ||
    (originElement && renderOffsetRoot.contains(originElement))
  ) {
    return origin;
  }
  return {
    x: origin.x + renderOffset.x,
    y: origin.y + renderOffset.y,
  };
}

export function positionCoordinateRenderOffsetForWindow(
  view: Window,
): PositionCoordinateRenderOffset | null {
  try {
    const offsetStyle = view.document.querySelector(
      "style[data-agent-native-content-offset]",
    );
    if (!offsetStyle) return { x: 0, y: 0 };
    const xAttribute = offsetStyle.getAttribute(
      BOARD_CONTENT_OFFSET_X_ATTRIBUTE,
    );
    const yAttribute = offsetStyle.getAttribute(
      BOARD_CONTENT_OFFSET_Y_ATTRIBUTE,
    );
    const x = xAttribute?.trim() ? Number(xAttribute) : Number.NaN;
    const y = yAttribute?.trim() ? Number(yAttribute) : Number.NaN;
    const cssOffset: PositionCoordinateRenderOffset | null =
      Number.isFinite(x) && Number.isFinite(y)
        ? { x, y }
        : (() => {
            const match =
              /translate:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))px\s+(-?(?:\d+(?:\.\d*)?|\.\d+))px/u.exec(
                offsetStyle.textContent ?? "",
              );
            return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
          })();
    if (!cssOffset) return null;
    const body = view.document.body;
    if (!body) return null;

    // The injected translate is on a direct body child. Map its CSS-pixel
    // vector through body/html transforms and zoom, but leave the root's own
    // authored transform alone because CSS applies `translate` outside it.
    const ancestorTransform = containingBlockTransform(body, view);
    const offset = {
      x: ancestorTransform.a * cssOffset.x + ancestorTransform.c * cssOffset.y,
      y: ancestorTransform.b * cssOffset.x + ancestorTransform.d * cssOffset.y,
    };
    return Number.isFinite(offset.x) && Number.isFinite(offset.y)
      ? offset
      : null;
  } catch {
    return null;
  }
}

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
  renderOffset: PositionCoordinateRenderOffset,
): PositionCoordinateContext {
  let frame = element.parentElement;
  while (frame && frame.getAttribute("data-an-primitive") !== "frame") {
    frame = frame.parentElement;
  }

  const documentRoot = element.ownerDocument.documentElement;
  const isFixed = view.getComputedStyle(element).position === "fixed";
  const scrollX = view.scrollX;
  const scrollY = view.scrollY;
  const renderOffsetRoot = boardRenderOffsetRoot(element);
  const containingBlock = positionContainingBlock(element, view);
  const fixedWithoutContainingBlock = isFixed && !containingBlock;
  const rawPositionReferenceRect = fixedWithoutContainingBlock
    ? {
        x: scrollX,
        y: scrollY,
        width: documentRoot.clientWidth,
        height: documentRoot.clientHeight,
      }
    : frame
      ? documentRect(frame, view)
      : {
          x: 0,
          y: 0,
          width: documentRoot.clientWidth,
          height: documentRoot.clientHeight,
        };
  const normalizedPositionReferenceOrigin = positionOriginWithRenderOffset(
    rawPositionReferenceRect,
    renderOffsetRoot,
    fixedWithoutContainingBlock ? null : frame,
    renderOffset,
  );
  const positionReferenceRect = {
    ...normalizedPositionReferenceOrigin,
    width: rawPositionReferenceRect.width,
    height: rawPositionReferenceRect.height,
  };
  if (!containingBlock) {
    return {
      positionReferenceRect,
      positionContainingBlockOrigin: positionOriginWithRenderOffset(
        fixedWithoutContainingBlock
          ? { x: scrollX, y: scrollY }
          : { x: 0, y: 0 },
        renderOffsetRoot,
        null,
        renderOffset,
      ),
      positionContainingBlockTransform: IDENTITY_TRANSFORM,
    };
  }

  const transform = containingBlockTransform(containingBlock, view);
  return {
    positionReferenceRect,
    positionContainingBlockOrigin: positionOriginWithRenderOffset(
      paddingEdgeOrigin(containingBlock, view, transform),
      renderOffsetRoot,
      containingBlock,
      renderOffset,
    ),
    positionContainingBlockTransform: transform,
  };
}
