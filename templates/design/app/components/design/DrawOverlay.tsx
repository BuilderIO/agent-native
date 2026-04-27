import { useState, useRef, useCallback, useEffect } from "react";
import {
  IconEraser,
  IconArrowBackUp,
  IconSend,
  IconPlus,
  IconCursorText,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DrawAnnotation } from "./types";

interface DrawOverlayProps {
  visible: boolean;
  onQueue: (annotation: DrawAnnotation) => void;
  onSend: (annotations: DrawAnnotation[]) => void;
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

export function DrawOverlay({ visible, onQueue, onSend }: DrawOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(PRESET_COLORS[0].color);
  const [lineWidth, setLineWidth] = useState(LINE_WIDTHS[1].value);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);
  const [queued, setQueued] = useState<DrawAnnotation[]>([]);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState<{
    x: number;
    y: number;
    value: string;
  } | null>(null);
  const drawing = useRef(false);

  // Redraw canvas when strokes change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match canvas size to element size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw completed strokes
    for (const stroke of strokes) {
      drawStroke(ctx, stroke.points, stroke.color, stroke.lineWidth);
    }

    // Draw current stroke
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

  const undo = () => {
    setStrokes((prev) => prev.slice(0, -1));
  };

  const clear = () => {
    setStrokes([]);
  };

  const commitTextAnnotation = () => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null);
      return;
    }
    const annotation: DrawAnnotation = {
      id: crypto.randomUUID(),
      type: "text",
      text: textInput.value.trim(),
      position: { x: textInput.x, y: textInput.y },
      color,
      lineWidth,
    };
    onQueue(annotation);
    setQueued((prev) => [...prev, annotation]);
    setTextInput(null);
  };

  const queueDrawing = () => {
    if (strokes.length === 0) return;

    // Convert strokes to SVG path data
    const pathData = strokes
      .map((s) => {
        const d = s.points
          .map(
            (p, i) =>
              `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
          )
          .join(" ");
        return d;
      })
      .join(" ");

    const annotation: DrawAnnotation = {
      id: crypto.randomUUID(),
      type: "path",
      pathData,
      position: { x: 0, y: 0 },
      color,
      lineWidth,
    };
    onQueue(annotation);
    setQueued((prev) => [...prev, annotation]);
    setStrokes([]);
  };

  const sendAll = () => {
    // Queue current drawing first if any
    let allAnnotations = [...queued];
    if (strokes.length > 0) {
      const pathData = strokes
        .map((s) => {
          const d = s.points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
            )
            .join(" ");
          return d;
        })
        .join(" ");

      allAnnotations.push({
        id: crypto.randomUUID(),
        type: "path",
        pathData,
        position: { x: 0, y: 0 },
        color,
        lineWidth,
      });
    }

    if (allAnnotations.length > 0) {
      onSend(allAnnotations);
    }
    setQueued([]);
    setStrokes([]);
  };

  if (!visible) return null;

  const pathCount =
    queued.filter((a) => a.type === "path").length +
    (strokes.length > 0 ? 1 : 0);
  const textCount = queued.filter((a) => a.type === "text").length;
  const totalQueued = queued.length + (strokes.length > 0 ? 1 : 0);

  return (
    <div className="absolute inset-0 z-20">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 h-full w-full",
          textMode ? "cursor-text" : "cursor-crosshair",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Text input overlay */}
      {textInput && (
        <div
          className="absolute z-30"
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
              if (e.key === "Enter") commitTextAnnotation();
              if (e.key === "Escape") setTextInput(null);
            }}
            className="h-7 w-48 border-primary bg-background text-sm"
            autoFocus
            placeholder="Type annotation..."
          />
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] px-3 py-2 shadow-2xl backdrop-blur-sm">
        {/* Color picker */}
        <div className="flex gap-1">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset.color}
              onClick={() => setColor(preset.color)}
              className={cn(
                "h-5 w-5 cursor-pointer rounded-full",
                color === preset.color
                  ? "ring-2 ring-white ring-offset-1 ring-offset-[hsl(240,5%,8%)]"
                  : "ring-1 ring-white/10",
              )}
              style={{ backgroundColor: preset.color }}
              title={preset.label}
            />
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Line widths */}
        <div className="flex gap-1">
          {LINE_WIDTHS.map((lw) => (
            <button
              key={lw.value}
              onClick={() => setLineWidth(lw.value)}
              className={cn(
                "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
                lineWidth === lw.value
                  ? "bg-white/10 text-white"
                  : "text-white/30 hover:text-white/50",
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

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Text mode toggle */}
        <button
          onClick={() => setTextMode(!textMode)}
          className={cn(
            "flex h-6 w-6 cursor-pointer items-center justify-center rounded",
            textMode
              ? "bg-white/10 text-white"
              : "text-white/30 hover:text-white/50",
          )}
          title="Type anywhere"
        >
          <IconCursorText className="h-3.5 w-3.5" />
        </button>

        {/* Undo */}
        <button
          onClick={undo}
          disabled={strokes.length === 0}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-white/30 hover:text-white/50 disabled:cursor-default disabled:opacity-30"
          title="Undo"
        >
          <IconArrowBackUp className="h-3.5 w-3.5" />
        </button>

        {/* Clear */}
        <button
          onClick={clear}
          disabled={strokes.length === 0}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-white/30 hover:text-white/50 disabled:cursor-default disabled:opacity-30"
          title="Clear"
        >
          <IconEraser className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* Queue counter */}
        {totalQueued > 0 && (
          <span className="text-[10px] text-white/40">
            {pathCount > 0 && `Draw x${pathCount}`}
            {pathCount > 0 && textCount > 0 && " / "}
            {textCount > 0 && `Click x${textCount}`}
          </span>
        )}

        {/* Queue button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-white/50 hover:text-white"
          onClick={queueDrawing}
          disabled={strokes.length === 0}
        >
          <IconPlus className="h-3 w-3" />
          Queue
        </Button>

        {/* Send button */}
        <Button
          size="sm"
          className="h-6 gap-1 px-3 text-[11px]"
          onClick={sendAll}
          disabled={totalQueued === 0 && strokes.length === 0}
        >
          <IconSend className="h-3 w-3" />
          Send
        </Button>
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
