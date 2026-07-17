import { randomUUID } from "node:crypto";

import {
  E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";

const endpointRequestNonceClaimSchema = z
  .object({
    ownerEmail: z.string().email().max(320),
    orgId: z.string().max(160),
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    nonce: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[0-9a-f]+$/),
    claimedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const lifetimeSeconds =
      (Date.parse(value.expiresAt) - Date.parse(value.claimedAt)) / 1000;
    if (lifetimeSeconds < E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Replay claims must cover the complete nonce retention window",
      });
    }
  });

export type PrivateVaultEndpointRequestNonceClaim = z.infer<
  typeof endpointRequestNonceClaimSchema
>;

export interface PrivateVaultEndpointRequestNonceStore {
  claim(input: PrivateVaultEndpointRequestNonceClaim): Promise<boolean>;
  deleteExpired(now: string): Promise<number>;
}

/**
 * The endpoint-state predicate and replay insert are one SQL statement. A
 * concurrent revocation can therefore only win before this claim or in the job
 * mutation's second authorization check; it cannot create an unscoped nonce.
 */
export const sqlPrivateVaultEndpointRequestNonceStore: PrivateVaultEndpointRequestNonceStore =
  {
    claim: async (input) => {
      const parsed = endpointRequestNonceClaimSchema.parse({
        ...input,
        ownerEmail: input.ownerEmail.trim().toLowerCase(),
        orgId: input.orgId.trim(),
      });
      const id = randomUUID();
      const endpoint = schema.contentEncryptedVaultEndpoints;
      const claims = schema.contentEncryptedVaultEndpointRequestNonces;
      const eligibleEndpoint = getDb()
        .select({
          id: sql<string>`${id}`.as("id"),
          vaultId: endpoint.vaultId,
          endpointId: endpoint.endpointId,
          ownerEmail: endpoint.ownerEmail,
          orgId: endpoint.orgId,
          nonce: sql<string>`${parsed.nonce}`.as("nonce"),
          claimedAt: sql<string>`${parsed.claimedAt}`.as("claimed_at"),
          expiresAt: sql<string>`${parsed.expiresAt}`.as("expires_at"),
        })
        .from(endpoint)
        .where(
          and(
            eq(endpoint.endpointId, parsed.endpointId),
            eq(endpoint.vaultId, parsed.vaultId),
            eq(endpoint.ownerEmail, parsed.ownerEmail),
            eq(endpoint.orgId, parsed.orgId),
            eq(endpoint.endpointState, "online"),
          ),
        );
      const inserted = await getDb()
        .insert(claims)
        .select(eligibleEndpoint)
        .onConflictDoNothing()
        .returning({ id: claims.id });
      return inserted.length === 1;
    },
    deleteExpired: async (now) => {
      const parsedNow = protocolTimestampSchema.parse(now);
      const deleted = await getDb()
        .delete(schema.contentEncryptedVaultEndpointRequestNonces)
        .where(
          lte(
            schema.contentEncryptedVaultEndpointRequestNonces.expiresAt,
            parsedNow,
          ),
        )
        .returning({
          id: schema.contentEncryptedVaultEndpointRequestNonces.id,
        });
      return deleted.length;
    },
  };
