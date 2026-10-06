import { getDbExec, type DbExec } from "../db/client.js";
import {
  identityCredentialLockKey,
  readEmailRetiredAt,
} from "../identity/retired-emails.js";
import type { OrgRole } from "../org/types.js";
import { checkCredentialOrgMembership } from "./credential-membership.js";

export class McpCredentialIssuanceError extends Error {
  constructor(
    /**
     * `not-member`: the owner lacks the live membership or role the credential
     * needs, or holds an address an email change retired.
     */
    readonly reason: "not-member" | "unavailable",
    options?: ErrorOptions,
  ) {
    super(reason, options);
    this.name = "McpCredentialIssuanceError";
  }
}

export async function withMcpCredentialIssuance<T>(
  input: {
    email: string;
    orgId?: string | null;
    requestOrigin?: string;
    kind?: "personal" | "service";
    /** Roles allowed to issue, rechecked under the membership lock. */
    roles?: readonly OrgRole[];
  },
  run: (tx: DbExec) => Promise<T>,
): Promise<T> {
  const orgId = input.orgId?.trim() || null;
  const email = input.email.trim().toLowerCase();
  const human = input.kind !== "service";
  const requiresMembership = orgId !== null && human;
  if (requiresMembership) {
    // Federation validation may update membership on another connection.
    // Finish it before acquiring the local offboarding lock.
    const membership = await checkCredentialOrgMembership({
      orgId,
      email,
      requestOrigin: input.requestOrigin,
    });
    if (membership !== "member") {
      throw new McpCredentialIssuanceError(membership);
    }
  }

  const db = getDbExec();
  if (!db.transaction) throw new McpCredentialIssuanceError("unavailable");
  try {
    return await db.transaction(async (tx) => {
      if (human) {
        // Email rekey takes this lock for both addresses before its row locks.
        await tx.execute({
          sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
          args: [identityCredentialLockKey(email)],
        });
        if ((await readEmailRetiredAt(tx, email)) !== null) {
          const { rows } = await tx.execute({
            sql: `SELECT 1 FROM "user" WHERE LOWER("email") = ? LIMIT 1`,
            args: [email],
          });
          if (rows.length === 0) {
            throw new McpCredentialIssuanceError("not-member");
          }
        }
      }
      if (requiresMembership) {
        const { rows } = await tx.execute({
          sql: `SELECT role FROM org_members
                WHERE org_id = ? AND LOWER(email) = ?
                  AND federation_removal_pending_at IS NULL
                FOR UPDATE`,
          args: [orgId, email],
        });
        if (
          rows.length === 0 ||
          (input.roles &&
            !input.roles.includes(String(rows[0].role) as OrgRole))
        ) {
          throw new McpCredentialIssuanceError("not-member");
        }
      }
      return run(tx);
    });
  } catch (error) {
    if (error instanceof McpCredentialIssuanceError) throw error;
    throw new McpCredentialIssuanceError("unavailable", { cause: error });
  }
}
