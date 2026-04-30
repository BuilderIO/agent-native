import { createPortal } from "react-dom";
import { IconX, IconArrowRight } from "@tabler/icons-react";

interface MultiSelectChipProps {
  /** Number of currently-selected elements */
  count: number;
  /**
   * Anchor rect (the canvas / slide) used to position the chip top-center.
   * If null, the chip renders centered near the top of the viewport.
   */
  anchorRect: DOMRect | null;
  /** Clear the entire selection (X button + Escape) */
  onClear: () => void;
  /** Send the selection list to the agent chat composer (prefill, no submit) */
  onSendToAgent: () => void;
}

/**
 * Floating chip that hovers above a multi-select selection (Figma-style).
 * Rendered via portal so it isn't constrained by the slide canvas's stacking
 * context. Reusable across the slides editor and the design template.
 */
export function MultiSelectChip({
  count,
  anchorRect,
  onClear,
  onSendToAgent,
}: MultiSelectChipProps) {
  if (count === 0) return null;

  // Position the chip top-center relative to the anchor (the slide canvas).
  // Falls back to a fixed top-center placement when no anchor is provided.
  const top = anchorRect ? anchorRect.top + 12 : 16;
  const left = anchorRect
    ? anchorRect.left + anchorRect.width / 2
    : window.innerWidth / 2;

  return createPortal(
    <div
      data-multi-select-chip
      style={{
        position: "fixed",
        top,
        left,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 12px",
        background: "rgba(20, 20, 20, 0.95)",
        color: "#fff",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 999,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
        fontSize: 13,
        fontWeight: 500,
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <span style={{ color: "#609FF8" }}>{count}</span>
      <span style={{ color: "rgba(255,255,255,0.85)" }}>selected</span>
      <button
        type="button"
        onClick={onSendToAgent}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 10px",
          marginLeft: 4,
          background: "#609FF8",
          color: "#000",
          border: "none",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Send to agent
        <IconArrowRight size={12} stroke={3} />
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          background: "transparent",
          color: "rgba(255,255,255,0.7)",
          border: "none",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        <IconX size={14} stroke={2.5} />
      </button>
    </div>,
    document.body,
  );
}
