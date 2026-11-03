import { z } from "zod";

import type { triageItems } from "../db/schema.js";

type ItemRow = typeof triageItems.$inferSelect;

/**
 * What a workflow's inbox source adds to a poller's input. A caller that
 * passes none of them gets the poll it always got: the factory-wide cursor,
 * rows written, audit recorded.
 */
export const pollStartFields = {
  after: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Workflow engine only. The position this workflow's source saved: read only what came after it, and leave the factory-wide cursor alone.",
    ),
  prime: z
    .boolean()
    .optional()
    .describe(
      "Workflow engine only. Read the newest position and nothing else: no row is stored and no cursor moves.",
    ),
  preview: z
    .boolean()
    .optional()
    .describe(
      "Workflow engine only. Read as a poll would but store nothing (no rows, no cursor, no audit), and return the rows it would have stored as previewRows.",
    ),
};

export function assertPollStart(input: {
  after?: string | undefined;
  prime?: boolean | undefined;
}): void {
  if (input.after !== undefined && input.prime === true) {
    throw new Error(
      "Pass either after (go on from a saved position) or prime (take the newest one), not both.",
    );
  }
}

/** Every column `rowToNormalizedItem` reads, as the poller would have stored it. */
export const previewRowSchema = z.object({
  id: z.string(),
  source: z.string(),
  externalId: z.string(),
  sourceUrl: z.string().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  status: z.string(),
  risk: z.string(),
  confidence: z.string(),
  channelId: z.string().nullable(),
  threadTs: z.string().nullable(),
  repository: z.string().nullable(),
  pullRequestNumber: z.number().int().nullable(),
  headSha: z.string().nullable(),
  coverage: z.string(),
  dedupeKey: z.string(),
  metadataJson: z.string(),
  payloadJson: z.string(),
  textRef: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ownerEmail: z.string(),
  orgId: z.string().nullable(),
  factoryId: z.string().nullable(),
}) satisfies z.ZodType<ItemRow>;

/** The row a poller would insert, with the columns it leaves to the database filled the way the database would. */
export function previewRowOf(
  values: Partial<ItemRow> &
    Pick<
      ItemRow,
      "id" | "source" | "externalId" | "title" | "dedupeKey" | "ownerEmail"
    >,
): ItemRow {
  const now = new Date().toISOString();
  return {
    sourceUrl: null,
    summary: null,
    status: "received",
    risk: "unknown",
    confidence: "unknown",
    channelId: null,
    threadTs: null,
    repository: null,
    pullRequestNumber: null,
    headSha: null,
    coverage: "unknown",
    metadataJson: "{}",
    payloadJson: "{}",
    textRef: null,
    lastSeenAt: null,
    createdAt: now,
    updatedAt: now,
    orgId: null,
    factoryId: null,
    ...values,
  };
}

/** A body long enough to be cut by the item bound anyway (2 KB); longer text only grows the action's answer. */
const PREVIEW_TEXT_CHARS = 2_100;
/** The action's answer is cut by the agent loop at 50,000 characters; a cut answer is not JSON. */
const PREVIEW_BUDGET_CHARS = 40_000;

function clampStrings(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // coercion-ok: a preview row's metadata is built by the poller in this process; unreadable text is passed on as is for the host to refuse
    return json;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return json;
  }
  const clamped = Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      typeof value === "string" && value.length > PREVIEW_TEXT_CHARS
        ? value.slice(0, PREVIEW_TEXT_CHARS)
        : value,
    ]),
  );
  return JSON.stringify(clamped);
}

/**
 * The rows a preview hands back, cut to what one action answer can hold. The
 * rows are samples, so a long body is cut where the item bound would cut it,
 * and `total` says how many rows there were, so a short list never reads as
 * everything.
 */
export function boundPreviewRows(rows: readonly ItemRow[]): {
  rows: ItemRow[];
  total: number;
} {
  const kept: ItemRow[] = [];
  let used = 0;
  for (const row of rows) {
    const bounded: ItemRow = {
      ...row,
      summary:
        row.summary !== null && row.summary.length > PREVIEW_TEXT_CHARS
          ? row.summary.slice(0, PREVIEW_TEXT_CHARS)
          : row.summary,
      metadataJson: clampStrings(row.metadataJson),
    };
    const size = JSON.stringify(bounded).length;
    if (kept.length > 0 && used + size > PREVIEW_BUDGET_CHARS) break;
    kept.push(bounded);
    used += size;
  }
  return { rows: kept, total: rows.length };
}
