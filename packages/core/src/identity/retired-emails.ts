/**
 * Credentials this app signs (MCP OAuth access JWTs, connect tokens) are
 * stateless, so an email rekey cannot recall the ones already issued for the
 * old address. Rekey records the address here inside its own transaction.
 * Admission then refuses credentials for it signed no later than that, and
 * issuance refuses the address until an account holds it again.
 */
import type { DbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

export const IDENTITY_RETIRED_EMAILS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS identity_retired_emails (
  -- guard:allow-identity-column — the retired address itself; rekey and offboarding never rewrite it
  email TEXT PRIMARY KEY,
  retired_at BIGINT NOT NULL
)`;

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = ensureTableExists(
      "identity_retired_emails",
      IDENTITY_RETIRED_EMAILS_CREATE_SQL,
    )
      .then(() => undefined)
      .catch((error) => {
        _initPromise = undefined;
        throw error;
      });
  }
  return _initPromise;
}

/**
 * Key for `pg_advisory_xact_lock(hashtextextended(key, 0))`. Rekey takes it
 * for both addresses, offboarding for the removed member, and credential
 * issuance for its owner, each before any row lock, so issuance cannot write
 * a grant for an address mid-rekey or mid-offboard.
 */
export function identityCredentialLockKey(email: string): string {
  return `identity-credentials:${email.trim().toLowerCase()}`;
}

/**
 * Epoch milliseconds of the latest rekey away from `email`, or null when no
 * rekey has. A database no rekey has touched has no table, which is the same
 * answer.
 */
export async function readEmailRetiredAt(
  exec: DbExec,
  email: string,
): Promise<number | null> {
  // Probe the catalog instead of catching a missing relation: inside an
  // issuance transaction a failed statement would abort the transaction.
  const probe = await exec.execute({
    sql: `SELECT to_regclass('identity_retired_emails') IS NOT NULL AS present`,
    args: [],
  });
  const present = probe.rows[0]?.present;
  if (present === false) return null;
  if (present !== true)
    throw new Error(
      "Could not determine whether identity_retired_emails exists.",
    );
  const { rows } = await exec.execute({
    sql: `SELECT retired_at FROM identity_retired_emails WHERE email = ?`,
    args: [email.trim().toLowerCase()],
  });
  if (!rows.length) return null;
  const retiredAt = Number(rows[0].retired_at);
  if (!Number.isSafeInteger(retiredAt) || retiredAt <= 0)
    throw new Error("identity_retired_emails.retired_at is unreadable.");
  return retiredAt;
}
