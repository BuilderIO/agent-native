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
type Point = { x: number; y: number };
type BoxQuad = { p1: Point; p2: Point; p3: Point; p4: Point };

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
    // coercion-ok: denied preview DOM reads mean the offset is unknown; callers skip the whole coordinate measurement.
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

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function supportsAffine2DGeometry(element: Element, view: Window): boolean {
  for (
    let ancestor: Element | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const styles = view.getComputedStyle(ancestor);
    if (
      (styles.perspective !== "none" && styles.perspective !== "") ||
      styles.getPropertyValue("transform-style") === "preserve-3d" ||
      (styles.getPropertyValue("offset-path") !== "none" &&
        styles.getPropertyValue("offset-path") !== "")
    ) {
      return false;
    }

    if (styles.transform !== "none") {
      if (typeof DOMMatrixReadOnly === "undefined") return false;
      const matrix = new DOMMatrixReadOnly(styles.transform);
      if (!matrix.is2D) return false;
    }

    const rotate = styles.getPropertyValue("rotate").trim();
    if (rotate && rotate !== "none") {
      const parts = rotate.split(/\s+/u);
      if (parts.length > 1 && parts[0] !== "z") return false;
      if (parts.length > 2) return false;
    }

    const translate = styles.getPropertyValue("translate").trim();
    if (translate && translate !== "none") {
      const parts = translate.split(/\s+/u);
      if (parts.length > 2 && parts[2] !== "0" && parts[2] !== "0px") {
        return false;
      }
    }

    const scale = styles.getPropertyValue("scale").trim();
    if (scale && scale !== "none") {
      const parts = scale.split(/\s+/u);
      if (parts.length > 2 && Number(parts[2]) !== 1) return false;
    }
  }
  return true;
}

function cssPixels(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "0") return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/u.exec(normalized);
  if (!match) return null;
  const valueInPixels = Number(match[1]);
  return Number.isFinite(valueInPixels) ? valueInPixels : null;
}

function cssPixelOrZero(value: string): number | null {
  return value.trim() === "" ? 0 : cssPixels(value);
}

function borderBoxDimensions(
  element: Element,
  view: Window,
): { width: number; height: number } | null {
  const styles = view.getComputedStyle(element);
  const width = cssPixels(styles.width);
  const height = cssPixels(styles.height);
  if (width === null || height === null) return null;
  if (styles.boxSizing === "border-box") {
    return width >= 0 && height >= 0 ? { width, height } : null;
  }

  const horizontalExtras = [
    styles.paddingLeft,
    styles.paddingRight,
    styles.borderLeftWidth,
    styles.borderRightWidth,
  ].map(cssPixelOrZero);
  const verticalExtras = [
    styles.paddingTop,
    styles.paddingBottom,
    styles.borderTopWidth,
    styles.borderBottomWidth,
  ].map(cssPixelOrZero);
  if (
    horizontalExtras.some((value) => value === null) ||
    verticalExtras.some((value) => value === null)
  ) {
    return null;
  }
  const borderWidth =
    width + horizontalExtras.reduce<number>((sum, value) => sum + value!, 0);
  const borderHeight =
    height + verticalExtras.reduce<number>((sum, value) => sum + value!, 0);
  return borderWidth >= 0 && borderHeight >= 0
    ? { width: borderWidth, height: borderHeight }
    : null;
}

function borderBoxCorners(
  element: Element,
  view: Window,
  transform: PositionTransform,
): Point[][] | null {
  if (view.getComputedStyle(element).display === "none") return null;
  const quaddedElement = element as Element & {
    getBoxQuads?: (options?: { box?: string }) => BoxQuad[];
  };
  if (typeof quaddedElement.getBoxQuads === "function") {
    const quads = quaddedElement.getBoxQuads({ box: "border" });
    if (quads.length === 0) return null;
    const corners = quads.map((quad) => [quad.p1, quad.p2, quad.p3, quad.p4]);
    return corners.every((quad) => quad.every(finitePoint)) ? corners : null;
  }

  const fragments = Array.from(element.getClientRects());
  if (fragments.length === 0) return null;
  const dimensions =
    fragments.length === 1 ? borderBoxDimensions(element, view) : null;
  const rects =
    fragments.length === 1 ? [element.getBoundingClientRect()] : fragments;
  const quads: Point[][] = [];
  for (const rect of rects) {
    const box = dimensions ?? fragmentDimensions(rect, transform);
    if (
      !box ||
      ![
        rect.x,
        rect.y,
        transform.a,
        transform.b,
        transform.c,
        transform.d,
      ].every(Number.isFinite)
    ) {
      return null;
    }
    quads.push(affineBoxCorners(rect, box, transform));
  }
  return quads;
}

function fragmentDimensions(
  rect: Pick<DOMRect, "width" | "height">,
  transform: PositionTransform,
): { width: number; height: number } | null {
  const a = Math.abs(transform.a);
  const b = Math.abs(transform.b);
  const c = Math.abs(transform.c);
  const d = Math.abs(transform.d);
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  const width = (d * rect.width - c * rect.height) / determinant;
  const height = (a * rect.height - b * rect.width) / determinant;
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 0 &&
    height >= 0
    ? { width, height }
    : null;
}

function affineBoxCorners(
  rect: Pick<DOMRect, "x" | "y">,
  dimensions: { width: number; height: number },
  transform: PositionTransform,
): Point[] {
  const xOffsets = [
    0,
    transform.a * dimensions.width,
    transform.c * dimensions.height,
    transform.a * dimensions.width + transform.c * dimensions.height,
  ];
  const yOffsets = [
    0,
    transform.b * dimensions.width,
    transform.d * dimensions.height,
    transform.b * dimensions.width + transform.d * dimensions.height,
  ];
  const firstCorner = {
    x: rect.x - Math.min(...xOffsets),
    y: rect.y - Math.min(...yOffsets),
  };
  return [
    firstCorner,
    {
      x: firstCorner.x + transform.a * dimensions.width,
      y: firstCorner.y + transform.b * dimensions.width,
    },
    {
      x:
        firstCorner.x +
        transform.a * dimensions.width +
        transform.c * dimensions.height,
      y:
        firstCorner.y +
        transform.b * dimensions.width +
        transform.d * dimensions.height,
    },
    {
      x: firstCorner.x + transform.c * dimensions.height,
      y: firstCorner.y + transform.d * dimensions.height,
    },
  ];
}

function absolutePositionContainingBlockForChild(
  parent: Element | null,
  view: Window,
): Element | null {
  for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
    if (absoluteContainingBlock(view.getComputedStyle(ancestor))) {
      return ancestor;
    }
  }
  return null;
}

function inversePoint(
  point: Point,
  origin: Point,
  transform: PositionTransform,
): Point | null {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const result = {
    x: (transform.d * dx - transform.c * dy) / determinant,
    y: (-transform.b * dx + transform.a * dy) / determinant,
  };
  return finitePoint(result) ? result : null;
}

function absoluteSiblingPaddingOrigin(
  containingBlock: Element,
  view: Window,
  transform: PositionTransform,
  renderOffsetRoot: Element | null,
  renderOffset: PositionCoordinateRenderOffset,
): Point | null {
  const htmlElement = containingBlock as HTMLElement;
  const quaddedElement = containingBlock as Element & {
    getBoxQuads?: (options?: { box?: string }) => BoxQuad[];
  };
  let paddingQuad: BoxQuad | undefined;
  if (typeof quaddedElement.getBoxQuads === "function") {
    paddingQuad = quaddedElement.getBoxQuads?.({ box: "padding" })?.[0];
    if (!paddingQuad || !finitePoint(paddingQuad.p1)) return null;
  }
  const scrollX = htmlElement.scrollLeft || 0;
  const scrollY = htmlElement.scrollTop || 0;
  let origin: Point;
  if (paddingQuad && finitePoint(paddingQuad.p1)) {
    origin = {
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
  } else {
    const corners = borderBoxCorners(containingBlock, view, transform);
    const borderOrigin = corners?.length === 1 ? corners[0]?.[0] : null;
    if (!borderOrigin) return null;
    origin = {
      x:
        borderOrigin.x +
        view.scrollX +
        transform.a * (htmlElement.clientLeft - scrollX) +
        transform.c * (htmlElement.clientTop - scrollY),
      y:
        borderOrigin.y +
        view.scrollY +
        transform.b * (htmlElement.clientLeft - scrollX) +
        transform.d * (htmlElement.clientTop - scrollY),
    };
  }
  return finitePoint(origin)
    ? positionOriginWithRenderOffset(
        origin,
        renderOffsetRoot,
        containingBlock,
        renderOffset,
      )
    : null;
}

export function measureAbsoluteSiblingVisualOrigin(
  element: Element,
  view: Window,
  renderOffset: PositionCoordinateRenderOffset,
): Point | null {
  try {
    if (!supportsAffine2DGeometry(element, view)) return null;

    const containingBlock = absolutePositionContainingBlockForChild(
      element.parentElement,
      view,
    );
    const containingBlockTransformValue = containingBlock
      ? containingBlockTransform(containingBlock, view)
      : IDENTITY_TRANSFORM;
    const targetTransform = containingBlockTransform(element, view);
    const renderOffsetRoot = boardRenderOffsetRoot(element);
    const containingBlockOrigin = containingBlock
      ? absoluteSiblingPaddingOrigin(
          containingBlock,
          view,
          containingBlockTransformValue,
          renderOffsetRoot,
          renderOffset,
        )
      : positionOriginWithRenderOffset(
          { x: 0, y: 0 },
          renderOffsetRoot,
          null,
          renderOffset,
        );
    if (!containingBlockOrigin) return null;

    const targetQuads = borderBoxCorners(element, view, targetTransform);
    if (!targetQuads) return null;
    const targetPoints = targetQuads
      .flat()
      .map((point) =>
        positionOriginWithRenderOffset(
          { x: point.x + view.scrollX, y: point.y + view.scrollY },
          renderOffsetRoot,
          element,
          renderOffset,
        ),
      );
    const localPoints = targetPoints.map((point) =>
      inversePoint(point, containingBlockOrigin, containingBlockTransformValue),
    );
    if (localPoints.some((point) => !point)) return null;
    const points = localPoints as Point[];
    const origin = {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
    };
    return finitePoint(origin) ? origin : null;
  } catch {
    // coercion-ok: Unavailable geometry returns null so paste-to-replace aborts before changing source content.
    return null;
  }
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
