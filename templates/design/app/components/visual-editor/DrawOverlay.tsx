import { useT } from "@agent-native/core/client";
import {
  IconEraser,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconSend,
  IconCursorText,
  IconX,
} from "@tabler/icons-react";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface DrawAnnotation {
  id: string;
  type: "path" | "text";
  /** SVG path data for "path" type */
  pathData?: string;
  /** Text content for "text" type */
  text?: string;
  /** Annotation color (hex) */
  color: string;
  /** Stroke width for paths, font weight reference for text */
  lineWidth: number;
  /** Position relative to the canvas (text annotations only) */
  position: { x: number; y: number };
  /**
   * Creation timestamp (Date.now()) — used for unified undo ordering across
   * strokes and text annotations. Optional so existing callers of DrawAnnotation
   * don't need to supply it.
   */
  createdAt?: number;
}

interface DrawOverlayProps {
  /** Whether the overlay is currently visible (toggled from the toolbar) */
  visible: boolean;
  /** When false, canvas clicks pass through to sibling tools while the toolbar stays usable. */
  canvasInteractive?: boolean;
  /** Extra queued annotations owned by sibling tools, such as comment pins. */
  queuedAnnotationCount?: number;
  /**
   * Current zoom level (percentage, e.g. 100 = 100%). Used to convert
   * getBoundingClientRect() visual-space coordinates to layout-space so that
   * strokes and text labels stay anchored to their painted position across
   * zoom changes.
   */
  zoom?: number;
  /** Called when the user submits the queued strokes/text to the agent */
  onSend: (
    annotations: DrawAnnotation[],
    instruction: string,
    canvasSize: { width: number; height: number },
  ) => void;
  /** Called when the user cancels / closes the draw mode */
  onClose: () => void;
}

const PRESET_COLORS = [
  { color: "#ef4444", label: "Red" },
  { color: "#3b82f6", label: "Blue" },
  { color: "#22c55e", label: "Green" },
  { color: "#eab308", label: "Yellow" },
];

const LINE_WIDTHS = [
  { value: 2, label: "Thin" },
  { value: 4, label: "Medium" },
  { value: 8, label: "Thick" },
];

/**
 * A point stored as fractions (0..1) of the canvas visual rect.
 * This makes coordinates zoom- and resize-stable: multiply by the current
 * rect width/height to get visual pixels for canvas drawing, or multiply by
 * rect/scale to get layout-space for CSS positioning and pathData output.
 */
interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  /** Points stored as fractions (0..1) of the canvas visual rect. */
  points: Point[];
  color: string;
  lineWidth: number;
  /** Creation timestamp for unified undo ordering. */
  createdAt: number;
}

/**
 * Draw-to-prompt overlay for the slide canvas.
 *
 * Mirrors claude.ai/design's "Draw mode": the user sketches on the canvas,
 * adds a one-line text instruction, hits Send, and the strokes + instruction
 * are forwarded to the agent. The agent receives the path geometry along with
 * the canvas size so it can interpret position semantically (e.g. "move the
 * title here").
 *
 * This component is canvas-agnostic — it overlays absolutely-positioned over
 * its parent, so the parent (a slide editor or design canvas) only needs to
 * be `position: relative`.
 *
 * Coordinate model
 * ----------------
 * All stroke points and text positions are stored as fractions (0..1) of the
 * canvas's visual rect (getBoundingClientRect). This makes them stable across
 * zoom and resize. When rendering:
 *   - Canvas strokes: multiply by rect.width / rect.height (visual pixels).
 *   - CSS text labels: multiply by rect.width/scale / rect.height/scale
 *     (layout pixels inside the scaled wrapper).
 *   - pathData in send(): layout pixels = fraction * rect.width / scale.
 */
export function DrawOverlay({
  visible,
  canvasInteractive = true,
  queuedAnnotationCount = 0,
  zoom = 100,
  onSend,
  onClose,
}: DrawOverlayProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(PRESET_COLORS[0].color);
  const [lineWidth, setLineWidth] = useState(LINE_WIDTHS[1].value);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<DrawAnnotation[]>([]);
  // Unified redo stack. Each entry is either a Stroke or a DrawAnnotation so
  // undo/redo work in creation order across both types.
  const [redoStack, setRedoStack] = useState<Array<Stroke | DrawAnnotation>>(
    [],
  );
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState<{
    /** Fractional x (0..1) of the visual rect. */
    xFrac: number;
    /** Fractional y (0..1) of the visual rect. */
    yFrac: number;
    value: string;
  } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [instruction, setInstruction] = useState("");
  const drawing = useRef(false);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  // Resize tick: bumped by ResizeObserver so the redraw effect re-runs when
  // the canvas element's CSS size changes (e.g. device frame switch).
  const [resizeTick, setResizeTick] = useState(0);

  const scale = zoom / 100;

  // Clear all state on hide so the next open starts fresh.
  useEffect(() => {
    if (!visible) {
      setStrokes([]);
      setTextAnnotations([]);
      setRedoStack([]);
      setCurrentStroke(null);
      setTextInput(null);
      setInstruction("");
    }
  }, [visible]);

  useEffect(() => {
    if (!textInput) return;
    const id = window.requestAnimationFrame(() => {
      textInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [textInput?.xFrac, textInput?.yFrac]);

  // ResizeObserver: bump resizeTick whenever the canvas changes CSS size so
  // the redraw effect re-runs and the backing store is resized correctly.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setResizeTick((t) => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Redraw canvas whenever strokes change or the canvas is resized.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const newW = rect.width * dpr;
    const newH = rect.height * dpr;
    if (newW !== canvasSizeRef.current.w || newH !== canvasSizeRef.current.h) {
      canvas.width = newW;
      canvas.height = newH;
      canvasSizeRef.current = { w: newW, h: newH };
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Points are stored as fractions; multiply by current rect to get visual px.
    for (const stroke of strokes) {
      drawStroke(
        ctx,
        stroke.points.map((p) => ({
          x: p.x * rect.width,
          y: p.y * rect.height,
        })),
        stroke.color,
        stroke.lineWidth,
      );
    }

    if (currentStroke && currentStroke.length > 0) {
      drawStroke(
        ctx,
        currentStroke.map((p) => ({
          x: p.x * rect.width,
          y: p.y * rect.height,
        })),
        color,
        lineWidth,
      );
    }
    // `zoom` is a dependency because it scales the canvas via a CSS transform,
    // which changes getBoundingClientRect() without firing ResizeObserver — the
    // effect must re-run on zoom change to redraw the fraction-based strokes at
    // the new visual size.
  }, [strokes, currentStroke, color, lineWidth, resizeTick, zoom]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (textMode) {
        setTextInput({
          xFrac: (e.clientX - rect.left) / rect.width,
          yFrac: (e.clientY - rect.top) / rect.height,
          value: "",
        });
        return;
      }
      drawing.current = true;
      // Store as fractions so the point survives zoom/resize changes.
      const point = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
      setCurrentStroke([point]);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [textMode],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing.current || textMode) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
      setCurrentStroke((prev) => (prev ? [...prev, point] : [point]));
    },
    [textMode],
  );

  const handlePointerUp = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    if (currentStroke && currentStroke.length > 1) {
      setStrokes((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          points: currentStroke,
          color,
          lineWidth,
          createdAt: Date.now(),
        },
      ]);
      // A new stroke clears the redo stack (standard editor convention).
      setRedoStack([]);
    }
    setCurrentStroke(null);
  }, [currentStroke, color, lineWidth]);

  const handlePointerCancel = useCallback(() => {
    drawing.current = false;
    setCurrentStroke(null);
  }, []);

  /**
   * Undo removes the most recently created annotation (stroke or text) in
   * creation order and pushes it onto the unified redo stack.
   */
  const undo = () => {
    const lastStroke = strokes.length > 0 ? strokes[strokes.length - 1] : null;
    const lastText =
      textAnnotations.length > 0
        ? textAnnotations[textAnnotations.length - 1]
        : null;

    if (!lastStroke && !lastText) return;

    // Remove whichever was created most recently.
    const strokeTime = lastStroke?.createdAt ?? -Infinity;
    const textTime = lastText?.createdAt ?? 0;

    if (lastStroke && strokeTime >= textTime) {
      setStrokes((prev) => prev.slice(0, -1));
      setRedoStack((stack) => [...stack, lastStroke]);
    } else if (lastText) {
      setTextAnnotations((prev) => prev.slice(0, -1));
      setRedoStack((stack) => [...stack, lastText]);
    }
  };

  const redo = () => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const top = stack[stack.length - 1];
      const remaining = stack.slice(0, -1);
      if ("points" in top) {
        // It's a Stroke
        setStrokes((prev) => [...prev, top as Stroke]);
      } else {
        // It's a DrawAnnotation (text)
        setTextAnnotations((prev) => [...prev, top as DrawAnnotation]);
      }
      return remaining;
    });
  };

  const clear = () => {
    if (strokes.length === 0 && textAnnotations.length === 0) return;
    const prevStrokes = strokes;
    const prevTexts = textAnnotations;
    const prevRedo = redoStack;
    setStrokes([]);
    setTextAnnotations([]);
    setRedoStack([]);
    toast(t("visualEditor.clearedAllAnnotations"), {
      action: {
        label: t("visualEditor.undo"),
        onClick: () => {
          // Merge snapshot with any strokes/texts drawn during the toast window
          // so new work is not discarded; also restore the pre-clear redo stack.
          setStrokes((cur) => [...prevStrokes, ...cur]);
          setTextAnnotations((cur) => [...prevTexts, ...cur]);
          setRedoStack(prevRedo);
        },
      },
      duration: 6000,
    });
  };

  const commitTextAnnotation = () => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null);
      return;
    }
    const ann: DrawAnnotation = {
      id: crypto.randomUUID(),
      type: "text",
      text: textInput.value.trim(),
      // Store fractional position so the label stays anchored across zoom changes.
      position: { x: textInput.xFrac, y: textInput.yFrac },
      color,
      lineWidth,
      createdAt: Date.now(),
    };
    setTextAnnotations((prev) => [...prev, ann]);
    // A new text annotation also clears the redo stack.
    setRedoStack([]);
    setTextInput(null);
  };

  const send = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Layout-space dimensions = visual rect / scale factor.
    const layoutW = rect.width / scale;
    const layoutH = rect.height / scale;

    const pathAnnotations: DrawAnnotation[] = strokes.map((s) => ({
      id: s.id,
      type: "path",
      // Convert fractional points to layout-space absolute pixels for the agent.
      pathData: s.points
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"}${(p.x * layoutW).toFixed(1)},${(p.y * layoutH).toFixed(1)}`,
        )
        .join(" "),
      color: s.color,
      lineWidth: s.lineWidth,
      position: { x: 0, y: 0 },
    }));

    // Convert fractional text positions to layout-space absolute pixels.
    const layoutTextAnnotations: DrawAnnotation[] = textAnnotations.map(
      (a) => ({
        ...a,
        position: {
          x: a.position.x * layoutW,
          y: a.position.y * layoutH,
        },
      }),
    );

    const all = [...pathAnnotations, ...layoutTextAnnotations];
    if (all.length === 0 && !instruction.trim()) return;

    onSend(all, instruction.trim(), {
      width: layoutW,
      height: layoutH,
    });
  };

  if (!visible) return null;

  const hasContent =
    strokes.length > 0 ||
    textAnnotations.length > 0 ||
    instruction.trim() ||
    queuedAnnotationCount > 0;

  const canUndo = strokes.length > 0 || textAnnotations.length > 0;
  const canRedo = redoStack.length > 0;

  const toolbar = (
    <div
      data-draw-toolbar
      className="pointer-events-auto fixed bottom-20 left-1/2 z-[110] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-2xl"
    >
      {/* Color picker */}
      <div className="flex gap-1">
        {PRESET_COLORS.map((preset) => (
          <Tooltip key={preset.color}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={preset.label}
                data-testid={`draw-color-${preset.label.toLowerCase()}`}
                onClick={() => setColor(preset.color)}
                className={cn(
                  "h-5 w-5 cursor-pointer rounded-full",
                  color === preset.color
                    ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                    : "ring-1 ring-border",
                )}
                style={{ backgroundColor: preset.color }}
              />
            </TooltipTrigger>
            <TooltipContent>{preset.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Line widths */}
      <div className="flex gap-1">
        {LINE_WIDTHS.map((lw) => (
          <Tooltip key={lw.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={lw.label}
                data-testid={`draw-line-width-${lw.label.toLowerCase()}`}
                onClick={() => setLineWidth(lw.value)}
                className={cn(
                  "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
                  lineWidth === lw.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: lw.value + 2, height: lw.value + 2 }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{lw.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Text mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.typeAnywhereOnCanvas")}
            data-testid="draw-text-mode"
            onClick={() => setTextMode(!textMode)}
            className={cn(
              "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
              textMode
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <IconCursorText className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {t("visualEditor.typeAnywhereOnCanvas")}
        </TooltipContent>
      </Tooltip>

      {/* Undo last annotation (stroke or text) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.undoStroke")}
            data-testid="draw-undo"
            onClick={undo}
            disabled={!canUndo}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          >
            <IconArrowBackUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.undoStroke")}</TooltipContent>
      </Tooltip>

      {/* Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.redoStroke")}
            data-testid="draw-redo"
            onClick={redo}
            disabled={!canRedo}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          >
            <IconArrowForwardUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.redoStroke")}</TooltipContent>
      </Tooltip>

      {/* Clear all */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.clearAll")}
            data-testid="draw-clear-all"
            onClick={clear}
            disabled={strokes.length === 0 && textAnnotations.length === 0}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          >
            <IconEraser className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.clearAll")}</TooltipContent>
      </Tooltip>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Instruction input */}
      <Input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hasContent) send();
          if (e.key === "Escape") onClose();
        }}
        placeholder={t("visualEditor.tellAgentWhatToDo")}
        className="h-7 w-56 border-border bg-background text-xs"
      />

      {/* Send */}
      <Button
        size="sm"
        data-testid="draw-send"
        className="h-7 gap-1 px-3 !text-[11px] cursor-pointer"
        onClick={send}
        disabled={!hasContent}
      >
        <IconSend className="h-3 w-3" />
        {t("visualEditor.send")}
      </Button>

      {/* Close */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("visualEditor.exitDrawMode")}
            data-testid="draw-exit"
            onClick={onClose}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("visualEditor.exitDrawMode")}</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-draw-overlay
      className={cn(
        "absolute inset-0 z-[100]",
        canvasInteractive ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        data-draw-canvas
        className={cn(
          "absolute inset-0 h-full w-full",
          textMode ? "cursor-text" : "cursor-crosshair",
          !canvasInteractive && "pointer-events-none",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />

      {/* Rendered text annotations.
          Positions are stored as fractions (0..1) of the visual rect. Convert
          to layout-space pixels (fraction * visualDim / scale) so the label
          sits at the right layout position inside the scaled wrapper, where
          CSS left/top are interpreted in pre-scale coordinates. */}
      {textAnnotations.map((ann) => {
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const layoutX = rect
          ? (ann.position.x * rect.width) / scale
          : ann.position.x;
        const layoutY = rect
          ? (ann.position.y * rect.height) / scale
          : ann.position.y;
        return (
          <div
            key={ann.id}
            className="absolute pointer-events-none select-none whitespace-nowrap font-semibold"
            style={{
              left: layoutX,
              top: layoutY,
              color: ann.color,
              fontSize: 14 + ann.lineWidth,
            }}
          >
            {ann.text}
          </div>
        );
      })}

      {/* Pending text input — positioned at the click point in layout space. */}
      {textInput &&
        (() => {
          const canvas = canvasRef.current;
          const rect = canvas?.getBoundingClientRect();
          const layoutX = rect
            ? (textInput.xFrac * rect.width) / scale
            : textInput.xFrac;
          const layoutY = rect
            ? (textInput.yFrac * rect.height) / scale
            : textInput.yFrac;
          return (
            <div
              className="pointer-events-auto absolute z-40"
              style={{ left: layoutX, top: layoutY }}
            >
              <Input
                ref={textInputRef}
                value={textInput.value}
                onChange={(e) =>
                  setTextInput((prev) =>
                    prev ? { ...prev, value: e.target.value } : null,
                  )
                }
                onBlur={() => {
                  if (textInput.value.trim()) commitTextAnnotation();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTextAnnotation();
                  }
                  if (e.key === "Escape") setTextInput(null);
                }}
                className="h-7 w-48 border-primary bg-background text-sm"
                autoFocus
                placeholder={t("visualEditor.typeAnnotationFancy")}
              />
            </div>
          );
        })()}

      <DrawToolbarPortal>{toolbar}</DrawToolbarPortal>
    </div>
  );
}

function DrawToolbarPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  lineWidth: number,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}
