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
import {
  IconEraser,
  IconArrowBackUp,
  IconSend,
  IconCursorText,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
export function DrawOverlay({ visible, onSend, onClose }: DrawOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(PRESET_COLORS[0].color);
  const [lineWidth, setLineWidth] = useState(LINE_WIDTHS[1].value);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [textAnnotations, setTextAnnotations] = useState<DrawAnnotation[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    value: string;
  } | null>(null);
  const [instruction, setInstruction] = useState("");
  const drawing = useRef(false);

  // Clear all state on hide so the next open starts fresh.
  useEffect(() => {
    if (!visible) {
      setStrokes([]);
      setTextAnnotations([]);
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
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

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
    }
    setCurrentStroke(null);
  }, [currentStroke, color, lineWidth]);

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clear = () => {
    setStrokes([]);
    setTextAnnotations([]);
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
    strokes.length > 0 || textAnnotations.length > 0 || instruction.trim();

  return (
    <div
      ref={containerRef}
      data-draw-overlay
      className="absolute inset-0 z-30 pointer-events-auto"
    >
      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        data-draw-canvas
        className={cn(
          "absolute inset-0 h-full w-full",
          textMode ? "cursor-text" : "cursor-crosshair",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
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
          className="absolute z-40"
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
            placeholder="Type annotation…"
          />
        </div>
      )}

      {/* Bottom toolbar */}
      <div
        data-draw-toolbar
        className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-2xl"
      >
        {/* Color picker */}
        <div className="flex gap-1">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset.color}
              onClick={() => setColor(preset.color)}
              className={cn(
                "h-5 w-5 cursor-pointer rounded-full",
                color === preset.color
                  ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover"
                  : "ring-1 ring-border",
              )}
              style={{ backgroundColor: preset.color }}
              title={preset.label}
            />
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Line widths */}
        <div className="flex gap-1">
          {LINE_WIDTHS.map((lw) => (
            <button
              key={lw.value}
              onClick={() => setLineWidth(lw.value)}
              className={cn(
                "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
                lineWidth === lw.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={lw.label}
            >
              <div
                className="rounded-full bg-current"
                style={{ width: lw.value + 2, height: lw.value + 2 }}
              />
            </button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Text mode */}
        <button
          onClick={() => setTextMode(!textMode)}
          className={cn(
            "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
            textMode
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Type anywhere on the canvas"
        >
          <IconCursorText className="h-3.5 w-3.5" />
        </button>

        {/* Undo last stroke */}
        <button
          onClick={undo}
          disabled={strokes.length === 0}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          title="Undo stroke"
        >
          <IconArrowBackUp className="h-3.5 w-3.5" />
        </button>

        {/* Clear all */}
        <button
          onClick={clear}
          disabled={strokes.length === 0 && textAnnotations.length === 0}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
          title="Clear all"
        >
          <IconEraser className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Instruction input */}
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hasContent) send();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Tell the agent what to do…"
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
          Send
        </Button>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          title="Exit draw mode"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
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
