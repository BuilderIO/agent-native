import { useT } from "@agent-native/core/client/i18n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  MIN_SLIDE_OBJECT_SIZE,
  readSlideObjectTransformSnapshot,
  resizeTransformedSlideObject,
  type ResizeHandle,
  type SlideObjectGeometry,
  type SlideObjectTransformSnapshot,
} from "./slide-object-interactions";

interface ImageCropOverlayProps {
  frame: HTMLElement;
  viewport: HTMLElement;
  image: HTMLImageElement;
  canvas: HTMLElement;
  onFinish: (commit: boolean, changed: boolean) => void;
}

type CropGesture = {
  pointerId: number;
  kind: "move-image" | "resize-frame";
  handle?: ResizeHandle;
  pointer: { x: number; y: number };
  geometry: SlideObjectGeometry;
  transform: SlideObjectTransformSnapshot;
  image: { left: number; top: number; width: number; height: number };
  viewport: { left: number; top: number };
};

type CropDomSnapshot = {
  frameStyle: string | null;
  viewportStyle: string | null;
  imageStyle: string | null;
  frame: SlideObjectGeometry;
  image: SlideObjectGeometry;
  previewStyles: Array<[HTMLElement, string, string, string]>;
};

const CROP_HANDLES: ResizeHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

function handlePosition(handle: ResizeHandle): CSSProperties {
  const vertical = handle.includes("n")
    ? "n"
    : handle.includes("s")
      ? "s"
      : "c";
  const horizontal = handle.includes("w")
    ? "w"
    : handle.includes("e")
      ? "e"
      : "c";
  const style: CSSProperties = {
    position: "absolute",
    width: handle.length === 1 ? 24 : 16,
    height: handle.length === 1 ? 8 : 16,
    padding: 0,
    border: 0,
    background: "transparent",
    boxSizing: "border-box",
    touchAction: "none",
    cursor: HANDLE_CURSORS[handle],
    zIndex: 3,
  };

  if (handle.length === 1) {
    if (vertical === "n") {
      style.top = -4;
      style.left = "50%";
      style.transform = "translateX(-50%)";
    } else if (vertical === "s") {
      style.bottom = -4;
      style.left = "50%";
      style.transform = "translateX(-50%)";
    } else if (horizontal === "w") {
      style.left = -8;
      style.top = "50%";
      style.transform = "translateY(-50%)";
    } else {
      style.right = -8;
      style.top = "50%";
      style.transform = "translateY(-50%)";
    }
  } else {
    if (vertical === "n") style.top = 0;
    else style.bottom = 0;
    if (horizontal === "w") style.left = 0;
    else style.right = 0;
  }
  return style;
}

function setPreviewStyle(
  element: HTMLElement,
  property: string,
  value: string,
  snapshots: Array<[HTMLElement, string, string, string]>,
) {
  snapshots.push([
    element,
    property,
    element.style.getPropertyValue(property),
    element.style.getPropertyPriority(property),
  ]);
  element.style.setProperty(property, value);
}

function restorePreviewStyles(
  snapshots: Array<[HTMLElement, string, string, string]>,
) {
  for (const [element, property, value, priority] of snapshots) {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  }
}

function sameGeometry(
  left: SlideObjectGeometry,
  right: SlideObjectGeometry,
): boolean {
  return (
    Math.abs(left.x - right.x) < 0.5 &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function clampResizeDelta(
  delta: { x: number; y: number },
  handle: ResizeHandle,
  frame: SlideObjectGeometry,
  image: SlideObjectGeometry,
): { x: number; y: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const minWidth = Math.min(MIN_SLIDE_OBJECT_SIZE, image.width);
  const minHeight = Math.min(MIN_SLIDE_OBJECT_SIZE, image.height);
  const next = { ...delta };

  if (handle.includes("w")) {
    next.x = clamp(
      delta.x,
      image.x,
      Math.min(
        image.x + image.width - minWidth,
        frame.width - MIN_SLIDE_OBJECT_SIZE,
      ),
    );
  } else if (handle.includes("e")) {
    next.x = clamp(
      delta.x,
      Math.max(
        MIN_SLIDE_OBJECT_SIZE - frame.width,
        image.x + minWidth - frame.width,
      ),
      image.x + image.width - frame.width,
    );
  }

  if (handle.includes("n")) {
    next.y = clamp(
      delta.y,
      image.y,
      Math.min(
        image.y + image.height - minHeight,
        frame.height - MIN_SLIDE_OBJECT_SIZE,
      ),
    );
  } else if (handle.includes("s")) {
    next.y = clamp(
      delta.y,
      Math.max(
        MIN_SLIDE_OBJECT_SIZE - frame.height,
        image.y + minHeight - frame.height,
      ),
      image.y + image.height - frame.height,
    );
  }
  return next;
}

function clampImageOffset(
  offset: number,
  frameSize: number,
  imageSize: number,
) {
  return Math.min(0, Math.max(frameSize - imageSize, offset));
}

export function writeImageCropPercentGeometry(
  image: HTMLImageElement,
  viewport: HTMLElement,
): boolean {
  const width = viewport.clientWidth || viewport.offsetWidth;
  const height = viewport.clientHeight || viewport.offsetHeight;
  if (width <= 0 || height <= 0) return false;
  image.style.left = `${(image.offsetLeft / width) * 100}%`;
  image.style.top = `${(image.offsetTop / height) * 100}%`;
  image.style.width = `${(image.offsetWidth / width) * 100}%`;
  image.style.height = `${(image.offsetHeight / height) * 100}%`;
  return true;
}

function updateOutsideImageMasks(
  masks: Array<HTMLElement | null>,
  viewport: HTMLElement,
  image: HTMLImageElement,
) {
  const crop = {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    right: viewport.offsetLeft + viewport.offsetWidth,
    bottom: viewport.offsetTop + viewport.offsetHeight,
  };
  const imageBounds = {
    left: crop.left + image.offsetLeft,
    top: crop.top + image.offsetTop,
    right: crop.left + image.offsetLeft + image.offsetWidth,
    bottom: crop.top + image.offsetTop + image.offsetHeight,
  };
  const overlapLeft = Math.max(crop.left, imageBounds.left);
  const overlapTop = Math.max(crop.top, imageBounds.top);
  const overlapWidth = Math.max(
    0,
    Math.min(crop.right, imageBounds.right) - overlapLeft,
  );
  const overlapHeight = Math.max(
    0,
    Math.min(crop.bottom, imageBounds.bottom) - overlapTop,
  );
  const regions = [
    {
      left: overlapLeft,
      top: imageBounds.top,
      width: overlapWidth,
      height: Math.max(0, crop.top - imageBounds.top),
    },
    {
      left: overlapLeft,
      top: crop.bottom,
      width: overlapWidth,
      height: Math.max(0, imageBounds.bottom - crop.bottom),
    },
    {
      left: imageBounds.left,
      top: overlapTop,
      width: Math.max(0, crop.left - imageBounds.left),
      height: overlapHeight,
    },
    {
      left: crop.right,
      top: overlapTop,
      width: Math.max(0, imageBounds.right - crop.right),
      height: overlapHeight,
    },
  ];
  regions.forEach((region, index) => {
    const mask = masks[index];
    if (!mask) return;
    mask.style.display = region.width > 0 && region.height > 0 ? "" : "none";
    mask.style.left = `${region.left}px`;
    mask.style.top = `${region.top}px`;
    mask.style.width = `${region.width}px`;
    mask.style.height = `${region.height}px`;
  });
}

function positionLabel(handle: ResizeHandle, t: ReturnType<typeof useT>) {
  const names: Record<string, string> = {
    n: t("styleInspector.top"),
    e: t("styleInspector.right"),
    s: t("styleInspector.bottom"),
    w: t("styleInspector.left"),
  };
  if (handle.length === 1) return names[handle];
  const vertical = handle[0] === "n" ? names.n : names.s;
  const horizontal = handle[1] === "w" ? names.w : names.e;
  return `${vertical} ${horizontal}`;
}

function readGeometry(element: HTMLElement): SlideObjectGeometry {
  return {
    x: element.offsetLeft,
    y: element.offsetTop,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

function readPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function transformMatrix(
  transform: string,
): [number, number, number, number, number, number] | null {
  if (!transform || transform === "none") return [1, 0, 0, 1, 0, 0];
  if (typeof DOMMatrixReadOnly !== "undefined") {
    const matrix = new DOMMatrixReadOnly(transform);
    if (matrix.is2D) {
      return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    }
  }
  const rotation = transform.match(
    /^rotate(?:z)?\(\s*(-?(?:\d+\.?\d*|\.\d+))deg\s*\)$/i,
  );
  if (rotation) {
    const angle = (Number(rotation[1]) * Math.PI) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [cosine, sine, -sine, cosine, 0, 0];
  }
  const matrix = transform.match(/^matrix\(\s*([^)]*)\)$/i);
  const values = matrix?.[1]?.split(",").map(Number);
  if (values?.length === 6 && values.every(Number.isFinite)) {
    return values as [number, number, number, number, number, number];
  }
  return null;
}

function transformOriginOffset(
  token: string | undefined,
  dimension: number,
): number {
  if (!token || token === "center") return dimension / 2;
  if (token === "left" || token === "top") return 0;
  if (token === "right" || token === "bottom") return dimension;
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return dimension / 2;
  if (token.endsWith("%")) return (value * dimension) / 100;
  return value;
}

function framePointInCanvas(
  geometry: SlideObjectGeometry,
  transform: SlideObjectTransformSnapshot,
  point: { x: number; y: number },
): { x: number; y: number } | null {
  const matrix = transformMatrix(transform.transform);
  if (!matrix) return null;
  const [a, b, c, d, e, f] = matrix;
  const tokens = transform.transformOrigin.trim().split(/\s+/);
  const origin = {
    x: transformOriginOffset(tokens[0], geometry.width),
    y: transformOriginOffset(tokens[1], geometry.height),
  };
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return {
    x: geometry.x + origin.x + a * x + c * y + e,
    y: geometry.y + origin.y + b * x + d * y + f,
  };
}

function canvasPointInFrame(
  geometry: SlideObjectGeometry,
  transform: SlideObjectTransformSnapshot,
  point: { x: number; y: number },
): { x: number; y: number } | null {
  const matrix = transformMatrix(transform.transform);
  if (!matrix) return null;
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  const tokens = transform.transformOrigin.trim().split(/\s+/);
  const origin = {
    x: transformOriginOffset(tokens[0], geometry.width),
    y: transformOriginOffset(tokens[1], geometry.height),
  };
  const x = point.x - geometry.x - origin.x - e;
  const y = point.y - geometry.y - origin.y - f;
  return {
    x: origin.x + (d * x - c * y) / determinant,
    y: origin.y + (a * y - b * x) / determinant,
  };
}

function pointerDeltaInCanvas(
  canvas: HTMLElement,
  start: { x: number; y: number },
  current: { x: number; y: number },
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.offsetWidth > 0 ? rect.width / canvas.offsetWidth : 1;
  const scaleY =
    canvas.offsetHeight > 0 ? rect.height / canvas.offsetHeight : 1;
  return {
    x: (current.x - start.x) / (scaleX || 1),
    y: (current.y - start.y) / (scaleY || 1),
  };
}

function pointerDeltaInFrame(
  transform: string,
  delta: { x: number; y: number },
): { x: number; y: number } | null {
  const matrix = transformMatrix(transform);
  if (!matrix) return null;
  const [a, b, c, d] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  return {
    x: (d * delta.x - c * delta.y) / determinant,
    y: (a * delta.y - b * delta.x) / determinant,
  };
}

export default function ImageCropOverlay({
  frame,
  viewport,
  image,
  canvas,
  onFinish,
}: ImageCropOverlayProps) {
  const t = useT();
  const activeGestureRef = useRef<CropGesture | null>(null);
  const snapshotRef = useRef<CropDomSnapshot | null>(null);
  const finishRef = useRef(onFinish);
  const finishedRef = useRef(false);
  const cropMaskRefs = useRef<Array<HTMLDivElement | null>>([]);

  useLayoutEffect(() => {
    const previewStyles: Array<[HTMLElement, string, string, string]> = [];
    const initialStyles = {
      frameStyle: frame.getAttribute("style"),
      viewportStyle: viewport.getAttribute("style"),
      imageStyle: image.getAttribute("style"),
    };
    frame.style.boxSizing = "border-box";
    setPreviewStyle(viewport, "overflow", "visible", previewStyles);
    setPreviewStyle(viewport, "clip-path", "none", previewStyles);
    setPreviewStyle(viewport, "border-radius", "0", previewStyles);
    image.style.position = "absolute";
    image.style.left = `${image.offsetLeft}px`;
    image.style.top = `${image.offsetTop}px`;
    image.style.width = `${image.offsetWidth}px`;
    image.style.height = `${image.offsetHeight}px`;
    image.style.maxWidth = "none";
    updateOutsideImageMasks(cropMaskRefs.current, viewport, image);
    snapshotRef.current = {
      ...initialStyles,
      frame: readGeometry(frame),
      image: {
        x: image.offsetLeft,
        y: image.offsetTop,
        width: image.offsetWidth,
        height: image.offsetHeight,
      },
      previewStyles,
    };
  }, [frame, image, viewport]);

  useEffect(() => {
    finishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const restore = () => {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;
      if (snapshot.frameStyle === null) frame.removeAttribute("style");
      else frame.setAttribute("style", snapshot.frameStyle);
      if (snapshot.viewportStyle === null) viewport.removeAttribute("style");
      else viewport.setAttribute("style", snapshot.viewportStyle);
      if (snapshot.imageStyle === null) image.removeAttribute("style");
      else image.setAttribute("style", snapshot.imageStyle);
    };

    const finish = (commit: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      activeGestureRef.current = null;
      const snapshot = snapshotRef.current;
      const changed = Boolean(
        snapshot &&
        (!sameGeometry(snapshot.frame, readGeometry(frame)) ||
          !sameGeometry(snapshot.image, {
            x: image.offsetLeft,
            y: image.offsetTop,
            width: image.offsetWidth,
            height: image.offsetHeight,
          })),
      );
      if (snapshot) restorePreviewStyles(snapshot.previewStyles);
      if (!commit) restore();
      finishRef.current(commit, changed);
    };

    const onPointerMove = (event: PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      const delta = pointerDeltaInCanvas(canvas, gesture.pointer, {
        x: event.clientX,
        y: event.clientY,
      });

      if (gesture.kind === "move-image") {
        const localDelta = pointerDeltaInFrame(
          gesture.transform.transform,
          delta,
        );
        if (!localDelta) return;
        image.style.left = `${clampImageOffset(
          gesture.image.left + localDelta.x,
          viewport.offsetWidth,
          image.offsetWidth,
        )}px`;
        image.style.top = `${clampImageOffset(
          gesture.image.top + localDelta.y,
          viewport.offsetHeight,
          image.offsetHeight,
        )}px`;
        updateOutsideImageMasks(cropMaskRefs.current, viewport, image);
        return;
      }

      if (!gesture.handle) return;
      const localDelta = pointerDeltaInFrame(
        gesture.transform.transform,
        delta,
      );
      const matrix = transformMatrix(gesture.transform.transform);
      if (!localDelta || !matrix) return;
      const boundedDelta = clampResizeDelta(
        localDelta,
        gesture.handle,
        gesture.geometry,
        {
          x: gesture.image.left,
          y: gesture.image.top,
          width: gesture.image.width,
          height: gesture.image.height,
        },
      );
      const boundedCanvasDelta = {
        x: matrix[0] * boundedDelta.x + matrix[2] * boundedDelta.y,
        y: matrix[1] * boundedDelta.x + matrix[3] * boundedDelta.y,
      };
      const next = resizeTransformedSlideObject(
        gesture.geometry,
        gesture.transform,
        {
          handle: gesture.handle,
          dx: boundedCanvasDelta.x,
          dy: boundedCanvasDelta.y,
          preserveAspectRatio: false,
          minSize: MIN_SLIDE_OBJECT_SIZE,
        },
      );
      if (!next) return;

      const imageInFrame = {
        x: gesture.viewport.left + gesture.image.left,
        y: gesture.viewport.top + gesture.image.top,
      };
      const fixedImagePoint = framePointInCanvas(
        gesture.geometry,
        gesture.transform,
        imageInFrame,
      );
      if (!fixedImagePoint) return;
      const nextImagePoint = canvasPointInFrame(
        next,
        gesture.transform,
        fixedImagePoint,
      );
      if (!nextImagePoint) return;

      frame.style.left = `${next.x}px`;
      frame.style.top = `${next.y}px`;
      frame.style.width = `${next.width}px`;
      frame.style.height = `${next.height}px`;
      image.style.left = `${nextImagePoint.x - gesture.viewport.left}px`;
      image.style.top = `${nextImagePoint.y - gesture.viewport.top}px`;
      updateOutsideImageMasks(cropMaskRefs.current, viewport, image);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (activeGestureRef.current?.pointerId === event.pointerId) {
        activeGestureRef.current = null;
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (activeGestureRef.current?.pointerId === event.pointerId) {
        finish(false);
      }
    };

    const onOutsidePointerDown = (event: PointerEvent) => {
      if (!frame.contains(event.target as Node)) finish(true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(true);
      } else if (event.key !== "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [canvas, frame, image, viewport]);

  const beginGesture = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    kind: CropGesture["kind"],
    handle?: ResizeHandle,
  ) => {
    if (event.button !== 0 || finishedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const geometry = readGeometry(frame);
    const transform = readSlideObjectTransformSnapshot(frame);
    const imageLeft = readPixels(image.style.left, image.offsetLeft);
    const imageTop = readPixels(image.style.top, image.offsetTop);
    const viewportLeft = viewport.offsetLeft;
    const viewportTop = viewport.offsetTop;
    activeGestureRef.current = {
      pointerId: event.pointerId,
      kind,
      handle,
      pointer: { x: event.clientX, y: event.clientY },
      geometry,
      transform,
      image: {
        left: imageLeft,
        top: imageTop,
        width: image.offsetWidth,
        height: image.offsetHeight,
      },
      viewport: { left: viewportLeft, top: viewportTop },
    };
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="group"
      aria-label={t("editorToolbar.cropImage")}
      data-slide-crop-overlay="true"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        beginGesture(event, "move-image");
      }}
      className="text-black"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        boxSizing: "border-box",
        outline: "1px solid currentColor",
        outlineOffset: -1,
        background: "transparent",
        touchAction: "none",
        cursor: "move",
      }}
    >
      <div aria-hidden="true" data-crop-masks="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            ref={(element) => {
              cropMaskRefs.current[index] = element;
            }}
            data-crop-mask={index}
            className="pointer-events-none absolute z-[1] bg-black/50"
          />
        ))}
      </div>
      {CROP_HANDLES.map((handle) => (
        <button
          key={handle}
          type="button"
          data-crop-handle={handle}
          aria-label={t("editorToolbar.cropHandle", {
            position: positionLabel(handle, t),
          })}
          onPointerDown={(event) => beginGesture(event, "resize-frame", handle)}
          style={handlePosition(handle)}
        >
          {handle.length === 1 ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-0.5 inset-y-0.5 rounded-sm bg-black"
            />
          ) : (
            <>
              <span
                aria-hidden="true"
                className={`absolute h-[3px] w-[9px] bg-black ${handle.includes("w") ? "left-0" : "right-0"} ${handle.includes("n") ? "top-0" : "bottom-0"}`}
              />
              <span
                aria-hidden="true"
                className={`absolute h-[9px] w-[3px] bg-black ${handle.includes("w") ? "left-0" : "right-0"} ${handle.includes("n") ? "top-0" : "bottom-0"}`}
              />
            </>
          )}
        </button>
      ))}
    </div>,
    frame,
  );
}
