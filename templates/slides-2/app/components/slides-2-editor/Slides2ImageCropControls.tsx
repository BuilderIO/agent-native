import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Slides2ImageCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Slides2ImageCropResult =
  | { fit: "contain" }
  | { fit: "cover"; rect: Slides2ImageCropRect };

export type Slides2ImageCropLabels = {
  title: string;
  description?: string;
  fitMode: string;
  fitCover: string;
  fitContain: string;
  cropRegion: string;
  close: string;
  cancel: string;
  apply: string;
};

export type Slides2ImageCropControlsProps = {
  src: string;
  targetWidth: number;
  targetHeight: number;
  initialFit: "cover" | "contain";
  initialPosition: { x: number; y: number };
  initialRect: Slides2ImageCropRect | null;
  labels: Slides2ImageCropLabels;
  onClose: () => void;
  onApply: (result: Slides2ImageCropResult) => void;
};

type Crop = Slides2ImageCropRect;
type CropHandle = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type CropGesture = {
  pointerId: number;
  handle: CropHandle;
  startX: number;
  startY: number;
  crop: Crop;
};

const handles: { name: Exclude<CropHandle, "move">; className: string }[] = [
  { name: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  {
    name: "n",
    className: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  },
  { name: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  {
    name: "e",
    className: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  },
  { name: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  {
    name: "s",
    className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  },
  { name: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  {
    name: "w",
    className: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  },
];

export function Slides2ImageCropControls({
  src,
  targetWidth,
  targetHeight,
  initialFit,
  initialPosition,
  initialRect,
  labels,
  onClose,
  onApply,
}: Slides2ImageCropControlsProps) {
  const aspect =
    targetWidth > 0 && targetHeight > 0 ? targetWidth / targetHeight : 1;
  const [fit, setFit] = useState<"cover" | "contain">(initialFit);
  const [crop, setCrop] = useState<Crop | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const gestureRef = useRef<CropGesture | null>(null);

  const initializeCrop = useCallback(
    (image: HTMLImageElement) => {
      setCrop(
        initialCrop(
          image.naturalWidth,
          image.naturalHeight,
          aspect,
          initialRect,
          initialPosition,
        ),
      );
    },
    [aspect, initialPosition.x, initialPosition.y, initialRect],
  );

  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    initializeCrop(event.currentTarget);
  };

  useEffect(() => {
    const image = imageRef.current;
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;

    setCrop((current) =>
      current
        ? clampToAspect(
            current,
            aspect,
            image.naturalWidth,
            image.naturalHeight,
          )
        : initialCrop(
            image.naturalWidth,
            image.naturalHeight,
            aspect,
            initialRect,
            initialPosition,
          ),
    );
  }, [aspect, initialPosition.x, initialPosition.y, initialRect]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!crop || !event.isPrimary || event.button !== 0) return;

    const handleElement =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-crop-handle]")
        : null;
    const handle = (handleElement?.dataset.cropHandle ?? "move") as CropHandle;
    gestureRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      crop,
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const image = imageRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !image) return;

    const bounds = image.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const dx = ((event.clientX - gesture.startX) / bounds.width) * 100;
    const dy = ((event.clientY - gesture.startY) / bounds.height) * 100;
    const ratio =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? (aspect * image.naturalHeight) / image.naturalWidth
        : aspect;
    setCrop(
      gesture.handle === "move"
        ? moveCrop(gesture.crop, dx, dy)
        : resizeCrop(gesture.crop, gesture.handle, dx, dy, ratio),
    );
  };

  const finishPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!crop || event.altKey || event.ctrlKey || event.metaKey) return;

    const step = event.shiftKey ? 10 : 1;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (dx === 0 && dy === 0) return;

    event.preventDefault();
    setCrop((current) => (current ? moveCrop(current, dx, dy) : current));
  };

  const onApplyClick = () => {
    if (fit === "contain") {
      onApply({ fit });
      return;
    }
    onApply({
      fit,
      rect: crop ? roundRect(crop) : { x: 0, y: 0, width: 100, height: 100 },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={labels.close}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          {labels.description ? (
            <DialogDescription>{labels.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <ToggleGroup
          aria-label={labels.fitMode}
          type="single"
          value={fit}
          variant="outline"
          size="sm"
          className="mx-auto"
          onValueChange={(value) => {
            if (value === "cover" || value === "contain") setFit(value);
          }}
        >
          <ToggleGroupItem value="cover" className="text-xs">
            {labels.fitCover}
          </ToggleGroupItem>
          <ToggleGroupItem value="contain" className="text-xs">
            {labels.fitContain}
          </ToggleGroupItem>
        </ToggleGroup>

        <div
          className="flex h-[420px] w-full touch-none select-none items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
          style={{
            backgroundImage:
              "repeating-conic-gradient(hsl(var(--muted)) 0 25%, transparent 0 50%)",
            backgroundSize: "12px 12px",
          }}
        >
          <div className="relative inline-flex max-h-full max-w-full">
            <img
              ref={imageRef}
              src={src}
              alt=""
              draggable={false}
              className="block max-h-[420px] max-w-full select-none object-contain"
              onLoad={onImageLoad}
            />
            {fit === "cover" && crop ? (
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                >
                  <div
                    className="absolute inset-x-0 top-0 bg-foreground/40"
                    style={{ height: `${crop.y}%` }}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 bg-foreground/40"
                    style={{ height: `${100 - crop.y - crop.height}%` }}
                  />
                  <div
                    className="absolute left-0 bg-foreground/40"
                    style={{
                      top: `${crop.y}%`,
                      width: `${crop.x}%`,
                      height: `${crop.height}%`,
                    }}
                  />
                  <div
                    className="absolute right-0 bg-foreground/40"
                    style={{
                      top: `${crop.y}%`,
                      width: `${100 - crop.x - crop.width}%`,
                      height: `${crop.height}%`,
                    }}
                  />
                </div>
                <div
                  role="group"
                  aria-label={labels.cropRegion}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                  tabIndex={0}
                  data-crop-handle="move"
                  className="absolute z-10 cursor-move border-2 border-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.width}%`,
                    height: `${crop.height}%`,
                    touchAction: "none",
                  }}
                  onKeyDown={handleCropKeyDown}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishPointerGesture}
                  onPointerCancel={finishPointerGesture}
                  onLostPointerCapture={() => {
                    gestureRef.current = null;
                  }}
                >
                  {handles.map(({ name, className }) => (
                    <span
                      key={name}
                      aria-hidden="true"
                      data-crop-handle={name}
                      className={`absolute size-3 border border-primary bg-background shadow-sm ${className}`}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button onClick={onApplyClick}>{labels.apply}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initialCrop(
  naturalWidth: number,
  naturalHeight: number,
  aspect: number,
  rect: Slides2ImageCropRect | null,
  position: { x: number; y: number },
): Crop {
  if (rect) return clampToAspect(rect, aspect, naturalWidth, naturalHeight);
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  const sourceAspect = naturalWidth / naturalHeight;
  let width = 100;
  let height = 100;
  if (aspect >= sourceAspect) {
    height = (sourceAspect / aspect) * 100;
  } else {
    width = (aspect / sourceAspect) * 100;
  }
  const slackX = 100 - width;
  const slackY = 100 - height;
  return {
    x: clamp((position.x / 100) * slackX, 0, slackX),
    y: clamp((position.y / 100) * slackY, 0, slackY),
    width,
    height,
  };
}

function clampToAspect(
  crop: Crop,
  aspect: number,
  naturalWidth: number,
  naturalHeight: number,
): Crop {
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const targetRatio =
    naturalWidth > 0 && naturalHeight > 0
      ? (aspect * naturalHeight) / naturalWidth
      : aspect;
  const currentRatio = crop.height > 0 ? crop.width / crop.height : targetRatio;
  let width = crop.width;
  let height = crop.height;
  if (Math.abs(currentRatio - targetRatio) > 0.0001) {
    if (currentRatio > targetRatio) height = width / targetRatio;
    else width = height * targetRatio;
  }
  width = clamp(width, 1, 100);
  height = clamp(height, 1, 100);
  const x = clamp(centerX - width / 2, 0, 100 - width);
  const y = clamp(centerY - height / 2, 0, 100 - height);
  return { x, y, width, height };
}

function moveCrop(crop: Crop, dx: number, dy: number): Crop {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 100 - crop.width),
    y: clamp(crop.y + dy, 0, 100 - crop.height),
  };
}

function resizeCrop(
  crop: Crop,
  handle: Exclude<CropHandle, "move">,
  dx: number,
  dy: number,
  ratio: number,
): Crop {
  const horizontal = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const vertical = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const anchorX =
    horizontal < 0
      ? crop.x + crop.width
      : horizontal > 0
        ? crop.x
        : crop.x + crop.width / 2;
  const anchorY =
    vertical < 0
      ? crop.y + crop.height
      : vertical > 0
        ? crop.y
        : crop.y + crop.height / 2;
  const maxWidthByX =
    horizontal < 0
      ? anchorX
      : horizontal > 0
        ? 100 - anchorX
        : 2 * Math.min(anchorX, 100 - anchorX);
  const maxHeightByY =
    vertical < 0
      ? anchorY
      : vertical > 0
        ? 100 - anchorY
        : 2 * Math.min(anchorY, 100 - anchorY);
  const maxWidth = Math.max(0, Math.min(maxWidthByX, maxHeightByY * ratio));

  let width: number;
  if (horizontal === 0) {
    width = (crop.height + vertical * dy) * ratio;
  } else if (vertical === 0) {
    width = crop.width + horizontal * dx;
  } else {
    const widthChange = horizontal * dx;
    const heightChange = vertical * dy;
    const projectedChange =
      (widthChange + heightChange / ratio) / (1 + 1 / (ratio * ratio));
    width = crop.width + projectedChange;
  }
  width = clamp(width, Math.min(1, maxWidth), maxWidth);
  const height = width / ratio;
  let x = anchorX - width / 2;
  if (horizontal < 0) x = anchorX - width;
  else if (horizontal > 0) x = anchorX;

  let y = anchorY - height / 2;
  if (vertical < 0) y = anchorY - height;
  else if (vertical > 0) y = anchorY;

  return { x, y, width, height };
}

function roundRect(crop: Crop): Slides2ImageCropRect {
  return {
    x: round2(crop.x),
    y: round2(crop.y),
    width: round2(crop.width),
    height: round2(crop.height),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
