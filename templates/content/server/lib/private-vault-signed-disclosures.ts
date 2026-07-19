import type { VerifiedAncV1BrokerDisclosure } from "@agent-native/core/e2ee";
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { PrivateVaultEndpointPrincipal } from "./private-vault-jobs.js";

export class PrivateVaultSignedDisclosureConflictError extends Error {
  constructor() {
    super("Private Vault signed disclosure conflicts with durable evidence");
    this.name = "PrivateVaultSignedDisclosureConflictError";
  }
}

function iso(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds <= 0)
    throw new PrivateVaultSignedDisclosureConflictError();
  return new Date(seconds * 1000).toISOString();
}

function durable(input: {
  principal: PrivateVaultEndpointPrincipal;
  disclosure: VerifiedAncV1BrokerDisclosure;
}) {
  const { principal, disclosure } = input;
  if (
    disclosure.vaultId !== principal.vaultId ||
    disclosure.endpointId !== principal.endpointId
  )
    throw new PrivateVaultSignedDisclosureConflictError();
  return Object.freeze({
    disclosureId: disclosure.disclosureId,
    vaultId: principal.vaultId,
    ownerEmail: principal.ownerEmail,
    orgId: principal.orgId,
    version: 1,
    endpointId: principal.endpointId,
    jobId: disclosure.jobId,
    grantId: disclosure.grantId,
    grantRef: disclosure.grantRef,
    resourceId: disclosure.resourceId,
    operation: disclosure.operation,
    providerId: disclosure.providerId,
    destination: disclosure.destination,
    outcome: disclosure.outcome,
    scopeHash: disclosure.scopeHash,
    issuedAt: iso(disclosure.issuedAt),
    expiresAt: iso(disclosure.expiresAt),
    signedEnvelope: Buffer.from(disclosure.signedEnvelope).toString(
      "base64url",
    ),
  });
}

function same(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return Object.keys(right).every((key) => left[key] === right[key]);
}

export const privateVaultSignedDisclosureService = Object.freeze({
  async append(input: {
    principal: PrivateVaultEndpointPrincipal;
    disclosure: VerifiedAncV1BrokerDisclosure;
  }) {
    const row = durable(input);
    const db = getDb();
    await db
      .insert(schema.contentEncryptedVaultSignedDisclosures)
      .values(row)
      .onConflictDoNothing();
    const [stored] = await db
      .select()
      .from(schema.contentEncryptedVaultSignedDisclosures)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultSignedDisclosures.disclosureId,
            row.disclosureId,
          ),
          eq(
            schema.contentEncryptedVaultSignedDisclosures.ownerEmail,
            row.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultSignedDisclosures.orgId, row.orgId),
          eq(
            schema.contentEncryptedVaultSignedDisclosures.vaultId,
            row.vaultId,
          ),
        ),
      )
      .limit(1);
    if (!stored || !same(stored, row))
      throw new PrivateVaultSignedDisclosureConflictError();
    return row;
  },

  async list(
    scope: { ownerEmail: string; orgId: string; vaultId: string },
    limit = 50,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new PrivateVaultSignedDisclosureConflictError();
    return getDb()
      .select()
      .from(schema.contentEncryptedVaultSignedDisclosures)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultSignedDisclosures.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultSignedDisclosures.orgId, scope.orgId),
          eq(
            schema.contentEncryptedVaultSignedDisclosures.vaultId,
            scope.vaultId,
          ),
        ),
      )
      .orderBy(
        desc(schema.contentEncryptedVaultSignedDisclosures.serverReceivedAt),
      )
      .limit(limit);
  },
});
