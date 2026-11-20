import { resolveTxt } from "node:dns/promises";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  dnsRecords,
  VERIFY_LABEL,
  type DomainRow,
} from "../shared/domain-contract.js";
import { failNotFound, firstRow, orgScope, type Access } from "./_access.js";

const LOOKUP_TIMEOUT_MS = 4000;

/** Where a custom domain's CNAME must point; set per deployment. */
export const cnameTarget = () =>
  process.env.FORMS_DOMAIN_CNAME_TARGET ?? "domains.forms.invalid";

type DomainRecordRow = typeof schema.domains.$inferSelect;

export function toDomainRow(
  row: DomainRecordRow,
  forms: DomainRow["forms"],
): DomainRow {
  return {
    id: row.id,
    host: row.host,
    status: row.status === "verified" ? "verified" : "pending",
    lastCheckedAt: row.lastCheckedAt,
    records: dnsRecords(row.host, row.verificationToken, cnameTarget()),
    forms,
  };
}

export async function requireDomain(
  access: Access,
  id: string,
): Promise<DomainRecordRow> {
  const { domains } = schema;
  const row = firstRow(
    await getDb()
      .select()
      .from(domains)
      .where(and(eq(domains.id, id), orgScope(domains, access.orgId)))
      .limit(1),
  );
  return row ?? failNotFound("Domain not found.");
}

export type TxtLookup =
  | { found: true }
  | { found: false; reason: "no_record" | "lookup_failed" };

/** Whether the host's verification TXT record carries the token. */
export async function lookupVerification(
  host: string,
  token: string,
): Promise<TxtLookup> {
  const expected = `forms-verify=${token}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolveTxt(`${VERIFY_LABEL}.${host}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("lookup timed out")),
          LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
    return records.some((chunks) => chunks.join("") === expected)
      ? { found: true }
      : { found: false, reason: "no_record" };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return {
      found: false,
      reason:
        code === "ENOTFOUND" || code === "ENODATA"
          ? "no_record"
          : "lookup_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
