import { fail } from "@agent-native/core/action";

import type { FormField } from "../../shared/types.js";

const MIN_EXISTING_FIELDS = 2;
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

  const incomingLabelById = new Map(
    incoming.map((field) => [field.id, normalizeLabel(field.label)]),
  );

  const availableLabels = new Map<string, number>();
  for (const label of incomingLabelById.values()) {
    if (label)
      availableLabels.set(label, (availableLabels.get(label) ?? 0) + 1);
  }

  function consumeLabel(label: string): boolean {
    const remaining = availableLabels.get(label) ?? 0;
    if (remaining <= 0) return false;
    availableLabels.set(label, remaining - 1);
    return true;
  }

  for (const field of existing) {
    const matchedLabel = incomingLabelById.get(field.id);
    if (matchedLabel) consumeLabel(matchedLabel);
  }

  const dropped = existing.filter((field) => {
    if (incomingLabelById.has(field.id)) return false;
    const label = normalizeLabel(field.label);
    return !(label && consumeLabel(label));
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
