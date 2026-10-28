import { useEffect, useRef, useState } from "react";

import { GeneratingDesignPreview } from "@/components/design/GeneratingDesignPreview";
import { SURFACE_PADDING } from "@/components/design/multi-screen/overview-layout";
import {
  GENERATION_DRAFT_SETTLE_MS,
  useGeneratingDesignPreview,
} from "@/hooks/use-generating-design-preview";

/**
 * The design being generated, held for one settle period after generation
 * ends. A run often ends right after the screen saves, and unmounting the
 * ghost then would cut its draft off before the saved screen takes over.
 */
export function useSettlingGenerationId(
  generatingDesignId: string | null,
  /** The design on the canvas: a hold never carries over to another one. */
  activeDesignId: string,
): string | null {
  const [heldId, setHeldId] = useState(generatingDesignId);
  if (generatingDesignId && generatingDesignId !== heldId) {
    setHeldId(generatingDesignId);
  }
  useEffect(() => {
    if (generatingDesignId || !heldId) return;
    const timer = window.setTimeout(
      () => setHeldId(null),
      GENERATION_DRAFT_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [generatingDesignId, heldId]);
  return generatingDesignId ?? (heldId === activeDesignId ? heldId : null);
}

/** The status line above the frame: 16px of text and an 8px gap. */
const LABEL_SPACE = 24;

/**
 * A screen the agent is generating onto a canvas that already has screens,
 * drawn where the new screen will land. It owns its stream subscription so
 * the canvas around it doesn't re-render as the HTML streams.
 */
export function GeneratingScreenGhost({
  designId,
  origin,
  pan,
  scale,
}: {
  designId: string;
  /** Board position where the new screen will land. */
  origin: { x: number; y: number };
  pan: { x: number; y: number };
  scale: number;
}) {
  const preview = useGeneratingDesignPreview({ designId, generating: true });
  const [settled, setSettled] = useState(false);
  const done = preview?.status === "done";
  // Once the call lands, the saved screen takes this spot and "next to the
  // others" moves past it; the settling ghost must stay put over it.
  // The call's own `canvasFrames` position wins, as it does when it saves.
  const target = preview?.position ?? origin;
  const landedOriginRef = useRef(target);
  if (!done) landedOriginRef.current = target;
  const spot = done ? landedOriginRef.current : target;

  // The saved screen lands under the ghost the moment the call finishes, but
  // the content usually arrives in one late burst: let its draft finish
  // drawing before handing the spot over.
  useEffect(() => {
    setSettled(false);
    if (!done) return;
    const timer = window.setTimeout(
      () => setSettled(true),
      GENERATION_DRAFT_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [done, preview?.html]);

  if (!preview || settled) return null;
  return (
    <div
      data-generating-screen-ghost
      className="pointer-events-none absolute z-20"
      style={{
        left: pan.x + (SURFACE_PADDING + spot.x) * scale,
        top: pan.y + (SURFACE_PADDING + spot.y) * scale - LABEL_SPACE,
      }}
    >
      <GeneratingDesignPreview preview={preview} canvasScale={scale} />
    </div>
  );
}
