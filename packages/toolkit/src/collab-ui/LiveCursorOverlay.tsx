
import { useState, useEffect, useRef, memo, type RefObject } from "react";

import type { OtherPresence, NormalizedPoint } from "./types.js";

export interface CursorMapFn {
  (norm: NormalizedPoint): { x: number; y: number };
}

export interface LiveCursorOverlayProps {
  others: OtherPresence[];
  cursorKey?: string;
  mapCoords?: CursorMapFn;
  containerRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const STALE_MS = 10_000;

function CursorPointer({ color }: { color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="25"
      height="29"
      viewBox="0 0 25 29"
      fill="none"
      aria-hidden
      style={{
        display: "block",
        filter: "drop-shadow(0 2px 3px rgba(15, 23, 42, 0.3))",
      }}
    >
      <path
        d="M2.5 2.5L21.5 11L12.6 14.1L8.3 24.5L2.5 2.5Z"
        fill={color}
        stroke="white"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
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
        left: 0,
        top: 0,
        pointerEvents: "none",
        userSelect: "none",
        transform: `translate3d(${x - 2}px, ${y - 2}px, 0)`,
        zIndex: 9999,
        transition: "transform 80ms linear",
        willChange: "transform",
        width: 0,
        height: 0,
      }}
    >
      <CursorPointer color={color} />
      <div
        style={{
          position: "absolute",
          left: 31,
          top: 31,
          display: "flex",
          alignItems: "center",
          gap: 5,
          backgroundColor: color,
          color: "#fff",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: "16px",
          padding: "2px 7px",
          borderRadius: 2,
          whiteSpace: "nowrap",
          boxShadow: "0 5px 12px rgba(15, 23, 42, 0.16)",
          maxWidth: 150,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {(other.user as { avatarUrl?: string }).avatarUrl ? (
          <img
            src={(other.user as { avatarUrl?: string }).avatarUrl}
            alt=""
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
        ) : null}
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
  const [, tick] = useState(0);
  const entriesRef = useRef<Map<number, CursorEntry>>(new Map());

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const visible: CursorEntry[] = [];

  for (const other of others) {
    const pos = other.presence[cursorKey] as NormalizedPoint | undefined;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number")
      continue;

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
