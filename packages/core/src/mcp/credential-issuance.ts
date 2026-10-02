import { getDbExec, type DbExec } from "../db/client.js";
import { checkCredentialOrgMembership } from "./credential-membership.js";

export class McpCredentialIssuanceError extends Error {
  constructor(
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
  },
  run: (tx: DbExec) => Promise<T>,
): Promise<T> {
  const orgId = input.orgId?.trim() || null;
  const email = input.email.trim().toLowerCase();
  const requiresMembership = orgId !== null && input.kind !== "service";
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
      if (requiresMembership) {
        const { rows } = await tx.execute({
          sql: `SELECT id FROM org_members
                WHERE org_id = ? AND LOWER(email) = ?
                  AND federation_removal_pending_at IS NULL
                FOR UPDATE`,
          args: [orgId, email],
        });
        if (rows.length === 0) {
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
