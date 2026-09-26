import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowUpRight,
  IconCheck,
  IconCopy,
  IconCrop,
  IconDropletFilled,
  IconMaximize,
  IconMinimize,
  IconSquare,
  IconTypography,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_TEXT_FONT,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  annotationBounds,
  annotationFontSize,
  annotationHandlePoints,
  cropCanvas,
  duplicateAnnotation,
  fromPendingOverlays,
  hitTestAnnotation,
  fitRedaction,
  keepRedactionInside,
  moveAnnotation,
  movableAnnotations,
  newAnnotationId,
  parseCrop,
  redactionsOf,
  renderAnnotated,
  renderRedactedBase,
  resizeAnnotation,
  textFontFamily,
  textFontSize,
  toPendingOverlays,
  type Annotation,
  type AnnotationTool,
  type CropRect,
  type MarkThickness,
  type ResizeHandle,
  type TextAlign,
  type TextAnnotation,
  type TextFontId,
} from "@/lib/screenshot-annotations";
import {
  BACKGROUND_COLORS,
  BACKGROUND_GRADIENTS,
  backgroundCss,
  backgroundPadding,
  composeOnBackground,
  parseBackground,
  type ScreenshotBackground,
} from "@/lib/screenshot-background";
import {
  SCREENSHOT_MIME_TYPE,
  SCREENSHOT_QUALITY,
} from "@/lib/screenshot-capture";
import {
  DEFAULT_REDACTION_STYLE,
  DEFAULT_SOLID_FILL,
  type RedactionStyle,
} from "@/lib/screenshot-redaction";
import {
  isUsableSelection,
  mapPointToSource,
  mapRectToSource,
  rectFromPoints,
  type Point,
  type Rect,
} from "@/lib/screenshot-region";
import { cn } from "@/lib/utils";

import {
  ElementToolbar,
  type ToolbarAnchor,
} from "./screenshot-element-toolbar";

export interface ScreenshotEditorProps {
  recordingId: string;
  /** What the editor draws on: the capture with any blur already burned in. */
  baseImageUrl: string;
  /**
   * The recording's `mediaUpdatedAt` for that picture. Sent with every save
   * so a tab left open across a burn cannot put the old pixels back.
   */
  mediaRevision: string;
  /** Marks saved previously, still movable. */
  initialAnnotations: Annotation[];
  /**
   * Redactions placed but not burned in yet — `editsJson.overlays`, in the
   * video editor's format. Movable until they are burned.
   */
  pendingOverlays?: unknown;
  /** The saved crop, as stored in `editsJson.crop`. */
  initialCrop?: unknown;
  /** The saved background, as stored in `editsJson.background`. */
  initialBackground?: unknown;
  onSaved: () => void;
  onCancel: () => void;
  /** How many redaction boxes are open here, saved or not. */
  onPendingRedactionsChange?: (count: number) => void;
}

interface PendingText {
  /** Top-left of the box, in image pixels. */
  source: Point;
  value: string;
  /** Wrap width in image pixels, when the box was dragged out to a width. */
  width?: number;
  fontSize: number;
  font: TextFontId;
  align: TextAlign;
  color: string;
  /** Set when an existing text mark is being retyped rather than a new one. */
  editingId?: string;
}

/** How far a press must travel before it drags a mark rather than clicks it. */
const MOVE_THRESHOLD_PX = 4;

/** A dragged-out text box narrower than this is taken as a plain click. */
const MIN_TEXT_DRAG_PX = 12;

function clampTextSize(value: number): number {
  return Math.round(Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, value)));
}

/** Whether a key press belongs to a form field rather than the editor. */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * One step of undo: the marks, and the crop and background with them, so
 * undo steps back over a crop or a background as well as a mark.
 */
interface EditorSnapshot {
  annotations: Annotation[];
  crop: CropRect | null;
  background: ScreenshotBackground | null;
}

type Interaction =
  | { mode: "draw"; from: Point; to: Point }
  | {
      mode: "move";
      id: string;
      last: Point;
      /** Where the press began, on screen, to tell a click from a drag. */
      start: Point;
      moved: boolean;
      /** A text under the text tool: a click opens it for typing. */
      editOnClick: boolean;
    }
  | { mode: "resize"; id: string; handle: ResizeHandle };

const TOOLS: Array<{
  tool: AnnotationTool;
  icon: typeof IconSquare;
  labelKey: string;
}> = [
  { tool: "text", icon: IconTypography, labelKey: "screenshot.text" },
  { tool: "box", icon: IconSquare, labelKey: "screenshot.box" },
  { tool: "arrow", icon: IconArrowUpRight, labelKey: "screenshot.arrow" },
  { tool: "redact", icon: IconDropletFilled, labelKey: "screenshot.blur" },
  { tool: "crop", icon: IconCrop, labelKey: "screenshot.crop" },
];

/**
 * Mark up a screenshot: text, box, arrow, redaction and crop — laid out the
 * way Loom does it. The toolbar at the top only picks what to draw. Clicking
 * any mark selects it, whatever tool is out, and a small toolbar beside it
 * changes that mark; right-clicking gives a menu to duplicate it or add a new
 * mark where you clicked. Dragging on empty picture draws with the tool.
 *
 * Boxes, arrows and text are data drawn over the base picture, so they stay
 * movable for as long as the screenshot exists, while everyone else is served
 * a copy with them baked in.
 *
 * Redaction works as it does on a video. A redaction box saves as data and
 * stays movable, but it hides nothing yet — the original is still stored — so
 * until it is burned in the screenshot is held back from everyone who cannot
 * edit it. Burn in destroys the covered pixels, deletes the original, and
 * cannot be undone.
 */
/** Resolves once the browser has painted what is already on screen. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}

/** The URL without its `t` access token, which says nothing about the image. */
export function withoutAccessToken(url: string): string {
  const [path, query = ""] = url.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("t");
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

export function ScreenshotEditor({
  recordingId,
  baseImageUrl,
  mediaRevision,
  initialAnnotations,
  pendingOverlays,
  initialCrop,
  initialBackground,
  onSaved,
  onCancel,
  onPendingRedactionsChange,
}: ScreenshotEditorProps) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  /**
   * The marks as they were when a drag began. A drag updates the marks as it
   * goes, so by the time it ends the current list already has the new
   * position — recording that for undo made undo put back what was there.
   */
  const gestureStartRef = useRef<Annotation[] | null>(null);

  const [tool, setTool] = useState<AnnotationTool>("box");
  /** What a new box or arrow is drawn with: whatever was last chosen. */
  const [thickness, setThickness] = useState<MarkThickness>("thin");
  const [boxFill, setBoxFill] = useState(false);
  const [boxShadow, setBoxShadow] = useState(false);
  /** True while a mark is being dragged, when its toolbar gets out of the way. */
  const [moving, setMoving] = useState(false);
  /** A mark under the pointer, so the cursor can say it can be moved. */
  const [hovering, setHovering] = useState(false);
  /** Where the picture's menu was opened, in image pixels, and on what. */
  const [menuAt, setMenuAt] = useState<{
    point: Point;
    hit: Annotation | null;
  } | null>(null);
  const [color, setColor] = useState(DEFAULT_ANNOTATION_COLOR);
  /** Null until chosen: the default follows the picture's size. */
  const [textSize, setTextSize] = useState<number | null>(null);
  const [textFont, setTextFont] = useState<TextFontId>(DEFAULT_TEXT_FONT);
  const [textAlign, setTextAlign] = useState<TextAlign>("left");
  const [redactionStyle, setRedactionStyle] = useState<RedactionStyle>(
    DEFAULT_REDACTION_STYLE,
  );
  /** Kept apart from the mark colour: a redaction defaults to black, not red. */
  const [solidColor, setSolidColor] = useState<string>(DEFAULT_SOLID_FILL);
  const [annotations, setAnnotations] =
    useState<Annotation[]>(initialAnnotations);
  const [undone, setUndone] = useState<EditorSnapshot[]>([]);
  const [history, setHistory] = useState<EditorSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ from: Point; to: Point } | null>(
    null,
  );
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Fill the window while marking up.
   *
   * Deliberately an in-page overlay rather than the Fullscreen API: the editor
   * has a text input, toasts and a confirm dialog on save, and browsers put
   * those behind — or drop out of — real fullscreen.
   */
  const [expanded, setExpanded] = useState(false);
  /**
   * Bumped whenever the canvas is re-laid-out. The selection box and drag
   * handles are measured from the canvas during render, so without this they
   * would keep the sizes they had before it resized, and sit away from the
   * mark they belong to.
   */
  const [layoutTick, setLayoutTick] = useState(0);
  const [burnOpen, setBurnOpen] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  /** The crop being drawn with the crop tool, before it is applied. */
  const [cropDraft, setCropDraft] = useState<CropRect | null>(null);
  const [background, setBackground] = useState<ScreenshotBackground | null>(
    () => parseBackground(initialBackground),
  );

  // Read through a ref: the parent passes a fresh closure on every render, and
  // as an effect dependency it reloaded the picture each time — and a failed
  // reload mid-edit closed the editor and threw the unsaved marks away.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // The URL carries a password token that is re-minted every few minutes; a
  // new token is not a new picture, and reloading for one risks the same
  // mid-edit failure as above.
  const pictureKey = withoutAccessToken(baseImageUrl);
  const baseImageUrlRef = useRef(baseImageUrl);
  baseImageUrlRef.current = baseImageUrl;

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setReady(true);
    };
    image.onerror = () => {
      if (cancelled) return;
      toast.error(t("screenshot.redactLoadFailed"));
      onCancelRef.current();
    };
    image.src = baseImageUrlRef.current;
    return () => {
      cancelled = true;
    };
    // `t` is left out for the same reason: only a new picture means a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictureKey]);

  const imageSize = useMemo(
    () =>
      imageRef.current
        ? {
            width: imageRef.current.naturalWidth,
            height: imageRef.current.naturalHeight,
          }
        : { width: 0, height: 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready],
  );

  // Pending redactions are stored against the picture's proportions, so they
  // can only be turned back into pixels once the picture has loaded. Once.
  const loadedPendingRef = useRef(false);
  useEffect(() => {
    if (!ready || !imageSize.width || loadedPendingRef.current) return;
    loadedPendingRef.current = true;
    const pending = fromPendingOverlays(pendingOverlays, imageSize);
    if (pending.length) setAnnotations((current) => [...pending, ...current]);
    setCrop(parseCrop(initialCrop, imageSize));
  }, [ready, imageSize, pendingOverlays, initialCrop]);

  /**
   * The part of the picture on screen, in image pixels. Everything is stored
   * against the full picture, so the crop is only a window onto it — and the
   * crop tool shows the whole picture, so the crop can be drawn wider again.
   */
  const view = useMemo<CropRect>(
    () =>
      tool !== "crop" && crop
        ? crop
        : { x: 0, y: 0, width: imageSize.width, height: imageSize.height },
    [tool, crop, imageSize],
  );

  /**
   * What is on screen, in image pixels: the view, plus the background's
   * margin round it when there is one. The margin maps to coordinates outside
   * the picture, which is what keeps every mark in place when a background
   * is added or taken away.
   */
  const shownFrame = useMemo<CropRect>(() => {
    const pad = background && tool !== "crop" ? backgroundPadding(view) : 0;
    return {
      x: view.x - pad,
      y: view.y - pad,
      width: view.width + pad * 2,
      height: view.height + pad * 2,
    };
  }, [background, tool, view]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    // Watching the holder rather than the window catches every way the canvas
    // can change size in one go: the window resizing, the editor expanding,
    // and the column reflowing when the side panel is collapsed — that last
    // one fires no window resize and re-renders nothing on its own.
    const observer = new ResizeObserver(() =>
      setLayoutTick((tick) => tick + 1),
    );
    observer.observe(holder);
    if (stageRef.current) observer.observe(stageRef.current);
    // A mark's toolbar is placed in the window, so it has to follow a scroll.
    const onScroll = () => setLayoutTick((tick) => tick + 1);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  /**
   * Keep the whole picture inside the grey stage.
   *
   * The stage caps its own height, but a percentage max-height on the canvas
   * resolves to nothing, so a picture taller than the cap overflowed it and was
   * cut off top and bottom. Worse, the selection box and handles are placed
   * from the top of the stage, so they landed below the mark by however much
   * had been cut off — most visibly on a region capture, which is squarer than
   * a full page. Inline the cap is the same calc as the stage's; full screen
   * the stage's height is whatever the toolbar leaves, so it is measured.
   */
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    canvas.style.maxHeight = expanded ? `${stage.clientHeight}px` : "";
  }, [expanded]);

  useLayoutEffect(() => {
    fitCanvas();
  }, [fitCanvas, layoutTick]);

  // A mark's toolbar is placed in the window, measured off the canvas during
  // render. When something above the picture appears — the "not yet burned
  // in" notice after the first redaction — the picture moves down without
  // resizing, which no observer reports, and the toolbar was left where the
  // picture used to be: over the new box's resize handle. So check after
  // every render whether the canvas moved, and measure again if it did.
  const canvasSpotRef = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const last = canvasSpotRef.current;
    canvasSpotRef.current = { left: rect.left, top: rect.top };
    if (last && (last.left !== rect.left || last.top !== rect.top)) {
      setLayoutTick((tick) => tick + 1);
    }
  });

  // The redactions are the slow part of drawing the picture — each is a
  // blurred streak over full-resolution pixels — and dragging any other mark
  // leaves them as they were. So the picture with them drawn is kept, and
  // only redrawn when a redaction itself changes.
  const redactionKey = JSON.stringify(
    annotations.filter((annotation) => annotation.kind === "redact"),
  );
  const redactedBaseRef = useRef<{
    key: string;
    canvas: HTMLCanvasElement;
  } | null>(null);

  // A drag changes the marks on every pointer move, which can be several
  // times a frame; draw at most once a frame.
  const drawFrameRef = useRef<number | null>(null);
  useEffect(() => {
    const image = imageRef.current;
    const holder = holderRef.current;
    if (!ready || !image || !holder || !imageSize.width) return;
    if (drawFrameRef.current !== null)
      cancelAnimationFrame(drawFrameRef.current);
    drawFrameRef.current = requestAnimationFrame(() => {
      drawFrameRef.current = null;
      const baseKey = `${imageSize.width}x${imageSize.height}:${redactionKey}`;
      if (redactedBaseRef.current?.key !== baseKey) {
        redactedBaseRef.current = {
          key: baseKey,
          canvas: renderRedactedBase(image, imageSize, annotations),
        };
      }
      const redactedBase = redactedBaseRef.current.canvas;
      // The text being retyped is shown by the text box instead, not twice.
      const editingId = pendingText?.editingId;
      const rendered = renderAnnotated(
        image,
        imageSize,
        editingId
          ? annotations.filter(
              (annotation) =>
                !("id" in annotation) || annotation.id !== editingId,
            )
          : annotations,
        redactedBase,
      );
      const cropped =
        view.width === imageSize.width && view.height === imageSize.height
          ? rendered
          : cropCanvas(rendered, view);
      const shown =
        background && tool !== "crop"
          ? composeOnBackground(cropped, background)
          : cropped;
      shown.className =
        "block max-h-[calc(100vh-20rem)] max-w-full object-contain";
      canvasRef.current?.remove();
      canvasRef.current = shown;
      holder.appendChild(shown);
      fitCanvas();
    });
    return () => {
      if (drawFrameRef.current !== null) {
        cancelAnimationFrame(drawFrameRef.current);
        drawFrameRef.current = null;
      }
    };
  }, [
    ready,
    redactionKey,
    annotations,
    imageSize,
    view,
    background,
    tool,
    fitCanvas,
    pendingText?.editingId,
  ]);

  const bounds = useCallback(
    () => canvasRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  const displayPoint = useCallback(
    (event: { clientX: number; clientY: number }): Point | null => {
      const box = bounds();
      if (!box) return null;
      return {
        x: Math.min(Math.max(event.clientX - box.left, 0), box.width),
        y: Math.min(Math.max(event.clientY - box.top, 0), box.height),
      };
    },
    [bounds],
  );

  const toSource = useCallback(
    (point: Point): Point | null => {
      const box = bounds();
      if (!box || !imageSize.width) return null;
      const rect = mapPointToSource(
        point,
        { width: box.width, height: box.height },
        shownFrame,
      );
      if (!rect) return null;
      // A point on the background margin belongs to the nearest edge of the
      // picture: marks go on the screenshot, not around it.
      return {
        x: Math.min(
          Math.max(rect.x + shownFrame.x, view.x),
          view.x + view.width,
        ),
        y: Math.min(
          Math.max(rect.y + shownFrame.y, view.y),
          view.y + view.height,
        ),
      };
    },
    [bounds, imageSize, shownFrame, view],
  );

  /** Image pixels per display pixel. */
  const scale = useCallback(() => {
    const box = bounds();
    if (!box || !box.width) return 1;
    return shownFrame.width / box.width;
  }, [bounds, shownFrame]);

  const snapshot = (marks: Annotation[] = annotations): EditorSnapshot => ({
    annotations: marks,
    crop,
    background,
  });

  /** Record the current state for undo, before changing it. */
  const remember = (marks?: Annotation[]) => {
    setHistory((past) => [...past, snapshot(marks)]);
    setUndone([]);
  };

  /** Redactions snapped to what will be stored; see `fitRedaction`. */
  const fitted = (marks: Annotation[]): Annotation[] =>
    marks.map((mark) =>
      mark.kind === "redact" ? fitRedaction(mark, imageSize) : mark,
    );

  const commit = (next: Annotation[]) => {
    remember();
    setAnnotations(fitted(next));
  };

  const changeCrop = (next: CropRect | null) => {
    if (JSON.stringify(next) === JSON.stringify(crop)) return;
    remember();
    setCrop(next);
  };

  const changeBackground = (next: ScreenshotBackground | null) => {
    if (JSON.stringify(next) === JSON.stringify(background)) return;
    remember();
    setBackground(next);
  };

  const restore = (state: EditorSnapshot) => {
    setAnnotations(state.annotations);
    setCrop(state.crop);
    setBackground(state.background);
    setSelectedId(null);
  };

  const selected = annotations.find(
    (annotation) => "id" in annotation && annotation.id === selectedId,
  );

  const defaultTextSize = imageSize.width ? annotationFontSize(imageSize) : 24;
  /** What the size box shows: the selected text's, or the next one's. */
  const shownTextSize =
    selected?.kind === "text"
      ? Math.round(textFontSize(selected, imageSize))
      : (textSize ?? defaultTextSize);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || saving || pendingText) return;
    const point = displayPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    // Any mark can be picked up and dragged with any tool, as in Loom. A
    // text under the text tool is the one difference: dragged it moves, but
    // a plain click opens it for typing — the pointer-up tells them apart.
    if (tool !== "crop") {
      const source = toSource(point);
      if (!source) return;
      const hit = hitTestAnnotation(
        annotations,
        source,
        imageSize,
        8 * scale(),
      );
      if (hit && "id" in hit) {
        setSelectedId(hit.id);
        gestureStartRef.current = annotations;
        interactionRef.current = {
          mode: "move",
          id: hit.id,
          last: source,
          start: point,
          moved: false,
          editOnClick: tool === "text" && hit.kind === "text",
        };
        return;
      }
      if (!hit) setSelectedId(null);
    }

    interactionRef.current = { mode: "draw", from: point, to: point };
    setDrawing({ from: point, to: point });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    const point = displayPoint(event);
    if (!point) return;
    if (!interaction) {
      if (tool === "crop" || pendingText) return;
      const source = toSource(point);
      const over = Boolean(
        source &&
        hitTestAnnotation(annotations, source, imageSize, 8 * scale()),
      );
      if (over !== hovering) setHovering(over);
      return;
    }

    if (interaction.mode === "draw") {
      interactionRef.current = { ...interaction, to: point };
      setDrawing({ from: interaction.from, to: point });
      return;
    }

    const source = toSource(point);
    if (!source) return;

    if (interaction.mode === "move") {
      // A few pixels of wobble during a click is not a drag.
      if (
        !interaction.moved &&
        Math.hypot(
          point.x - interaction.start.x,
          point.y - interaction.start.y,
        ) < MOVE_THRESHOLD_PX
      ) {
        return;
      }
      if (!interaction.moved) setMoving(true);
      const dx = source.x - interaction.last.x;
      const dy = source.y - interaction.last.y;
      interactionRef.current = { ...interaction, last: source, moved: true };
      setAnnotations((current) =>
        current.map((annotation) =>
          "id" in annotation && annotation.id === interaction.id
            ? annotation.kind === "redact"
              ? keepRedactionInside(
                  moveAnnotation(annotation, dx, dy) as typeof annotation,
                  imageSize,
                )
              : moveAnnotation(annotation, dx, dy)
            : annotation,
        ),
      );
      return;
    }

    setAnnotations((current) =>
      current.map((annotation) =>
        "id" in annotation && annotation.id === interaction.id
          ? resizeAnnotation(annotation, interaction.handle, source, imageSize)
          : annotation,
      ),
    );
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    setMoving(false);

    if (!interaction) return;

    if (interaction.mode === "move" && !interaction.moved) {
      // Only a click: the mark is selected, and nothing moved to undo.
      if (interaction.editOnClick) {
        const hit = annotations.find(
          (annotation) =>
            "id" in annotation && annotation.id === interaction.id,
        );
        if (hit?.kind === "text") startEditingText(hit);
      }
      return;
    }

    if (interaction.mode !== "draw") {
      // A move or resize already updated the marks; record where they were
      // before it, so undo steps back over the whole gesture at once.
      const before = gestureStartRef.current ?? annotations;
      gestureStartRef.current = null;
      remember(before);
      // A redaction shrunk past the minimum is grown back to it here, once the
      // drag is over, rather than fighting the pointer while it is held.
      setAnnotations((current) => fitted(current));
      return;
    }

    setDrawing(null);
    const box = bounds();
    if (!box) return;
    const size = { width: box.width, height: box.height };

    if (tool === "text") {
      if (saving || pendingText) return;
      // A click starts a box that grows with its longest line; dragging sets
      // the width the text wraps to.
      const drawn = rectFromPoints(interaction.from, interaction.to);
      const dragged = drawn.width >= MIN_TEXT_DRAG_PX;
      const source = toSource(dragged ? drawn : interaction.from);
      if (!source) return;
      // Clicking on a text that is already there opens it for typing, rather
      // than starting a second text on top of it.
      if (!dragged) {
        const hit = hitTestAnnotation(
          annotations.filter((annotation) => annotation.kind === "text"),
          source,
          imageSize,
          8 * scale(),
        );
        if (hit?.kind === "text") {
          startEditingText(hit);
          return;
        }
      }
      setPendingText({
        source,
        value: "",
        width: dragged ? Math.round(drawn.width * scale()) : undefined,
        fontSize: textSize ?? defaultTextSize,
        font: textFont,
        align: textAlign,
        color,
      });
      return;
    }

    if (tool === "arrow") {
      const from = toSource(interaction.from);
      const to = toSource(interaction.to);
      if (!from || !to) return;
      if (Math.hypot(to.x - from.x, to.y - from.y) < 12) return;
      const arrowId = newAnnotationId();
      // What was just drawn is selected, so its toolbar is right there.
      setSelectedId(arrowId);
      commit([
        ...annotations,
        {
          kind: "arrow",
          id: arrowId,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          color,
          thickness,
        },
      ]);
      return;
    }

    const drawn: Rect = rectFromPoints(interaction.from, interaction.to);
    if (!isUsableSelection(drawn)) return;
    const shown = mapRectToSource(drawn, size, shownFrame);
    if (!shown) return;
    // Cut to the picture, for a drag that started or ended on the margin.
    const left = Math.max(shown.x + shownFrame.x, view.x);
    const top = Math.max(shown.y + shownFrame.y, view.y);
    const right = Math.min(
      shown.x + shownFrame.x + shown.width,
      view.x + view.width,
    );
    const bottom = Math.min(
      shown.y + shownFrame.y + shown.height,
      view.y + view.height,
    );
    if (right - left < 1 || bottom - top < 1) return;
    const rect = { x: left, y: top, width: right - left, height: bottom - top };

    if (tool === "crop") {
      setCropDraft(rect);
      return;
    }

    const newId = newAnnotationId();
    setSelectedId(newId);
    if (tool === "redact") {
      commit([
        ...annotations,
        {
          kind: "redact",
          id: newId,
          ...rect,
          style: redactionStyle,
          ...(redactionStyle === "solid" ? { color: solidColor } : {}),
        },
      ]);
      return;
    }
    commit([
      ...annotations,
      {
        kind: "box",
        id: newId,
        ...rect,
        color,
        thickness,
        fill: boxFill,
        shadow: boxShadow,
      },
    ]);
  };

  const startResize = (handle: ResizeHandle) => (event: React.PointerEvent) => {
    if (!selectedId) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureStartRef.current = annotations;
    interactionRef.current = { mode: "resize", id: selectedId, handle };
  };

  const commitText = () => {
    if (!pendingText) return;
    // Keep inner blank lines — they may be deliberate spacing.
    const value = pendingText.value.replace(/^\s*\n|\s+$/g, "");
    const { editingId } = pendingText;
    if (editingId) {
      // Clearing a text removes it, as deleting every letter would suggest.
      commit(
        value
          ? annotations.map((annotation) =>
              "id" in annotation && annotation.id === editingId
                ? { ...(annotation as TextAnnotation), text: value }
                : annotation,
            )
          : annotations.filter(
              (annotation) =>
                !("id" in annotation) || annotation.id !== editingId,
            ),
      );
      if (!value) setSelectedId(null);
    } else if (value) {
      const id = newAnnotationId();
      setSelectedId(id);
      commit([
        ...annotations,
        {
          kind: "text",
          id,
          x: pendingText.source.x,
          y: pendingText.source.y,
          text: value,
          color: pendingText.color,
          fontSize: pendingText.fontSize,
          font: pendingText.font,
          align: pendingText.align,
          ...(pendingText.width ? { width: pendingText.width } : {}),
        },
      ]);
    }
    setPendingText(null);
  };

  /** Double-click a text mark to retype it. */
  const handleDoubleClick = (event: React.MouseEvent) => {
    if (tool === "crop" || saving || pendingText) return;
    const point = displayPoint(event);
    const source = point ? toSource(point) : null;
    if (!source) return;
    const hit = hitTestAnnotation(annotations, source, imageSize, 8 * scale());
    if (hit?.kind !== "text") return;
    interactionRef.current = null;
    startEditingText(hit);
  };

  function startEditingText(hit: TextAnnotation) {
    setSelectedId(hit.id);
    setPendingText({
      source: { x: hit.x, y: hit.y },
      value: hit.text,
      width: hit.width,
      fontSize: textFontSize(hit, imageSize),
      font: hit.font ?? DEFAULT_TEXT_FONT,
      align: hit.align ?? "left",
      color: hit.color,
      editingId: hit.id,
    });
  }

  const changeTextSize = (next: number) => {
    if (!Number.isFinite(next)) return;
    const value = clampTextSize(next);
    setTextSize(value);
    if (selected?.kind === "text") {
      applyToSelected({ fontSize: value } as Partial<Annotation>);
    }
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit(
      annotations.filter(
        (annotation) => !("id" in annotation) || annotation.id !== selectedId,
      ),
    );
    setSelectedId(null);
  }, [annotations, commit, selectedId]);

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setUndone([...undone, snapshot()]);
    restore(previous);
  };

  const redo = () => {
    const next = undone[undone.length - 1];
    if (!next) return;
    setUndone(undone.slice(0, -1));
    setHistory([...history, snapshot()]);
    restore(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Backspace in the size box or the text box edits that field; it must
      // not delete the selected mark.
      if (pendingText || isTypingTarget(event.target)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedId) return;
        event.preventDefault();
        removeSelected();
      }
      if (event.key === "Escape") {
        // Escape in an open panel or menu closes that, and nothing more.
        if (document.querySelector("[data-radix-popper-content-wrapper]"))
          return;
        if (selectedId) setSelectedId(null);
        else setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingText, removeSelected, selectedId]);

  const applyToSelected = (change: Partial<Annotation>) => {
    if (!selectedId) return;
    commit(
      annotations.map((annotation) =>
        "id" in annotation && annotation.id === selectedId
          ? ({ ...annotation, ...change } as Annotation)
          : annotation,
      ),
    );
  };

  /**
   * Change the selected mark from its toolbar. Whatever is chosen also
   * becomes what the next mark of that kind is drawn with, so a run of red
   * thick arrows needs choosing once.
   */
  const changeSelected = (change: Partial<Annotation>) => {
    if (!selected) return;
    const c = change as Record<string, unknown>;
    if (selected.kind === "redact") {
      if (c.style) setRedactionStyle(c.style as RedactionStyle);
      if (typeof c.color === "string") setSolidColor(c.color);
    } else if (typeof c.color === "string") {
      setColor(c.color);
    }
    if (c.thickness) setThickness(c.thickness as MarkThickness);
    if (typeof c.fill === "boolean") setBoxFill(c.fill);
    if (typeof c.shadow === "boolean") setBoxShadow(c.shadow);
    if (c.font) setTextFont(c.font as TextFontId);
    if (c.align) setTextAlign(c.align as TextAlign);
    applyToSelected(change);
  };

  const duplicate = (mark: Annotation) => {
    const copy = duplicateAnnotation(mark, imageSize);
    commit([...annotations, copy]);
    if ("id" in copy) setSelectedId(copy.id);
  };

  /** Add a mark of a kind at a point, sized to suit the part on show. */
  const addAt = (kind: "text" | "box" | "arrow" | "redact", point: Point) => {
    if (kind === "text") {
      setPendingText({
        source: point,
        value: "",
        fontSize: textSize ?? defaultTextSize,
        font: textFont,
        align: textAlign,
        color,
      });
      return;
    }
    const clampX = (x: number) =>
      Math.min(Math.max(x, view.x), view.x + view.width);
    const clampY = (y: number) =>
      Math.min(Math.max(y, view.y), view.y + view.height);
    const id = newAnnotationId();
    if (kind === "arrow") {
      // The tip at the point clicked, the tail below and to the left of it.
      const mark: Annotation = {
        kind: "arrow",
        id,
        fromX: Math.round(clampX(point.x - view.width * 0.12)),
        fromY: Math.round(clampY(point.y + view.height * 0.12)),
        toX: Math.round(point.x),
        toY: Math.round(point.y),
        color,
        thickness,
      };
      commit([...annotations, mark]);
      setSelectedId(id);
      return;
    }
    const width = Math.round(view.width * 0.2);
    const height = Math.round(view.height * 0.15);
    const x = Math.round(
      Math.min(
        Math.max(point.x - width / 2, view.x),
        view.x + view.width - width,
      ),
    );
    const y = Math.round(
      Math.min(
        Math.max(point.y - height / 2, view.y),
        view.y + view.height - height,
      ),
    );
    const mark: Annotation =
      kind === "box"
        ? {
            kind: "box",
            id,
            x,
            y,
            width,
            height,
            color,
            thickness,
            fill: boxFill,
            shadow: boxShadow,
          }
        : {
            kind: "redact",
            id,
            x,
            y,
            width,
            height,
            style: redactionStyle,
            ...(redactionStyle === "solid" ? { color: solidColor } : {}),
          };
    commit([...annotations, mark]);
    setSelectedId(id);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    const point = displayPoint(event);
    const source = point ? toSource(point) : null;
    if (!source || tool === "crop" || pendingText) {
      setMenuAt(null);
      return;
    }
    const hit = hitTestAnnotation(annotations, source, imageSize, 8 * scale());
    if (hit && "id" in hit) setSelectedId(hit.id);
    setMenuAt({ point: source, hit });
  };

  const pendingRedactionCount = annotations.filter(
    (annotation) => annotation.kind === "redact",
  ).length;

  // The page's share controls refuse while this is above zero, so a box
  // drawn here holds sharing back before it has even been saved.
  useEffect(() => {
    onPendingRedactionsChange?.(pendingRedactionCount);
  }, [onPendingRedactionsChange, pendingRedactionCount]);
  useEffect(
    () => () => onPendingRedactionsChange?.(0),
    [onPendingRedactionsChange],
  );

  /**
   * Store the edits. With `burn`, the redactions are destroyed in the base
   * too and the original is deleted; without it nothing is destroyed and any
   * redactions stay movable, with the screenshot held from viewers meanwhile.
   */
  const save = async (burn = false) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || saving) return;
    if (!burn && !window.confirm(t("screenshot.editConfirm"))) return;

    setSaving(true);
    const savingToastId = toast.loading(
      t(burn ? "screenshot.burning" : "screenshot.redactSaving"),
    );
    try {
      // Everything below runs on the main thread and takes well over the
      // 400 ms budget on a large picture, so let the "saving" toast and the
      // disabled buttons paint first.
      await nextPaint();

      // The picture with the redactions destroyed and no marks. A burn makes
      // it the base the next session starts from.
      const redactedBase = renderRedactedBase(image, imageSize, annotations);
      const baseDataUrl = burn
        ? redactedBase.toDataURL(SCREENSHOT_MIME_TYPE, SCREENSHOT_QUALITY)
        : undefined;

      // What viewers get: every mark and redaction, cut down to the crop.
      // Pending redactions are drawn in too, so the owner's own view already
      // looks the way it will once burned.
      const everything = renderAnnotated(
        image,
        imageSize,
        annotations,
        redactedBase,
      );
      const cropped = crop ? cropCanvas(everything, crop) : everything;
      const served = background
        ? composeOnBackground(cropped, background)
        : cropped;

      await callAction(
        "save-screenshot-edits" as any,
        {
          recordingId,
          mediaRevision,
          dataUrl: served.toDataURL(SCREENSHOT_MIME_TYPE, SCREENSHOT_QUALITY),
          crop,
          background,
          ...(baseDataUrl ? { baseDataUrl } : {}),
          annotations: movableAnnotations(annotations),
          redactions: burn ? redactionsOf(annotations, imageSize) : [],
          pendingRedactions: burn
            ? []
            : toPendingOverlays(annotations, imageSize),
          width: served.width,
          height: served.height,
        } as any,
      );
      toast.success(t(burn ? "screenshot.burned" : "screenshot.editSaved"), {
        id: savingToastId,
      });
      onSaved();
    } catch (err) {
      toast.dismiss(savingToastId);
      toast.error(
        err instanceof Error
          ? err.message
          : t(burn ? "screenshot.burnFailed" : "screenshot.redactFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const previewRect =
    drawing && tool !== "arrow"
      ? rectFromPoints(drawing.from, drawing.to)
      : null;

  // Selection handles live in display coordinates, so they follow the image
  // however it is scaled to fit.
  const selectionBox = (() => {
    void layoutTick;
    // While a text is being retyped its box is the text box itself.
    if (!selected || !imageSize.width || pendingText) return null;
    const box = bounds();
    if (!box) return null;
    const factor = box.width / shownFrame.width;
    const rect = annotationBounds(selected, imageSize);
    return {
      left: (rect.x - shownFrame.x) * factor,
      top: (rect.y - shownFrame.y) * factor,
      width: Math.max(rect.width * factor, 6),
      height: Math.max(rect.height * factor, 6),
    };
  })();

  /** Where the selected mark is in the window, for its own toolbar. */
  const toolbarAnchor: ToolbarAnchor | null = (() => {
    if (!selectionBox || moving || drawing || tool === "crop") return null;
    const box = bounds();
    if (!box) return null;
    return {
      left: box.left + selectionBox.left,
      top: box.top + selectionBox.top,
      width: selectionBox.width,
      height: selectionBox.height,
    };
  })();

  /** Where the crop sits on screen while the crop tool is out. */
  const cropFrame = (() => {
    void layoutTick;
    const frame = tool === "crop" && !drawing ? (cropDraft ?? crop) : null;
    if (!frame || !shownFrame.width) return null;
    const box = bounds();
    if (!box) return null;
    const factor = box.width / shownFrame.width;
    return {
      left: (frame.x - shownFrame.x) * factor,
      top: (frame.y - shownFrame.y) * factor,
      width: frame.width * factor,
      height: frame.height * factor,
    };
  })();

  // An arrow is dragged by its own two ends, not by the corners of the box
  // around it — see annotationHandlePoints.
  const handlePositions = (() => {
    void layoutTick;
    // While a text is being retyped its box is the text box itself.
    if (!selected || !imageSize.width || pendingText) return null;
    const box = bounds();
    if (!box) return null;
    const points = annotationHandlePoints(selected, imageSize);
    if (!points) return null;
    const factor = box.width / shownFrame.width;
    const at = (point: Point) => ({
      left: (point.x - shownFrame.x) * factor,
      top: (point.y - shownFrame.y) * factor,
    });
    return { start: at(points.start), end: at(points.end) };
  })();

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-3",
        expanded && "fixed inset-0 z-50 h-full bg-background p-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* What to draw — and nothing else. A mark's own settings live on
            the toolbar beside it once it is selected. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-xl bg-muted p-1">
            {TOOLS.map(({ tool: value, icon: Icon, labelKey }) => (
              <button
                key={value}
                type="button"
                aria-label={t(labelKey)}
                aria-pressed={tool === value}
                title={t(labelKey)}
                disabled={saving}
                onClick={() => {
                  setTool(value);
                  if (value === "crop") setSelectedId(null);
                  else setCropDraft(null);
                }}
                className={cn(
                  "flex h-8 w-10 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
                  tool === value
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
              </button>
            ))}
            <BackgroundPicker
              value={background}
              disabled={saving}
              t={t}
              onChange={changeBackground}
            />
          </div>

          {tool === "crop" ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={saving || !cropDraft}
                title={t("screenshot.cropApplyHint")}
                onClick={() => {
                  changeCrop(parseCrop(cropDraft, imageSize));
                  setCropDraft(null);
                  setTool("box");
                }}
              >
                <IconCheck className="size-4" />
                {t("screenshot.cropApply")}
              </Button>
              {crop || cropDraft ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    changeCrop(null);
                    setCropDraft(null);
                  }}
                >
                  {t("screenshot.cropReset")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("screenshot.undo")}
            title={t("screenshot.undo")}
            disabled={history.length === 0 || saving}
            onClick={undo}
          >
            <IconArrowBackUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("screenshot.redo")}
            title={t("screenshot.redo")}
            disabled={undone.length === 0 || saving}
            onClick={redo}
          >
            <IconArrowForwardUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t(
              expanded ? "screenshot.exitFullscreen" : "screenshot.fullscreen",
            )}
            title={t(
              expanded ? "screenshot.exitFullscreen" : "screenshot.fullscreen",
            )}
            disabled={saving}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? (
              <IconMinimize className="size-4" />
            ) : (
              <IconMaximize className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant={pendingRedactionCount > 0 ? "outline" : "default"}
            disabled={saving}
            onClick={() => void save()}
          >
            {t("screenshot.editSave")}
          </Button>
          {pendingRedactionCount > 0 ? (
            <Button
              size="sm"
              disabled={saving}
              title={t("screenshot.burnInHint")}
              onClick={() => setBurnOpen(true)}
            >
              {t("editorToolbar.burnIn", { count: pendingRedactionCount })}
            </Button>
          ) : null}
        </div>
      </div>

      {pendingRedactionCount > 0 ? (
        // Always on show, not tucked into help: it is the fact that nothing
        // is hidden yet, and that nobody else can see the screenshot.
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
          {t("screenshot.notYetBurned", { count: pendingRedactionCount })}
        </p>
      ) : null}

      <AlertDialog open={burnOpen} onOpenChange={setBurnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("screenshot.burnInTitle", { count: pendingRedactionCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("screenshot.burnInWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBurnOpen(false);
                void save(true);
              }}
            >
              {t("editorToolbar.burnInConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setMenuAt(null);
        }}
      >
        <ContextMenuTrigger asChild disabled={saving}>
          <div
            ref={stageRef}
            onContextMenu={handleContextMenu}
            className={cn(
              "flex items-center justify-center overflow-hidden rounded-lg bg-muted",
              expanded
                ? "min-h-0 flex-1 max-h-[calc(100vh-7rem)]"
                : "max-h-[calc(100vh-20rem)]",
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          >
            <div
              className={cn(
                "relative flex max-h-full max-w-full items-center justify-center",
                hovering && tool !== "crop"
                  ? moving
                    ? "cursor-grabbing"
                    : "cursor-move"
                  : "cursor-crosshair",
              )}
            >
              {/* Canvas only — React never renders children in here. */}
              <div ref={holderRef} className="flex max-h-full max-w-full" />

              {previewRect ? (
                <div
                  className="pointer-events-none absolute border-2"
                  style={{
                    left: previewRect.x,
                    top: previewRect.y,
                    width: previewRect.width,
                    height: previewRect.height,
                    borderColor:
                      tool === "redact"
                        ? "hsl(var(--muted-foreground))"
                        : color,
                    backgroundColor:
                      tool === "redact"
                        ? redactionStyle === "solid"
                          ? solidColor
                          : "hsl(var(--muted-foreground) / 0.25)"
                        : "transparent",
                    opacity:
                      tool === "redact" && redactionStyle === "solid"
                        ? 0.85
                        : 1,
                  }}
                />
              ) : null}

              {cropFrame ? (
                // Everything outside the crop is dimmed rather than hidden, so
                // there is something to aim for when drawing it wider.
                <div
                  // guard:allow-raw-color — drawn over the picture, not the page: a white edge on a dimmed image reads in either theme
                  className="pointer-events-none absolute border-2 border-dashed border-white"
                  style={{
                    ...cropFrame,
                    // guard:allow-raw-color — dims the picture outside the crop, whatever the theme
                    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
                  }}
                />
              ) : null}

              {drawing && tool === "arrow" ? (
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  <line
                    x1={drawing.from.x}
                    y1={drawing.from.y}
                    x2={drawing.to.x}
                    y2={drawing.to.y}
                    stroke={color}
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                </svg>
              ) : null}

              {selectionBox ? (
                <div
                  className="pointer-events-none absolute rounded-[2px] border border-dashed border-primary"
                  style={selectionBox}
                />
              ) : null}

              {handlePositions
                ? (["start", "end"] as const).map((handle) => (
                    <span
                      key={handle}
                      role="button"
                      aria-label={t(
                        selected?.kind === "text"
                          ? "screenshot.textWidthHandle"
                          : "screenshot.resizeHandle",
                      )}
                      title={t(
                        selected?.kind === "text"
                          ? "screenshot.textWidthHandle"
                          : "screenshot.resizeHandle",
                      )}
                      onPointerDown={startResize(handle)}
                      className={cn(
                        "absolute z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-primary shadow-sm",
                        selected?.kind === "arrow"
                          ? "cursor-move"
                          : selected?.kind === "text"
                            ? "cursor-ew-resize"
                            : "cursor-nwse-resize",
                      )}
                      style={handlePositions[handle]}
                    />
                  ))
                : null}

              {pendingText ? (
                <TextBox
                  pending={pendingText}
                  factor={(() => {
                    void layoutTick;
                    const box = bounds();
                    return box && shownFrame.width
                      ? box.width / shownFrame.width
                      : 1;
                  })()}
                  offset={shownFrame}
                  placeholder={t("screenshot.textPlaceholder")}
                  onChange={(value) =>
                    setPendingText({ ...pendingText, value })
                  }
                  onDone={commitText}
                />
              ) : null}

              {selected && toolbarAnchor && !pendingText ? (
                <ElementToolbar
                  selected={selected}
                  anchor={toolbarAnchor}
                  disabled={saving}
                  t={t}
                  onChange={changeSelected}
                  onDuplicate={() => duplicate(selected)}
                  onDelete={removeSelected}
                  textSize={shownTextSize}
                  onTextSize={changeTextSize}
                />
              ) : null}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-48"
          // Closing hands focus back to the picture by default, which would pull
          // it straight out of a text box the menu has just opened.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {menuAt?.hit ? (
            <>
              <ContextMenuItem
                onSelect={() => menuAt.hit && duplicate(menuAt.hit)}
              >
                <IconCopy className="size-4" />
                {t("screenshot.duplicate", {
                  kind: t(`screenshot.kind.${menuAt.hit.kind}`),
                })}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : null}
          {(
            [
              ["text", IconTypography, "screenshot.addText"],
              ["arrow", IconArrowUpRight, "screenshot.addArrow"],
              ["box", IconSquare, "screenshot.addBox"],
              ["redact", IconDropletFilled, "screenshot.addRedaction"],
            ] as const
          ).map(([kind, Icon, labelKey]) => (
            <ContextMenuItem
              key={kind}
              disabled={!menuAt}
              onSelect={() => menuAt && addAt(kind, menuAt.point)}
            >
              <Icon className="size-4" />
              {t(labelKey)}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/**
 * Where a text mark is typed: over the picture, in the mark's own font, size
 * and colour at the size it is shown, so what is typed is what gets saved.
 * Return starts a new line; clicking away or pressing Escape finishes.
 */
function TextBox({
  pending,
  factor,
  offset,
  placeholder,
  onChange,
  onDone,
}: {
  pending: PendingText;
  /** Display pixels per image pixel. */
  factor: number;
  /** Top-left of the shown part of the picture, in image pixels. */
  offset: Point;
  placeholder: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fontSize = pending.fontSize * factor;
  const fixedWidth = pending.width ? pending.width * factor : null;

  // `autoFocus` alone loses to a menu that is still closing when the box
  // appears — "Add new text" from the right-click menu — so ask again once
  // the menu is gone.
  useEffect(() => {
    const timer = window.setTimeout(() => ref.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, []);

  // Grow with the text. A box with a set width wraps and only grows down; one
  // without grows sideways with its longest line.
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${area.scrollHeight}px`;
    if (fixedWidth === null) {
      area.style.width = "0px";
      // Empty, it needs room for the prompt; once typed in, it is exactly as
      // wide as the longest line, which is the box a centred or right-aligned
      // text is laid out in once saved.
      area.style.width = pending.value
        ? `${area.scrollWidth + 2}px`
        : `${fontSize * 6}px`;
    }
  }, [pending.value, fontSize, fixedWidth]);

  return (
    <textarea
      ref={ref}
      autoFocus
      rows={1}
      wrap={fixedWidth === null ? "off" : "soft"}
      value={pending.value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onDone}
      onFocus={(event) => {
        // Retyping an existing mark starts at the end, not with it all selected.
        const end = event.currentTarget.value.length;
        event.currentTarget.setSelectionRange(end, end);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
      className="absolute z-10 resize-none overflow-hidden rounded-[2px] border border-dashed border-primary bg-background/40 p-0 outline-none placeholder:text-muted-foreground"
      style={{
        // The 1px dashed border sits outside the text, so the letters line up
        // with where the saved text is drawn.
        left: (pending.source.x - offset.x) * factor - 1,
        top: (pending.source.y - offset.y) * factor - 1,
        width: fixedWidth === null ? undefined : fixedWidth + 2,
        fontFamily: textFontFamily(pending.font),
        fontSize,
        fontWeight: 600,
        lineHeight: TEXT_LINE_HEIGHT,
        color: pending.color,
        textAlign: pending.align,
        whiteSpace: fixedWidth === null ? "pre" : "pre-wrap",
        overflowWrap: "anywhere",
      }}
    />
  );
}

/**
 * Loom's "Add a background": the last button in the tool bar, showing the
 * background in use, opening a panel of gradients and flat colours.
 */
function BackgroundPicker({
  value,
  disabled,
  t,
  onChange,
}: {
  value: ScreenshotBackground | null;
  disabled: boolean;
  t: (key: string) => string;
  onChange: (value: ScreenshotBackground | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const same = (other: ScreenshotBackground | null) =>
    JSON.stringify(other) === JSON.stringify(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("screenshot.background")}
          title={t("screenshot.background")}
          disabled={disabled}
          className={cn(
            "flex h-8 w-10 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
            open ? "bg-background shadow-sm" : "hover:bg-background/60",
          )}
        >
          <span
            className="size-5 rounded-md border border-border"
            style={{
              background: value
                ? backgroundCss(value)
                : backgroundCss({
                    kind: "gradient",
                    id: BACKGROUND_GRADIENTS[0].id,
                  }),
              opacity: value ? 1 : 0.55,
            }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[22rem] p-4">
        <p className="mb-3 text-base font-semibold">
          {t("screenshot.backgroundTitle")}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
            className={cn(
              "flex h-16 items-center justify-center rounded-lg bg-foreground text-sm font-semibold text-background",
              value === null &&
                "ring-2 ring-primary ring-offset-2 ring-offset-popover",
            )}
          >
            {t("screenshot.backgroundNone")}
          </button>
          {BACKGROUND_GRADIENTS.map((gradient) => {
            const option: ScreenshotBackground = {
              kind: "gradient",
              id: gradient.id,
            };
            return (
              <button
                key={gradient.id}
                type="button"
                aria-label={gradient.id}
                aria-pressed={same(option)}
                onClick={() => onChange(option)}
                className={cn(
                  "h-16 rounded-lg",
                  same(option) &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                )}
                style={{ background: backgroundCss(option) }}
              />
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {BACKGROUND_COLORS.map((color) => {
            const option: ScreenshotBackground = { kind: "solid", color };
            return (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={same(option)}
                onClick={() => onChange(option)}
                className={cn(
                  "size-7 rounded-full border border-border",
                  same(option) &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                )}
                style={{ backgroundColor: color }}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
