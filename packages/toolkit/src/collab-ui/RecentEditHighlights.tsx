
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { RECENT_EDIT_TTL_MS, type AttributedRecentEdit } from "./types.js";

export interface RecentEditHighlightsProps {
  edits: AttributedRecentEdit[];
  resolveRect: (edit: AttributedRecentEdit) => DOMRect | null;
  containerRef: RefObject<HTMLElement | null>;
  ttlMs?: number;
  outlineOnly?: boolean;
  className?: string;
}

interface Highlight {
  key: string;
  color: string;
  label: string;
  avatarUrl?: string;
  isAgent: boolean;
  outlineOnly: boolean;
  opacity: number;
  rect: { top: number; left: number; width: number; height: number };
}

const HighlightItem = memo(function HighlightItem({ h }: { h: Highlight }) {
  return (
    <div
      aria-label={
        h.isAgent && h.outlineOnly ? h.label : `${h.label} edited this`
      }
      style={{
        position: "absolute",
        top: h.rect.top,
        left: h.rect.left,
        width: h.rect.width,
        height: h.rect.height,
        borderRadius: 4,
        pointerEvents: "none",
        zIndex: 9997,
        opacity: h.opacity,
        transition: "opacity 400ms ease-out",
        outline: `2px solid ${h.color}`,
        outlineOffset: 2,
        ...(h.outlineOnly
          ? {}
          : {
              backgroundColor: `${h.color}1A`,
              boxShadow: `0 0 0 1px ${h.color}33, 0 0 12px ${h.color}40`,
            }),
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -22,
          left: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          backgroundColor: h.outlineOnly ? "transparent" : h.color,
          border: h.outlineOnly ? `1px solid ${h.color}` : undefined,
          color: h.outlineOnly ? h.color : "hsl(var(--background))",
          fontSize: 10,
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: 3,
          whiteSpace: "nowrap",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {h.avatarUrl ? (
          <img
            src={h.avatarUrl}
            alt=""
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
        ) : null}
        {h.label}
      </div>
    </div>
  );
});

export function RecentEditHighlights({
  edits,
  resolveRect,
  containerRef,
  ttlMs = RECENT_EDIT_TTL_MS,
  outlineOnly = false,
  className,
}: RecentEditHighlightsProps) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const resolveRef = useRef(resolveRect);
  resolveRef.current = resolveRect;

  const recompute = () => {
    const container = containerRef.current;
    if (!container) {
      setHighlights([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const now = Date.now();
    const next: Highlight[] = [];

    for (const edit of editsRef.current) {
      const domRect = resolveRef.current(edit);
      if (!domRect) continue;

      const top = domRect.top - containerRect.top;
      const left = domRect.left - containerRect.left;
      if (
        left + domRect.width < 0 ||
        top + domRect.height < 0 ||
        left > containerRect.width ||
        top > containerRect.height
      ) {
        continue;
      }

      const age = now - edit.at;
      const fadeStart = ttlMs * 0.6;
      const opacity =
        age <= fadeStart
          ? 1
          : Math.max(0, 1 - (age - fadeStart) / (ttlMs - fadeStart));

      next.push({
        key: `${edit.clientId}:${edit.at}`,
        color: edit.user.color || "#94a3b8",
        label: edit.isAgent
          ? outlineOnly
            ? "AI editing"
            : edit.label
              ? `AI — ${edit.label}`
              : "AI edited"
          : edit.label
            ? `${edit.user.name} — ${edit.label}`
            : edit.user.name,
        avatarUrl: (edit.user as { avatarUrl?: string }).avatarUrl,
        isAgent: edit.isAgent,
        outlineOnly,
        opacity,
        rect: { top, left, width: domRect.width, height: domRect.height },
      });
    }

    setHighlights(next);
  };

  useLayoutEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, ttlMs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    container.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("scroll", recompute, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", recompute);
      window.removeEventListener("scroll", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      className={className}
    >
      {highlights.map((h) => (
        <HighlightItem key={h.key} h={h} />
      ))}
    </div>
  );
}
