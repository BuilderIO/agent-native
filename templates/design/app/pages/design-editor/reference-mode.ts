import type { ElementInfo } from "@/components/design/types";

/**
 * Same identity mirror-selection-to-agent-chat uses to decide whether a
 * selection changed. Shared here so reference-mode arming/disarming agrees
 * with the mirror effect on what counts as "the same selection" — a
 * mismatch would let a reference tag silently survive a selection change or
 * drop the instant the mirror effect re-runs for an unrelated reason.
 */
export function getSelectionIdentity(
  fileId: string | undefined,
  selectedElement: Pick<ElementInfo, "sourceId" | "selector"> | null | undefined,
): string | null {
  if (!selectedElement) return null;
  return `${fileId ?? ""}::${selectedElement.sourceId ?? selectedElement.selector}`;
}

/** Shared with mirror-selection-to-agent-chat so the composer bubble names the
 * exact same element the mirrored chat context describes. */
export function getSelectionShortLabel(args: {
  textContent?: string | null;
  layerName?: string | null;
  elementId?: string | null;
  tagName: string;
}): string {
  const labelSource =
    args.textContent?.trim() ||
    args.layerName ||
    args.elementId ||
    args.tagName.toLowerCase();
  return labelSource.length > 28
    ? `${labelSource.slice(0, 25)}...`
    : labelSource;
}

/**
 * Deliberately narrow: only phrases that name the selection as a model to
 * copy, not ordinary edit requests that happen to contain "this" (e.g.
 * "make this bigger"). A false positive silently overrides the user's
 * selected element with reference framing they never asked for; a false
 * negative just leaves the explicit "Use as reference" action as the way in.
 */
const REFERENCE_INTENT_PATTERN =
  /\b(?:(?:make|design|build|create|generate)\s+(?:something|this|it)\s+(?:like|similar to)\s+this|similar to this(?:\s+one)?|like this one|based on this|in (?:this|that) style|match(?:ing)?\s+this(?:\s+(?:style|design|layout))?|model(?:ed)?\s+after\s+this|mimic\s+this|copy\s+this(?:\s+(?:style|layout|design))?|reuse\s+this(?:\s+(?:style|layout|design))?|use\s+(?:it|this)\s+as\s+(?:a\s+|the\s+)?reference|as\s+a\s+reference|use\s+as\s+reference|reference\s+(?:this|it)|recreate\s+this|reproduce\s+this(?:\s+(?:design|layout|style))?)\b/i;

export function promptSignalsReferenceIntent(text: string): boolean {
  return REFERENCE_INTENT_PATTERN.test(text.trim());
}

/**
 * True exactly on the rising edge of reference mode for the CURRENT
 * selection — i.e. the moment reference framing must be (re)published even
 * though the selection identity itself hasn't changed. Without this, mirror
 * effect's own "same selection, nothing to do" guard (there to avoid a
 * republish feedback loop while an agent run polls get-design) would also
 * swallow the transition from plain to reference framing.
 */
export function referenceModeJustArmedForSelection(args: {
  referenceActive: boolean;
  previousReferenceActive: boolean;
  selectionId: string | null;
  previousSelectionId: string | null;
}): boolean {
  return (
    args.referenceActive &&
    !args.previousReferenceActive &&
    args.selectionId !== null &&
    args.selectionId === args.previousSelectionId
  );
}
