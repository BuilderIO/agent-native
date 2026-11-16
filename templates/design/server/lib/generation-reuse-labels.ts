/**
 * Which reuse labels a Design generation or edit can record.
 *
 * A label records which Creative Context item version influenced an element, so
 * it needs both ids. Models also tag material the library never held, such as
 * photos the user attached, and tag labels while Creative Context is off. The
 * input schema and the shared validator each refused the whole save for that,
 * so the model wrote the entire design again. A label that cannot be recorded
 * is dropped instead and named in the result, so the save lands and the caller
 * can still see what was left out.
 */

import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";

export type IgnoredReuseLabelReason =
  | "missing-item-ids"
  | "partial-item-ids"
  | "context-off";

export interface IgnoredReuseLabel {
  kind: string;
  label: string;
  reason: IgnoredReuseLabelReason;
}

/** The fields the rules read; a parsed action input carries more. */
interface ReuseLabelFields {
  itemId?: string | undefined;
  itemVersionId?: string | undefined;
  kind: string;
  label: string;
  influence?: CreativeContextReuseLabel["influence"] | undefined;
}

export function partitionReuseLabels<T extends ReuseLabelFields>(
  labels: readonly T[],
  options: { contextOff: boolean },
): { recordable: T[]; ignored: IgnoredReuseLabel[] } {
  const recordable: T[] = [];
  const ignored: IgnoredReuseLabel[] = [];
  for (const label of labels) {
    const reason = unrecordableReason(label, options.contextOff);
    if (reason) ignored.push({ kind: label.kind, label: label.label, reason });
    else recordable.push(label);
  }
  return { recordable, ignored };
}

function unrecordableReason(
  label: ReuseLabelFields,
  contextOff: boolean,
): IgnoredReuseLabelReason | null {
  const hasItemId = Boolean(label.itemId);
  if (hasItemId !== Boolean(label.itemVersionId)) return "partial-item-ids";
  if ((label.influence ?? "reference-conditioned") === "generated") return null;
  if (!hasItemId) return "missing-item-ids";
  return contextOff ? "context-off" : null;
}
