
import {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  memo,
  type RefObject,
} from "react";

import type { OtherPresence } from "./types.js";

export type SelectionDescriptor = string | { selector: string; label?: string };

export interface RemoteSelectionRingsProps {
  others: OtherPresence[];
  selectionKey?: string;
  resolveRect: (descriptor: string) => DOMRect | null;
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
}

interface Ring {
  clientId: number;
  color: string;
  label: string;
  avatarUrl?: string;
  isAgent: boolean;
  rect: { top: number; left: number; width: number; height: number };
}

const RingItem = memo(function RingItem({ ring }: { ring: Ring }) {
  return (
    <div
      aria-label={`${ring.label} selection`}
      style={{
        position: "absolute",
        top: ring.rect.top,
        left: ring.rect.left,
        width: ring.rect.width,
        height: ring.rect.height,
        outline: `2px solid ${ring.color}`,
        outlineOffset: 2,
        borderRadius: 3,
        pointerEvents: "none",
        boxShadow: `0 0 0 1px ${ring.color}40`,
        zIndex: 9998,
      }}
    >
      {/* Name tag in top-left corner of the ring */}
      <div
        style={{
          position: "absolute",
          top: -20,
          left: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          backgroundColor: ring.color,
          color: "#fff",
          fontSize: 10,
          fontWeight: 600,
          padding: "1px 5px",
          borderRadius: 3,
          whiteSpace: "nowrap",
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {ring.avatarUrl ? (
          <img
            src={ring.avatarUrl}
            alt=""
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
        ) : null}
        {ring.label}
      </div>
    </div>
  );
});

export function RemoteSelectionRings({
  others,
  selectionKey = "selection",
  resolveRect,
  containerRef,
  className,
}: RemoteSelectionRingsProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<Ring[]>([]);

  const recompute = () => {
    const container = containerRef.current;
    if (!container) {
      setRings([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const next: Ring[] = [];

    for (const other of others) {
      const raw = other.presence[selectionKey] as
        | SelectionDescriptor
        | null
        | undefined;
      const selector =
        typeof raw === "string" ? raw : raw ? raw.selector : undefined;
      if (!selector || typeof selector !== "string") continue;
      const selectionLabel =
        raw && typeof raw === "object" ? raw.label : undefined;

      const domRect = resolveRect(selector);
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

      const baseName = other.isAgent
        ? "AI"
        : other.user.name || other.user.email;
      next.push({
        clientId: other.clientId,
        color: other.user.color || "#94a3b8",
        label: selectionLabel ? `${baseName} — ${selectionLabel}` : baseName,
        avatarUrl: (other.user as { avatarUrl?: string }).avatarUrl,
        isAgent: other.isAgent,
        rect: { top, left, width: domRect.width, height: domRect.height },
      });
    }

    setRings(next);
  };

  useLayoutEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others, selectionKey]);

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
      {rings.map((ring) => (
        <RingItem key={ring.clientId} ring={ring} />
      ))}
    </div>
  );
}
