import { fail, isActionContractError } from "@agent-native/core/action";
import {
  getUserSettingEntry,
  mutateUserSetting,
} from "@agent-native/core/settings";
import { z } from "zod";

/**
 * Safe, short-lived readback for a private SQLFluff validation POST.
 *
 * The private mutation deliberately discards its response body, so the browser
 * correlates its own opaque request id with this record. Only the verdict and
 * the runtime's known error code cross the boundary: never the raw config, a
 * hash of it, or the runtime's message (which can quote config fragments).
 *
 * The record lives in the signed-in actor's user-setting namespace with the
 * exact personal/org scope in the key, so one actor or organisation can never
 * read another's verdict. It is bounded to the newest few entries and expires
 * quickly so a stale verdict cannot be replayed.
 */
export const SQLFLUFF_VERDICT_MAX_ENTRIES = 8;
export const SQLFLUFF_VERDICT_TTL_MS = 2 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;

export interface SqlFluffVerdictScope {
  userEmail: string;
  orgId: string | undefined;
}

export interface SqlFluffVerdict {
  requestId: string;
  valid: boolean;
  errorCode: string | null;
}

export type SqlFluffVerdictResult = Pick<
  SqlFluffVerdict,
  "valid" | "errorCode"
>;

const verdictRecordSchema = z
  .object({
    requestId: z.string().uuid(),
    valid: z.boolean(),
    errorCode: z.string().min(1).max(120).nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .refine((record) => record.valid === (record.errorCode === null), {
    message: "A valid verdict has no error code and an invalid one has a code.",
  });

const verdictStoreSchema = z
  .object({
    verdicts: z.array(verdictRecordSchema).max(SQLFLUFF_VERDICT_MAX_ENTRIES),
  })
  .strict();

type VerdictRecord = z.infer<typeof verdictRecordSchema>;
type VerdictStore = z.infer<typeof verdictStoreSchema>;

function unreadable(): never {
  fail("The SQLFluff validation result record could not be read.", {
    errorCode: "data_sqlfluff_verdict_unreadable",
    statusCode: 503,
  });
}

function writeFailed(): never {
  fail("The SQLFluff validation result could not be recorded.", {
    errorCode: "data_sqlfluff_verdict_write_failed",
    statusCode: 503,
  });
}

function notFound(): never {
  fail("The SQLFluff validation result is not available.", {
    errorCode: "data_sqlfluff_verdict_not_found",
    statusCode: 404,
  });
}

/** The exact actor + org/personal scope, mirroring the data save-result key. */
export function sqlFluffVerdictKey(scope: SqlFluffVerdictScope): string {
  return scope.orgId === undefined
    ? "analytics.data.sqlfluff-verdicts:personal"
    : `analytics.data.sqlfluff-verdicts:org:${encodeURIComponent(scope.orgId)}`;
}

function parseStore(value: unknown): VerdictStore {
  const parsed = verdictStoreSchema.safeParse(value);
  if (!parsed.success) unreadable();
  return parsed.data;
}

function fresh(record: VerdictRecord, now: number): boolean {
  if (record.createdAt > now + FUTURE_SKEW_MS) unreadable();
  return now - record.createdAt <= SQLFLUFF_VERDICT_TTL_MS;
}

export async function recordSqlFluffVerdict(
  scope: SqlFluffVerdictScope,
  verdict: SqlFluffVerdict,
): Promise<void> {
  const now = Date.now();
  const incoming = verdictRecordSchema.safeParse({
    ...verdict,
    createdAt: now,
  });
  if (!incoming.success) writeFailed();
  try {
    await mutateUserSetting(
      scope.userEmail,
      sqlFluffVerdictKey(scope),
      (current) => {
        const store = current === null ? { verdicts: [] } : parseStore(current);
        const retained = store.verdicts.filter((record) => fresh(record, now));
        const next = [
          incoming.data,
          ...retained.filter(
            (record) => record.requestId !== incoming.data.requestId,
          ),
        ].slice(0, SQLFLUFF_VERDICT_MAX_ENTRIES);
        return { verdicts: next };
      },
      {
        // A present row must be a well-formed store. The updater cannot tell a
        // stored JSON null (or array/scalar) from an absent row on its own.
        validateStoredValue: (value) => {
          const parsed = verdictStoreSchema.safeParse(value);
          if (!parsed.success) unreadable();
        },
      },
    );
  } catch (error) {
    if (isActionContractError(error)) throw error;
    writeFailed();
  }
}

export async function readSqlFluffVerdict(
  scope: SqlFluffVerdictScope,
  requestId: string,
): Promise<SqlFluffVerdictResult> {
  const entry = await getUserSettingEntry(
    scope.userEmail,
    sqlFluffVerdictKey(scope),
    { bypassCache: true },
  ).catch((error: unknown) => {
    if (isActionContractError(error)) throw error;
    unreadable();
  });
  if (!entry.found) notFound();
  const store = parseStore(entry.value);
  const now = Date.now();
  const found = store.verdicts.find((record) => record.requestId === requestId);
  if (!found || !fresh(found, now)) notFound();
  return { valid: found.valid, errorCode: found.errorCode };
}
