import type { ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { CallEvidenceExcerpt } from "../server/lib/intelligence/evidence.js";
import {
  requireCrmScope,
  scopedCrmIdempotencyKey,
} from "./_crm-action-utils.js";

export async function loadCrmSignalEvidence(args: {
  recordId: string;
  evidenceIds?: string[];
  role?: "viewer" | "editor";
}) {
  await assertAccess("crm-record", args.recordId, args.role ?? "viewer");
  const db = getDb();
  const predicates = [
    eq(schema.crmCallEvidence.recordId, args.recordId),
    accessFilter(schema.crmCallEvidence, schema.crmCallEvidenceShares),
  ];
  if (args.evidenceIds?.length) {
    predicates.push(inArray(schema.crmCallEvidence.id, args.evidenceIds));
  }
  const rows = await db
    .select()
    .from(schema.crmCallEvidence)
    .where(and(...predicates))
    .limit(20);
  if (
    args.evidenceIds?.length &&
    rows.length !== new Set(args.evidenceIds).size
  ) {
    throw new Error("One or more call-evidence references are unavailable.");
  }
  return rows;
}

export function evidenceExcerpts(
  rows: Awaited<ReturnType<typeof loadCrmSignalEvidence>>,
): CallEvidenceExcerpt[] {
  return rows.flatMap((row) => {
    const quote = row.quote.trim() || row.summary.trim();
    if (!quote) return [];
    return [
      {
        evidenceRef: row.id,
        quote,
        ...(row.speaker ? { speaker: row.speaker } : {}),
        startSeconds: row.startSeconds ?? 0,
        ...(row.endSeconds !== null ? { endSeconds: row.endSeconds } : {}),
      },
    ];
  });
}

export async function crmSignalIdempotencyKey(
  ctx: ActionRunContext | undefined,
  recordId: string,
  key: string,
) {
  const scope = requireCrmScope(ctx);
  return {
    scope,
    key: await scopedCrmIdempotencyKey({
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      recordId,
      key: `signal:${key}`,
    }),
  };
}

export function signalTupleError(message: string): never {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 404;
  throw error;
}
