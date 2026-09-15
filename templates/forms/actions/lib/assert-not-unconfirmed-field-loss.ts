/**
 * Guards the one `update-form` call shape that silently destroys a form: a
 * whole-array `fields` replacement that discards most of what the form already
 * asked.
 *
 * The routing mistake this backstops is not hypothetical. `<current-screen>`
 * names exactly one open form on every turn, so after the agent creates a
 * draft, an unrelated "build me an X form" prompt in the same chat reads as an
 * edit to that draft, and `update-form` replaces its schema in place. The
 * previous questions are then unrecoverable — forms keep no revision history.
 *
 * Detection is structural on purpose: intent lives in the prompt, but "this
 * call drops most of the existing questions" is visible right here, at the only
 * boundary that can still refuse.
 */
import { fail } from "@agent-native/core/action";

import type { FormField } from "../../shared/types.js";

/** Below this, there is not enough of a form to meaningfully lose. */
const MIN_EXISTING_FIELDS = 2;
/** Dropping one field is an edit; dropping several is a rewrite. */
const MIN_DROPPED_FIELDS = 2;
const MIN_DROPPED_RATIO = 0.5;

function normalizeLabel(label: unknown): string {
  return typeof label === "string" ? label.trim().toLowerCase() : "";
}

export interface FieldLossReport {
  existingCount: number;
  droppedCount: number;
  droppedLabels: string[];
  retainedCount: number;
}

/**
 * Returns a report when `incoming` discards most of `existing`, otherwise null.
 *
 * A field counts as retained when the incoming array carries its id OR its
 * label: ids are auto-generated from labels, so a re-worded id for the same
 * question must not read as a deletion.
 */
export function detectMassFieldLoss(
  existing: FormField[],
  incoming: FormField[],
): FieldLossReport | null {
  if (existing.length < MIN_EXISTING_FIELDS) return null;

  const incomingIds = new Set(incoming.map((field) => field.id));
  const incomingLabels = new Set(
    incoming.map((field) => normalizeLabel(field.label)).filter(Boolean),
  );

  const dropped = existing.filter((field) => {
    if (incomingIds.has(field.id)) return false;
    const label = normalizeLabel(field.label);
    return !(label && incomingLabels.has(label));
  });

  if (dropped.length < MIN_DROPPED_FIELDS) return null;
  if (dropped.length / existing.length < MIN_DROPPED_RATIO) return null;

  return {
    existingCount: existing.length,
    droppedCount: dropped.length,
    droppedLabels: dropped.map((field) => field.label || field.id),
    retainedCount: existing.length - dropped.length,
  };
}

/**
 * Fails the update unless the caller explicitly acknowledged the loss.
 *
 * The message leads with `create-form` because that is the correct recovery for
 * the common case (a new, unrelated form request), and names the confirmation
 * flag second for the genuine "rewrite this form" case.
 */
export function assertNotUnconfirmedFieldLoss(options: {
  existing: FormField[];
  incoming: FormField[];
  confirmed: boolean;
  existingTitle: string;
  incomingTitle?: string;
}): void {
  if (options.confirmed) return;

  const report = detectMassFieldLoss(options.existing, options.incoming);
  if (!report) return;

  const renamed =
    options.incomingTitle !== undefined &&
    options.incomingTitle.trim() !== options.existingTitle.trim();
  const renameClause = renamed
    ? ` and renames it to "${options.incomingTitle}"`
    : "";

  fail(
    `This update discards ${report.droppedCount} of the ${report.existingCount} questions on "${options.existingTitle}"${renameClause}: ${report.droppedLabels.join(", ")}. ` +
      `If the user asked for a different form, call create-form instead — an open form in <current-screen> is not the target for a new form request. ` +
      `If the user asked to remove specific questions, use patch-form-fields. ` +
      `Only if the user explicitly asked to rewrite this form in place, retry this call with confirmReplaceFields: true.`,
    {
      errorCode: "unconfirmed_field_loss",
      statusCode: 409,
    },
  );
}
