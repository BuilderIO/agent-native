// @agent-native/pinpoint — Canvas-based selection overlay
// MIT License
//
// Uses <canvas> for hover highlight, drag rectangle, and pin outlines.
// More performant than DOM overlays — no layout/reflow.
// LERP interpolation for smooth animation.

import { createEffect, onMount, onCleanup, type Component } from "solid-js";
import type { Pin } from "../../types/index.js";

interface OverlayCanvasProps {
  hoveredRect: DOMRect | null;
  dragRect: DOMRect | null;
  pins: Pin[];
  active: boolean;
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

  function draw() {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvasRef.width / dpr, canvasRef.height / dpr);

    if (!props.active) {
      animFrameId = requestAnimationFrame(draw);
      return;
    }

    // Draw hover highlight with LERP interpolation
    if (props.hoveredRect) {
      targetRect = {
        x: props.hoveredRect.x,
        y: props.hoveredRect.y,
        width: props.hoveredRect.width,
        height: props.hoveredRect.height,
      };
    } else {
      targetRect = null;
    }

    if (targetRect) {
      currentRect.x = lerp(currentRect.x, targetRect.x, LERP_SPEED);
      currentRect.y = lerp(currentRect.y, targetRect.y, LERP_SPEED);
      currentRect.width = lerp(currentRect.width, targetRect.width, LERP_SPEED);
      currentRect.height = lerp(
        currentRect.height,
        targetRect.height,
        LERP_SPEED,
      );

      // Hover highlight box
      ctx.strokeStyle = "rgba(59, 130, 246, 0.8)"; // --pp-accent
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

    // Draw drag selection rectangle
    if (props.dragRect) {
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

    // Draw pin outlines for annotated elements
    for (let i = 0; i < props.pins.length; i++) {
      const pin = props.pins[i];
      const el = document.querySelector(pin.element.selector);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const statusColor =
        pin.status.state === "resolved"
          ? "rgba(34, 197, 94, 0.6)"
          : pin.status.state === "acknowledged"
            ? "rgba(234, 179, 8, 0.6)"
            : "rgba(239, 68, 68, 0.6)";

      ctx.strokeStyle = statusColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }

    animFrameId = requestAnimationFrame(draw);
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
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        "pointer-events": "none",
        "z-index": "2147483645",
      }}
    />
  );
};
