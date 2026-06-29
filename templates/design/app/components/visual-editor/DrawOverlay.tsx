import { useT } from "@agent-native/core/client";
import {
  IconEraser,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconSend,
  IconCursorText,
  IconX,
} from "@tabler/icons-react";
/**
 * NOTE: This is the new shared visual-editor DrawOverlay, mirrored from the
 * slides template so both apps share the same comment/draw/save UX.
 *
 * The legacy iframe-based design overlay still lives at
 * `app/components/design/DrawOverlay.tsx` and is currently wired into
 * `DesignCanvas`. Both exist for now; the legacy one can be migrated to use
 * this shared version in a follow-up. Don't import both in the same screen.
 */
import { useState, useRef, useCallback, useEffect } from "react";
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
}

interface DrawOverlayProps {
  /** Whether the overlay is currently visible (toggled from the toolbar) */
  visible: boolean;
  /** When false, canvas clicks pass through to sibling tools while the toolbar stays usable. */
  canvasInteractive?: boolean;
  /** Extra queued annotations owned by sibling tools, such as comment pins. */
  queuedAnnotationCount?: number;
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

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  points: Point[];
  color: string;
  lineWidth: number;
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
 */
export function DrawOverlay({
  visible,
  canvasInteractive = true,
  queuedAnnotationCount = 0,
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
  // Redo stack. Pushing here happens via undo(); a fresh stroke clears it
  // (standard editor convention — once you draw something new, the redo
  // history is no longer reachable).
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    value: string;
  } | null>(null);
  const [instruction, setInstruction] = useState("");
  const drawing = useRef(false);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // Clear all state on hide so the next open starts fresh.
  useEffect(() => {
    if (!visible) {
      setStrokes([]);
      setTextAnnotations([]);
      setRedoStrokes([]);
      setCurrentStroke(null);
      setTextInput(null);
      setInstruction("");
    }
  }, [visible]);

  // Redraw canvas whenever strokes change.
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

    for (const stroke of strokes) {
      drawStroke(ctx, stroke.points, stroke.color, stroke.lineWidth);
    }

    if (currentStroke && currentStroke.length > 0) {
      drawStroke(ctx, currentStroke, color, lineWidth);
    }
  }, [strokes, currentStroke, color, lineWidth]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (textMode) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        setTextInput({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          value: "",
        });
        return;
      }
      drawing.current = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
        },
      ]);
      setRedoStrokes([]);
    }
    setCurrentStroke(null);
  }, [currentStroke, color, lineWidth]);

  const handlePointerCancel = useCallback(() => {
    drawing.current = false;
    setCurrentStroke(null);
  }, []);

  const undo = () => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStrokes((stack) => [...stack, last]);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStrokes((stack) => {
      if (stack.length === 0) return stack;
      const top = stack[stack.length - 1];
      setStrokes((prev) => [...prev, top]);
      return stack.slice(0, -1);
    });
  };

  const clear = () => {
    if (strokes.length === 0 && textAnnotations.length === 0) return;
    // Snapshot for the toast's Undo. Using a toast (instead of an AlertDialog
    // confirm) keeps Clear a single click for users who know what they want,
    // while still letting an accidental click be recovered for the toast's
    // lifetime.
    const prevStrokes = strokes;
    const prevTexts = textAnnotations;
    setStrokes([]);
    setTextAnnotations([]);
    setRedoStrokes([]);
    toast(t("visualEditor.clearedAllAnnotations"), {
      action: {
        label: t("visualEditor.undo"),
        onClick: () => {
          setStrokes(prevStrokes);
          setTextAnnotations(prevTexts);
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
    setTextAnnotations((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: "text",
        text: textInput.value.trim(),
        position: { x: textInput.x, y: textInput.y },
        color,
        lineWidth,
      },
    ]);
    setTextInput(null);
  };

  const send = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const pathAnnotations: DrawAnnotation[] = strokes.map((s) => ({
      id: s.id,
      type: "path",
      pathData: s.points
        .map(
          (p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
        )
        .join(" "),
      color: s.color,
      lineWidth: s.lineWidth,
      position: { x: 0, y: 0 },
    }));

    const all = [...pathAnnotations, ...textAnnotations];
    if (all.length === 0 && !instruction.trim()) return;

    onSend(all, instruction.trim(), {
      width: rect.width,
      height: rect.height,
    });
  };

  if (!visible) return null;

  const hasContent =
    strokes.length > 0 ||
    textAnnotations.length > 0 ||
    instruction.trim() ||
    queuedAnnotationCount > 0;

  return (
    <div
      ref={containerRef}
      data-draw-overlay
      className={cn(
        "absolute inset-0 z-30",
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

      {/* Rendered text annotations */}
      {textAnnotations.map((ann) => (
        <div
          key={ann.id}
          className="absolute pointer-events-none select-none whitespace-nowrap font-semibold"
          style={{
            left: ann.position.x,
            top: ann.position.y,
            color: ann.color,
            fontSize: 14 + ann.lineWidth,
          }}
        >
          {ann.text}
        </div>
      ))}

      {/* Pending text input */}
      {textInput && (
        <div
          className="pointer-events-auto absolute z-40"
          style={{ left: textInput.x, top: textInput.y }}
        >
          <Input
            value={textInput.value}
            onChange={(e) =>
              setTextInput((prev) =>
                prev ? { ...prev, value: e.target.value } : null,
              )
            }
            onBlur={commitTextAnnotation}
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
      )}

      {/* Bottom toolbar */}
      <div
        data-draw-toolbar
        className="pointer-events-auto absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-2xl"
      >
        {/* Color picker */}
        <div className="flex gap-1">
          {PRESET_COLORS.map((preset) => (
            <Tooltip key={preset.color}>
              <TooltipTrigger asChild>
                <button
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

        {/* Undo last stroke */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={undo}
              disabled={strokes.length === 0}
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
              onClick={redo}
              disabled={redoStrokes.length === 0}
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
          className="h-7 gap-1 px-3 text-[11px] cursor-pointer"
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
              onClick={onClose}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("visualEditor.exitDrawMode")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
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
