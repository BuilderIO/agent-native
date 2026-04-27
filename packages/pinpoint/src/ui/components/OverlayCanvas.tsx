// @agent-native/pinpoint — Canvas-based selection overlay + draw mode
// MIT License
//
// Uses <canvas> for hover highlight, drag rectangle, pin outlines,
// and freehand/shape drawing.
// LERP interpolation for smooth hover animation.

import { createEffect, onMount, onCleanup, type Component } from "solid-js";
import type {
  Pin,
  DrawStroke,
  DrawToolType,
  TextNote,
} from "../../types/index.js";

interface OverlayCanvasProps {
  hoveredRect: DOMRect | null;
  dragRect: DOMRect | null;
  pins: Pin[];
  active: boolean;
  // Draw mode
  drawMode: boolean;
  drawStrokes: DrawStroke[];
  currentStroke: DrawStroke | null;
  drawColor: string;
  drawLineWidth: number;
  drawTool: DrawToolType;
  textNotes: TextNote[];
  onDrawStart: (x: number, y: number) => void;
  onDrawMove: (x: number, y: number) => void;
  onDrawEnd: () => void;
  onTextPlace: (x: number, y: number) => void;
}

// LERP interpolation for smooth transitions
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

interface AnimatedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const OverlayCanvas: Component<OverlayCanvasProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animFrameId: number | null = null;
  let currentRect: AnimatedRect = { x: 0, y: 0, width: 0, height: 0 };
  let targetRect: AnimatedRect | null = null;
  const LERP_SPEED = 0.25;

  function resizeCanvas() {
    if (!canvasRef) return;
    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = window.innerWidth * dpr;
    canvasRef.height = window.innerHeight * dpr;
    canvasRef.style.width = `${window.innerWidth}px`;
    canvasRef.style.height = `${window.innerHeight}px`;
    const ctx = canvasRef.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
    if (stroke.points.length < 1) return;

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);

    if (stroke.type === "freehand") {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    } else if (stroke.type === "arrow") {
      if (stroke.points.length < 2) return;
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];

      // Line
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = 12 + stroke.lineWidth * 2;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLen * Math.cos(angle - Math.PI / 6),
        end.y - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLen * Math.cos(angle + Math.PI / 6),
        end.y - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
    } else if (stroke.type === "circle") {
      if (stroke.points.length < 2) return;
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.type === "rect") {
      if (stroke.points.length < 2) return;
      const start = stroke.points[0];
      const end = stroke.points[stroke.points.length - 1];
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    }
  }

  function drawTextNote(ctx: CanvasRenderingContext2D, note: TextNote) {
    const fontSize = 13;
    const padding = 6;
    ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

    const metrics = ctx.measureText(note.text);
    const textWidth = metrics.width;
    const textHeight = fontSize + 2;

    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    const bgX = note.x - 2;
    const bgY = note.y - textHeight - padding / 2;
    const bgW = textWidth + padding * 2;
    const bgH = textHeight + padding;
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(bgX + r, bgY);
    ctx.lineTo(bgX + bgW - r, bgY);
    ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + r);
    ctx.lineTo(bgX + bgW, bgY + bgH - r);
    ctx.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - r, bgY + bgH);
    ctx.lineTo(bgX + r, bgY + bgH);
    ctx.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - r);
    ctx.lineTo(bgX, bgY + r);
    ctx.quadraticCurveTo(bgX, bgY, bgX + r, bgY);
    ctx.closePath();
    ctx.fill();

    // Colored indicator dot
    ctx.fillStyle = note.color;
    ctx.beginPath();
    ctx.arc(bgX + padding, bgY + bgH / 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(note.text, bgX + padding + 10, note.y - 2);
  }

  function draw() {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvasRef.width / dpr, canvasRef.height / dpr);

    // Draw hover highlight with LERP interpolation (only when active and not in draw mode)
    if (props.active && !props.drawMode && props.hoveredRect) {
      targetRect = {
        x: props.hoveredRect.x,
        y: props.hoveredRect.y,
        width: props.hoveredRect.width,
        height: props.hoveredRect.height,
      };
    } else if (props.active && !props.drawMode) {
      targetRect = null;
    }

    if (props.active && !props.drawMode && targetRect) {
      currentRect.x = lerp(currentRect.x, targetRect.x, LERP_SPEED);
      currentRect.y = lerp(currentRect.y, targetRect.y, LERP_SPEED);
      currentRect.width = lerp(currentRect.width, targetRect.width, LERP_SPEED);
      currentRect.height = lerp(
        currentRect.height,
        targetRect.height,
        LERP_SPEED,
      );

      // Hover highlight box
      ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(
        currentRect.x,
        currentRect.y,
        currentRect.width,
        currentRect.height,
      );

      // Fill with semi-transparent overlay
      ctx.fillStyle = "rgba(59, 130, 246, 0.06)";
      ctx.fillRect(
        currentRect.x,
        currentRect.y,
        currentRect.width,
        currentRect.height,
      );
    }

    // Draw drag selection rectangle (only when active)
    if (props.active && !props.drawMode && props.dragRect) {
      ctx.strokeStyle = "rgba(59, 130, 246, 0.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        props.dragRect.x,
        props.dragRect.y,
        props.dragRect.width,
        props.dragRect.height,
      );

      ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
      ctx.fillRect(
        props.dragRect.x,
        props.dragRect.y,
        props.dragRect.width,
        props.dragRect.height,
      );
    }

    // Draw all completed strokes
    for (const stroke of props.drawStrokes) {
      drawStroke(ctx, stroke);
    }

    // Draw current in-progress stroke
    if (props.currentStroke) {
      drawStroke(ctx, props.currentStroke);
    }

    // Draw text notes
    for (const note of props.textNotes) {
      drawTextNote(ctx, note);
    }

    animFrameId = requestAnimationFrame(draw);
  }

  // Mouse handlers for draw mode
  function handleMouseDown(e: MouseEvent) {
    if (!props.drawMode) return;
    if (props.drawTool === "text") {
      props.onTextPlace(e.clientX, e.clientY);
    } else {
      props.onDrawStart(e.clientX, e.clientY);
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!props.drawMode) return;
    props.onDrawMove(e.clientX, e.clientY);
  }

  function handleMouseUp(_e: MouseEvent) {
    if (!props.drawMode) return;
    props.onDrawEnd();
  }

  // Touch handlers for draw mode
  function handleTouchStart(e: TouchEvent) {
    if (!props.drawMode) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (props.drawTool === "text") {
      props.onTextPlace(touch.clientX, touch.clientY);
    } else {
      props.onDrawStart(touch.clientX, touch.clientY);
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (!props.drawMode) return;
    e.preventDefault();
    const touch = e.touches[0];
    props.onDrawMove(touch.clientX, touch.clientY);
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!props.drawMode) return;
    e.preventDefault();
    props.onDrawEnd();
  }

  onMount(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    animFrameId = requestAnimationFrame(draw);
  });

  onCleanup(() => {
    window.removeEventListener("resize", resizeCanvas);
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
    }
  });

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        "pointer-events": props.drawMode ? "auto" : "none",
        "z-index": "2147483645",
        cursor: props.drawMode
          ? props.drawTool === "text"
            ? "text"
            : "crosshair"
          : "default",
      }}
    />
  );
};
