import { useT } from "@agent-native/core/client/i18n";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
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
  onFinish: (commit: boolean) => void;
  onImageOptions: () => void;
}

type CropGesture = {
  pointerId: number;
  kind: "move-image" | "resize-frame";
  handle?: ResizeHandle;
  pointer: { x: number; y: number };
  geometry: SlideObjectGeometry;
  transform: SlideObjectTransformSnapshot;
  image: { left: number; top: number };
  viewport: { left: number; top: number };
};

type CropDomSnapshot = {
  frameStyle: string | null;
  viewportStyle: string | null;
  imageStyle: string | null;
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
    width: 8,
    height: 8,
    padding: 0,
    // guard:allow-raw-color - match the existing slide canvas selection blue
    border: "1px solid var(--design-editor-accent-color, #609ff8)",
    borderRadius: 1,
    // guard:allow-raw-color - match the slide canvas resize handle surface
    background: "#fff",
    boxShadow: "none",
    boxSizing: "border-box",
    touchAction: "none",
    cursor: HANDLE_CURSORS[handle],
    zIndex: 2,
  };

  if (vertical === "n") style.top = 0;
  else if (vertical === "s") style.bottom = 0;
  else style.top = "50%";

  if (horizontal === "w") style.left = 0;
  else if (horizontal === "e") style.right = 0;
  else style.left = "50%";

  style.transform = `translate(${horizontal === "w" ? "-50%" : horizontal === "e" ? "50%" : "-50%"}, ${vertical === "n" ? "-50%" : vertical === "s" ? "50%" : "-50%"})`;
  return style;
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
  onImageOptions,
}: ImageCropOverlayProps) {
  const t = useT();
  const activeGestureRef = useRef<CropGesture | null>(null);
  const snapshotRef = useRef<CropDomSnapshot | null>(null);
  const finishRef = useRef(onFinish);
  const finishedRef = useRef(false);

  useLayoutEffect(() => {
    snapshotRef.current = {
      frameStyle: frame.getAttribute("style"),
      viewportStyle: viewport.getAttribute("style"),
      imageStyle: image.getAttribute("style"),
    };
    frame.style.boxSizing = "border-box";
    image.style.position = "absolute";
    image.style.left = `${image.offsetLeft}px`;
    image.style.top = `${image.offsetTop}px`;
    image.style.width = `${image.offsetWidth}px`;
    image.style.height = `${image.offsetHeight}px`;
    image.style.maxWidth = "none";
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
      if (!commit) restore();
      finishRef.current(commit);
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
        image.style.left = `${gesture.image.left + localDelta.x}px`;
        image.style.top = `${gesture.image.top + localDelta.y}px`;
        return;
      }

      if (!gesture.handle) return;
      const next = resizeTransformedSlideObject(
        gesture.geometry,
        gesture.transform,
        {
          handle: gesture.handle,
          dx: delta.x,
          dy: delta.y,
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
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter") {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-image-options-button]")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        finish(true);
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
      image: { left: imageLeft, top: imageTop },
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
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        boxSizing: "border-box",
        // guard:allow-raw-color - match the existing slide canvas selection blue
        outline: "1px solid var(--design-editor-accent-color, #609ff8)",
        outlineOffset: -1,
        background: "transparent",
        touchAction: "none",
        cursor: "move",
      }}
    >
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
        />
      ))}
      <button
        type="button"
        data-image-options-button="true"
        aria-label={t("editorToolbar.imageOptions")}
        title={t("editorToolbar.imageOptions")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onImageOptions();
        }}
        className="absolute right-0 top-[-34px] flex size-7 items-center justify-center rounded border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
        style={{ touchAction: "manipulation", zIndex: 3 }}
      >
        <IconAdjustmentsHorizontal className="size-4" aria-hidden="true" />
      </button>
    </div>,
    frame,
  );
}
