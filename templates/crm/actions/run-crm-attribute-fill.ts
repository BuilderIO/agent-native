import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CrmAttributeValueError,
  normalizeCrmAttributeValue,
  writeCrmRecordField,
  type CrmWritableAttribute,
} from "../server/lib/record-fields.js";
import { ATTRIBUTE_TYPE_SPECS } from "../shared/crm-attributes.js";
import { requireCrmScope, toJson } from "./_crm-action-utils.js";
import {
  legacyValueTypeFor,
  loadAttributeOptions,
  requireEditableAttribute,
  type CrmAttributeRow,
} from "./_crm-attribute-utils.js";

const MAX_RECORDS = 100;
const MAX_CONTEXT_ATTRIBUTES = 12;
const MAX_CONTEXT_CHARS = 200;
const MAX_PROVENANCE_CHARS = 4000;

/** Fill modes this action executes. `formula` is computed, not reasoned. */
const AGENT_FILL_MODES = [
  "agent-summarize",
  "agent-classify",
  "agent-research",
] as const;

const valueInput = z.object({
  recordId: z.string().trim().min(1).max(128),
  value: z.unknown().describe("The value to write, typed for this attribute."),
  source: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "Where the value came from, e.g. the page title or 'call notes'.",
    ),
  sourceUrl: z.string().trim().max(2000).optional(),
  reasoning: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe("Why this value, in one or two sentences. Shown in the cell."),
  confidence: z.number().min(0).max(1).optional(),
});

export default defineAction({
  description:
    "Fill an agent-filled CRM attribute for a bounded set of records. MANUAL TRIGGER ONLY — nothing schedules or auto-runs this, by design. Call it with no `values` to get the brief: the attribute, its managed options, and each record's current value and context. Reason over that brief yourself, then call it again with `values` to write. Every written value carries its source, reasoning, and confidence as provenance and is stamped actorType=agent, so the grid can show the user WHY a cell says what it says. Writes MERGE: a value a human edited, or a value bought by a paid enrichment run, is kept and reported as kept-existing; an unchanged value is not rewritten at all. Classifying against a status or select attribute must produce one of its managed options — an unknown option is rejected for the whole call and nothing is written.",
  schema: z.object({
    attributeId: z.string().trim().min(1).max(128),
    recordIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(MAX_RECORDS),
    values: z
      .array(valueInput)
      .max(MAX_RECORDS)
      .optional()
      .describe("Omit to receive the brief; supply to write the results."),
  }),
  audit: {
    summary: (args, result) => {
      const outcome = result as { mode: string; written?: number };
      return outcome.mode === "apply"
        ? `Agent-filled CRM attribute ${args.attributeId} on ${outcome.written ?? 0} of ${args.recordIds.length} records`
        : `Prepared agent fill for CRM attribute ${args.attributeId} across ${args.recordIds.length} records`;
    },
  },
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    const attributeRow = await requireEditableAttribute(args.attributeId);
    const attribute = requireAgentFillable(attributeRow);
    const spec = ATTRIBUTE_TYPE_SPECS[attributeRow.attributeType];

    const options = (
      await loadAttributeOptions({
        attributeIds: [attributeRow.id],
        includeArchived: false,
      })
    ).get(attributeRow.id);
    const allowedOptions = (options ?? []).map((option) => ({
      value: option.value,
      title: option.title,
    }));

    const records = await loadRecords(args.recordIds);
    const current = await loadCurrentValues(args.recordIds, attribute.apiSlug);

    if (!args.values) {
      const context = await loadRecordContext(args.recordIds);
      return {
        mode: "prepare" as const,
        attribute: {
          id: attributeRow.id,
          apiSlug: attribute.apiSlug,
          label: attributeRow.label,
          description: attributeRow.description,
          attributeType: attributeRow.attributeType,
          multi: attributeRow.multi,
          fillMode: attributeRow.fillMode,
          fillConfigJson: attributeRow.fillConfigJson,
          allowedOptions,
        },
        records: args.recordIds.map((recordId) => {
          const record = records.get(recordId)!;
          const existing = current.get(recordId);
          return {
            recordId,
            displayName: record.displayName,
            domain: record.domain,
            objectType: record.objectType,
            currentValue: existing ? readStoredValue(existing) : null,
            // A protected cell is reported up front so the caller does not
            // spend reasoning on a value that will be kept anyway.
            protectedBy: existing ? protectedBy(existing) : null,
            context: context.get(recordId) ?? {},
          };
        }),
        next: "Reason over these records, then call run-crm-attribute-fill again with the same attributeId and a values array.",
      };
    }

    const supplied = new Map(
      args.values.map((entry) => [entry.recordId, entry]),
    );
    const unknownTarget = args.values.find(
      (entry) => !args.recordIds.includes(entry.recordId),
    );
    if (unknownTarget) {
      throw new CrmAttributeValueError(
        "crm-attribute-fill-unknown-record",
        `Record ${unknownTarget.recordId} is not in this fill's recordIds. Only records the fill was prepared for may be written.`,
      );
    }

    // Validate EVERY value before writing ANY. A batch that writes three cells
    // and then rejects the fourth leaves the user with a partly-filled column
    // and no way to tell which half the agent stands behind.
    const knownOptionValues = new Set(
      allowedOptions.map((option) => option.value),
    );
    for (const entry of args.values) {
      normalizeCrmAttributeValue(attribute, entry.value as never);
      if (!spec.usesOptions) continue;
      for (const value of optionValuesOf(entry.value)) {
        if (!knownOptionValues.has(value)) {
          throw new CrmAttributeValueError(
            "crm-unknown-option",
            `"${value}" is not an option of ${attribute.apiSlug}. Known options: ${
              allowedOptions.map((option) => option.value).join(", ") ||
              "(none defined)"
            }. Add the option first — a fill never creates one.`,
          );
        }
      }
    }

    const now = new Date().toISOString();
    const results: Array<{
      recordId: string;
      outcome: "written" | "unchanged" | "kept-existing" | "no-value";
      keptBecause?: string;
    }> = [];

    for (const recordId of args.recordIds) {
      const entry = supplied.get(recordId);
      if (!entry) {
        results.push({ recordId, outcome: "no-value" });
        continue;
      }
      const existing = current.get(recordId);
      const kept = existing ? protectedBy(existing) : null;
      if (kept) {
        results.push({ recordId, outcome: "kept-existing", keptBecause: kept });
        continue;
      }

      const write = await writeCrmRecordField({
        target: { recordId },
        attribute,
        value: entry.value as never,
        actor: { type: "agent", id: ctx?.userEmail ?? ownership.ownerEmail },
        ownership,
        provenanceJson: toJson(
          [
            {
              fieldName: attribute.apiSlug,
              // The grid renders this as the cell's "source" line.
              provider: entry.source ?? `fill:${attributeRow.fillMode}`,
              ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
              ...(entry.reasoning ? { reasoning: entry.reasoning } : {}),
              ...(entry.confidence === undefined
                ? {}
                : { confidence: entry.confidence }),
              observedAt: now,
              fillMode: attributeRow.fillMode,
            },
          ],
          MAX_PROVENANCE_CHARS,
        ),
        now,
      });
      results.push({
        recordId,
        outcome: write.changed ? "written" : "unchanged",
      });
    }

    return {
      mode: "apply" as const,
      attributeId: attributeRow.id,
      apiSlug: attribute.apiSlug,
      written: results.filter((row) => row.outcome === "written").length,
      unchanged: results.filter((row) => row.outcome === "unchanged").length,
      keptExisting: results.filter((row) => row.outcome === "kept-existing")
        .length,
      noValue: results.filter((row) => row.outcome === "no-value").length,
      results,
    };
  },
});

/**
 * The attribute as something this action may write, or a typed 422 explaining
 * why not. A misconfigured attribute fails here rather than filling a column the
 * next provider sync will overwrite.
 */
function requireAgentFillable(row: CrmAttributeRow): CrmWritableAttribute {
  if (!row.fillMode) {
    throw new CrmAttributeValueError(
      "crm-attribute-not-fillable",
      `Attribute ${row.id} has no fill mode. Set one of ${AGENT_FILL_MODES.join(", ")} on the attribute first.`,
    );
  }
  if (!(AGENT_FILL_MODES as readonly string[]).includes(row.fillMode)) {
    throw new CrmAttributeValueError(
      "crm-attribute-fill-mode-unsupported",
      `Attribute ${row.id} has fill mode "${row.fillMode}", which is computed rather than reasoned. This action runs ${AGENT_FILL_MODES.join(", ")} only.`,
    );
  }
  if (row.archived) {
    throw new CrmAttributeValueError(
      "crm-attribute-archived",
      `Attribute ${row.id} is archived. Restore it before filling it.`,
    );
  }
  if (row.authority === "provider") {
    throw new CrmAttributeValueError(
      "crm-attribute-provider-authority",
      `Attribute ${row.id} is provider-authoritative, so the next sync would overwrite anything written here. Change its authority to derived-local or local-authoritative first.`,
    );
  }
  if (
    row.storagePolicy !== "mirrored" &&
    row.storagePolicy !== "derived-local" &&
    row.storagePolicy !== "local-authoritative"
  ) {
    throw new CrmAttributeValueError(
      "crm-attribute-not-stored-locally",
      `Attribute ${row.id} has storage policy "${row.storagePolicy}" and holds no local value to fill.`,
    );
  }
  if (
    row.fillMode === "agent-classify" &&
    !ATTRIBUTE_TYPE_SPECS[row.attributeType].usesOptions
  ) {
    throw new CrmAttributeValueError(
      "crm-attribute-classify-without-options",
      `Attribute ${row.id} is a ${row.attributeType}, which has no managed options to classify into. Use agent-summarize or agent-research instead.`,
    );
  }
  return {
    id: row.id,
    apiSlug: row.apiSlug ?? row.fieldName,
    attributeType: row.attributeType,
    multi: row.multi,
    historyTracked: row.historyTracked,
    valueType: legacyValueTypeFor(row.attributeType, row.multi),
    storagePolicy: row.storagePolicy,
    fieldPolicyId: row.id,
  };
}

export type CurrentFieldRow = {
  recordId: string;
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
  actorType: string;
  provenanceJson: string;
};

/**
 * Why an existing value outranks a fill, or null when the fill may proceed.
 *
 * A human edit and a value someone paid a provider for are the two things a
 * later automated fill must never quietly replace. The paid enrichment ingest
 * shares this rule — it honours `human-edit` and overwrites its own earlier
 * `paid-enrichment` values, which is why the decision lives in one function.
 */
export function protectedBy(row: CurrentFieldRow): string | null {
  if (row.actorType === "user") return "human-edit";
  if (isPaidProvenance(row.provenanceJson)) return "paid-enrichment";
  return null;
}

function isPaidProvenance(provenanceJson: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(provenanceJson);
  } catch {
    // An unreadable provenance blob is not proof the value was free. Treat it
    // as protected: keeping a value we cannot explain beats overwriting one.
    return true;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).paid === true,
  );
}

function readStoredValue(row: CurrentFieldRow): unknown {
  if (row.jsonValue !== null) {
    try {
      return JSON.parse(row.jsonValue) as unknown;
    } catch {
      return row.jsonValue;
    }
  }
  if (row.stringValue !== null) return row.stringValue;
  if (row.numberValue !== null) return row.numberValue;
  if (row.booleanValue !== null) return row.booleanValue;
  return null;
}

function optionValuesOf(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((entry): entry is string => typeof entry === "string");
}

async function loadRecords(recordIds: string[]) {
  const rows = await getDb()
    .select({
      id: schema.crmRecords.id,
      displayName: schema.crmRecords.displayName,
      domain: schema.crmRecords.domain,
      objectType: schema.crmRecords.objectType,
    })
    .from(schema.crmRecords)
    .where(
      and(
        inArray(schema.crmRecords.id, recordIds),
        accessFilter(
          schema.crmRecords,
          schema.crmRecordShares,
          undefined,
          "editor",
        ),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = recordIds.filter((recordId) => !byId.has(recordId));
  if (missing.length > 0) {
    throw new CrmAttributeValueError(
      "crm-record-not-writable",
      `These CRM records were not found or are not editable by you: ${missing.join(", ")}.`,
    );
  }
  return byId;
}

async function loadCurrentValues(recordIds: string[], apiSlug: string) {
  const rows = await getDb()
    .select({
      recordId: schema.crmRecordFields.recordId,
      stringValue: schema.crmRecordFields.stringValue,
      numberValue: schema.crmRecordFields.numberValue,
      booleanValue: schema.crmRecordFields.booleanValue,
      jsonValue: schema.crmRecordFields.jsonValue,
      actorType: schema.crmRecordFields.actorType,
      provenanceJson: schema.crmRecordFields.provenanceJson,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        inArray(schema.crmRecordFields.recordId, recordIds),
        eq(schema.crmRecordFields.fieldName, apiSlug),
        isNull(schema.crmRecordFields.entryId),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );
  return new Map(rows.map((row) => [row.recordId, row]));
}

/** A bounded slice of each record's other current values, for the brief. */
async function loadRecordContext(recordIds: string[]) {
  const rows = await getDb()
    .select({
      recordId: schema.crmRecordFields.recordId,
      fieldName: schema.crmRecordFields.fieldName,
      stringValue: schema.crmRecordFields.stringValue,
      numberValue: schema.crmRecordFields.numberValue,
      booleanValue: schema.crmRecordFields.booleanValue,
      jsonValue: schema.crmRecordFields.jsonValue,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        inArray(schema.crmRecordFields.recordId, recordIds),
        isNull(schema.crmRecordFields.entryId),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );
  const byRecord = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const bucket = byRecord.get(row.recordId) ?? {};
    if (Object.keys(bucket).length >= MAX_CONTEXT_ATTRIBUTES) continue;
    const value =
      row.jsonValue ??
      row.stringValue ??
      (row.numberValue !== null ? String(row.numberValue) : null) ??
      (row.booleanValue !== null ? String(row.booleanValue) : null);
    if (value === null) continue;
    bucket[row.fieldName] = value.slice(0, MAX_CONTEXT_CHARS);
    byRecord.set(row.recordId, bucket);
  }
  return byRecord;
}
