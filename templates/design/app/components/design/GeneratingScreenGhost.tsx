import { useQueryClient } from "@tanstack/react-query";
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

/** The status line above the frame: 16px of text and an 8px gap, in canvas units. */
const LABEL_SPACE = 24;

/**
 * A screen the agent is generating onto a canvas that already has screens,
 * drawn where the new screen will land. It owns its stream subscription so
 * the canvas around it doesn't re-render as the HTML streams.
 */
export function GeneratingScreenGhost({
  designId,
  origin,
  showPendingSkeleton,
}: {
  designId: string;
  /** Board position where the new screen will land. */
  origin: { x: number; y: number };
  /** Hold a skeleton at the origin until the first call streams. */
  showPendingSkeleton: boolean;
}) {
  const queryClient = useQueryClient();
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

  // The saved screen lands under the ghost the moment the call finishes: let
  // the last streamed content finish drafting before handing the spot over.
  useEffect(() => {
    setSettled(false);
    if (!done) return;
    const queryKey = ["action", "get-design", { id: designId }];
    let cancelled = false;
    void queryClient.refetchQueries({ queryKey });
    const timer = window.setTimeout(() => {
      // A failed refetch keeps the ghost: hiding it would leave an empty canvas.
      queryClient
        .refetchQueries({ queryKey }, { throwOnError: true })
        .then(() => {
          if (!cancelled) setSettled(true);
        })
        .catch(() => {});
    }, GENERATION_DRAFT_SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [done, preview?.html, designId, queryClient]);

  if ((!preview && !showPendingSkeleton) || settled) return null;
  return (
    <div
      data-generating-screen-ghost
      className="pointer-events-none absolute z-20 [&_.an-generating-label]:inline-block [&_.an-generating-label]:self-start [&_.an-generating-label]:origin-bottom-left [&_.an-generating-label]:[transform:scale(var(--an-chrome-scale,1))]"
      style={{
        left: SURFACE_PADDING + spot.x,
        top: SURFACE_PADDING + spot.y - LABEL_SPACE,
      }}
    >
      <GeneratingDesignPreview preview={preview} canvasScale={1} />
    </div>
  );
}
