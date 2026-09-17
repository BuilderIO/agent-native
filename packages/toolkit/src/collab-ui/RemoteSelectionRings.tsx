/**
 * RemoteSelectionRings — renders colored outline rings + name tags over
 * elements selected by remote participants.
 *
 * Each participant's presence payload may contain a `selection` key with an
 * opaque descriptor (e.g. a CSS selector). The `resolveRect` callback maps
 * a descriptor to a DOMRect (or null when the element isn't found). Rings
 * are rendered as absolutely-positioned outlines anchored to the container.
 *
 * Usage:
 *   <div style={{ position: "relative" }}>
 *     {content}
 *     <RemoteSelectionRings
 *       others={others}
 *       resolveRect={(selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null}
 *       containerRef={containerRef}
 *     />
 *   </div>
 */

import {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  memo,
  type RefObject,
} from "react";

import type { OtherPresence } from "./types.js";

/**
 * Selection descriptors may be a plain string (treated as the resolver
 * input) or an object carrying a resolver input plus a human label
 * ("Editing hero section").
 */
export type SelectionDescriptor = string | { selector: string; label?: string };

export interface RemoteSelectionRingsProps {
  /** Remote participants. */
  others: OtherPresence[];
  /**
   * Key inside presence payload that carries the selection descriptor.
   * Default: "selection"
   */
  selectionKey?: string;
  /**
   * Resolver: maps a selection descriptor to a DOMRect relative to the
   * viewport. Return null when the element is not found.
   */
  resolveRect: (descriptor: string) => DOMRect | null;
  /**
   * Container element ref. Rings are positioned relative to this element's
   * bounding box.
   */
  containerRef: RefObject<HTMLElement | null>;
  /** Additional CSS class for the overlay div. */
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

  // Recompute rings whenever others change or on animation frame.
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

      // Convert viewport-relative rect to container-relative.
      const top = domRect.top - containerRect.top;
      const left = domRect.left - containerRect.left;
      if (
        left + domRect.width < 0 ||
        top + domRect.height < 0 ||
        left > containerRect.width ||
        top > containerRect.height
      ) {
        continue; // Out of container bounds — skip.
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

  // Recompute on scroll/resize of the container to keep rings in sync.
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
