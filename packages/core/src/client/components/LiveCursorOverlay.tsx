/**
 * LiveCursorOverlay — renders remote users' cursors over an absolutely-
 * positioned container.
 *
 * Cursor positions are expected as normalized coordinates (0–1 relative to
 * the container's content size) so different zoom/scroll positions map
 * correctly. Pass a `mapCoords` prop to handle non-identity transforms
 * (e.g. a zoomed canvas).
 *
 * The agent's cursor is styled distinctly with a sparkle variant + "AI"
 * label, consistent with AgentPresenceChip.
 *
 * Cursors fade out after 10 seconds of no movement.
 */

import { IconSparkles } from "@tabler/icons-react";
import { useState, useEffect, useRef, memo } from "react";

import type { OtherPresence, NormalizedPoint } from "../../collab/presence.js";

export interface CursorMapFn {
  /** Convert normalized coords to pixel offsets within the overlay container. */
  (norm: NormalizedPoint): { x: number; y: number };
}

export interface LiveCursorOverlayProps {
  /** Remote participants with presence payload. */
  others: OtherPresence[];
  /**
   * Key inside presence payload that carries the cursor position.
   * Default: "cursor"
   * Expected shape: { x: number; y: number } (normalized 0–1).
   */
  cursorKey?: string;
  /**
   * Override coordinate mapping. Default: scale by container clientWidth/Height.
   * Pass this when the container uses transform: scale() or has virtual scroll.
   */
  mapCoords?: CursorMapFn;
  /**
   * Container element ref. Required when mapCoords is not provided —
   * used to compute pixel positions from normalized coords.
   */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Additional CSS class for the overlay div. */
  className?: string;
}

const STALE_MS = 10_000; // Fade out cursors older than 10s

const CURSOR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="22" viewBox="0 0 16 22" fill="none">
    <path d="M0 0L0 18L4.5 13.5L7.5 20L9.5 19.5L6.5 13L12 13L0 0Z" fill="__COLOR__" stroke="white" stroke-width="1"/>
  </svg>
`.trim();

function CursorPointer({
  color,
  isAgent,
}: {
  color: string;
  isAgent: boolean;
}) {
  if (isAgent) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          backgroundColor: color,
          color: "#fff",
          boxShadow: `0 0 0 2px #fff`,
        }}
      >
        <IconSparkles size={12} stroke={2} />
      </div>
    );
  }

  const svgSrc =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(CURSOR_SVG.replace("__COLOR__", color));

  return (
    <img
      src={svgSrc}
      alt=""
      aria-hidden
      style={{ width: 16, height: 22, display: "block", flexShrink: 0 }}
    />
  );
}

interface CursorEntry {
  other: OtherPresence;
  x: number;
  y: number;
  lastSeen: number;
}

const CursorLabel = memo(function CursorLabel({
  entry,
}: {
  entry: CursorEntry;
}) {
  const { other, x, y } = entry;
  const color = other.user.color || "#94a3b8";
  const label = other.isAgent ? "AI" : other.user.name || other.user.email;

  return (
    <div
      aria-label={`${label} cursor`}
      style={{
        position: "absolute",
        left: x,
        top: y,
        pointerEvents: "none",
        userSelect: "none",
        transform: "translate(-2px, -2px)",
        zIndex: 9999,
        transition: "left 120ms linear, top 120ms linear",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
      }}
    >
      <CursorPointer color={color} isAgent={other.isAgent} />
      <div
        style={{
          backgroundColor: color,
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          padding: "1px 5px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          marginLeft: other.isAgent ? 0 : 4,
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {other.isAgent && (
          <IconSparkles
            size={9}
            stroke={2}
            style={{ flexShrink: 0, opacity: 0.85 }}
          />
        )}
        {label}
      </div>
    </div>
  );
});

export function LiveCursorOverlay({
  others,
  cursorKey = "cursor",
  mapCoords,
  containerRef,
  className,
}: LiveCursorOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0); // Force re-render to prune stale cursors
  const entriesRef = useRef<Map<number, CursorEntry>>(new Map());

  // Tick every 5s to prune stale cursors (no re-render storm).
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  // Build entries from others, computing pixel positions.
  const now = Date.now();
  const visible: CursorEntry[] = [];

  for (const other of others) {
    const pos = other.presence[cursorKey] as NormalizedPoint | undefined;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number")
      continue;

    // Compute pixel position.
    let px: number;
    let py: number;
    if (mapCoords) {
      const mapped = mapCoords(pos);
      px = mapped.x;
      py = mapped.y;
    } else {
      const container =
        containerRef?.current ?? overlayRef.current?.parentElement;
      const w = container ? container.clientWidth : 0;
      const h = container ? container.clientHeight : 0;
      px = pos.x * w;
      py = pos.y * h;
    }

    const prev = entriesRef.current.get(other.clientId);
    const lastSeen =
      prev && prev.x === px && prev.y === py ? prev.lastSeen : now;
    const entry: CursorEntry = { other, x: px, y: py, lastSeen };
    entriesRef.current.set(other.clientId, entry);

    if (now - lastSeen < STALE_MS) {
      visible.push(entry);
    }
  }

  // Remove entries for participants who left.
  for (const clientId of entriesRef.current.keys()) {
    if (!others.find((o) => o.clientId === clientId)) {
      entriesRef.current.delete(clientId);
    }
  }

  if (visible.length === 0) {
    return (
      <div
        ref={overlayRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
        className={className}
      />
    );
  }

  return (
    <div
      ref={overlayRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      className={className}
    >
      {visible.map((entry) => (
        <CursorLabel key={entry.other.clientId} entry={entry} />
      ))}
    </div>
  );
}
