/**
 * Server-side helper: resolve and validate a localhost write-consent grant.
 *
 * Security model
 * ==============
 * - The grant row is loaded by designId + connectionId for the authenticated
 *   user.
 * - An expired grant (grantedUntil < now) is rejected.
 * - The target file path must be inside rootPath — validated using Node's
 *   path.resolve so that ".." traversal and absolute-path injection are
 *   blocked at this layer. The bridge also performs its own realpath check.
 * - The function throws an Error with a descriptive message on any violation so
 *   callers can surface it cleanly to the agent.
 */

import path from "node:path";

import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export interface WriteGrantContext {
  designId: string;
  connectionId: string;
  ownerEmail: string;
  orgId: string | null;
  targetPath: string;
}

export interface WriteGrantResult {
  rootPath: string;
  bridgeToken: string;
  grantId: string;
}

export class WriteConsentRequiredError extends Error {
  readonly statusCode = 428;

  constructor(message: string) {
    super(message);
    this.name = "WriteConsentRequiredError";
  }
}

export async function verifyWriteGrant(
  ctx: WriteGrantContext,
): Promise<WriteGrantResult> {
  const { designId, connectionId, ownerEmail, orgId, targetPath } = ctx;

  const db = getDb();
  const [grant] = await db
    .select()
    .from(schema.designLocalhostWriteGrants)
    .where(
      and(
        eq(schema.designLocalhostWriteGrants.designId, designId),
        eq(schema.designLocalhostWriteGrants.connectionId, connectionId),
        eq(schema.designLocalhostWriteGrants.ownerEmail, ownerEmail),
        orgId
          ? eq(schema.designLocalhostWriteGrants.orgId, orgId)
          : isNull(schema.designLocalhostWriteGrants.orgId),
      ),
    )
    .limit(1);

  if (!grant) {
    throw new WriteConsentRequiredError(
      "No localhost write-consent grant found for this design + connection. " +
        "Call request-localhost-write-consent to prompt the user, then retry " +
        "this write after they click 'Allow writes'.",
    );
  }

  const now = new Date().toISOString();
  if (grant.grantedUntil < now) {
    throw new WriteConsentRequiredError(
      `Localhost write-consent grant expired at ${grant.grantedUntil}. ` +
        "Call request-localhost-write-consent to prompt the user for a new " +
        "grant, then retry this write.",
    );
  }

  assertPathInside(grant.rootPath, targetPath);

  return {
    rootPath: grant.rootPath,
    bridgeToken: grant.bridgeToken,
    grantId: grant.id,
  };
}

export function assertPathInside(rootPath: string, targetPath: string): void {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(rootPath, targetPath);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error(
      `Path "${targetPath}" is outside the consented root "${rootPath}". ` +
        "Write access is restricted to files inside the granted root folder.",
    );
  }
}
