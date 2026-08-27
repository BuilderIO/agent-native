import { useCallback, useEffect, useState } from "react";

import type { ElementInfo } from "@/components/design/types";
import {
  getSelectionIdentity,
  promptSignalsReferenceIntent,
} from "@/pages/design-editor/reference-mode";

export interface UseReferenceModeArgs {
  activeFileId: string | undefined;
  selectedElement: ElementInfo | null;
}

export interface UseReferenceModeResult {
  /** True while the CURRENT selection is tagged as a reference for the next generation turn. */
  referenceActive: boolean;
  /** True while there is a selection that could be tagged. */
  referenceEligible: boolean;
  /** Explicit UI action: tag the current selection as a reference. */
  armReference: () => void;
  /** Clear the tag without waiting for it to be consumed by a send. */
  disarmReference: () => void;
  /** Feed live composer text so a reference-intent phrase arms the tag automatically. */
  onComposerTextChange: (text: string) => void;
}

/**
 * Pasting alone never arms this — nothing here fires on paste. It only arms
 * once the user both has content selected AND signals intent to model after
 * it, via typed phrasing or the explicit "Use as reference" action. See the
 * `reference-mode` module for the identity/intent rules this wraps.
 */
export function useReferenceMode({
  activeFileId,
  selectedElement,
}: UseReferenceModeArgs): UseReferenceModeResult {
  const [armedSelectionId, setArmedSelectionId] = useState<string | null>(
    null,
  );
  const currentSelectionId = getSelectionIdentity(
    activeFileId,
    selectedElement,
  );

  // A reference tag is scoped to the exact selection it was armed on — moving
  // to a different element (or losing selection entirely) must drop it rather
  // than silently carry it forward onto whatever is selected next.
  useEffect(() => {
    if (armedSelectionId && armedSelectionId !== currentSelectionId) {
      setArmedSelectionId(null);
    }
  }, [armedSelectionId, currentSelectionId]);

  const armReference = useCallback(() => {
    if (currentSelectionId) setArmedSelectionId(currentSelectionId);
  }, [currentSelectionId]);

  const disarmReference = useCallback(() => setArmedSelectionId(null), []);

  const onComposerTextChange = useCallback(
    (text: string) => {
      if (currentSelectionId && promptSignalsReferenceIntent(text)) {
        setArmedSelectionId(currentSelectionId);
      }
    },
    [currentSelectionId],
  );

  return {
    referenceActive:
      armedSelectionId !== null && armedSelectionId === currentSelectionId,
    referenceEligible: currentSelectionId !== null,
    armReference,
    disarmReference,
    onComposerTextChange,
  };
}
