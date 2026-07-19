import { E2EE_SIZE_LIMITS, opaqueIdSchema } from "@agent-native/core/e2ee";
import {
  putProtectedCiphertext,
  type ProtectedCiphertextPutResult,
} from "@agent-native/core/protected-ciphertext";
import { recordChange } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { validatePrivateVaultGrantRow } from "../../shared/private-vault-hosted-records.js";
import { getDb, schema } from "../db/index.js";
import {
  commitPrivateVaultCiphertextStageInTransaction,
  privateVaultCiphertextStagingService,
  type PrivateVaultCiphertextStage,
} from "./private-vault-ciphertext-staging.js";
import type { PrivateVaultJobScope } from "./private-vault-jobs.js";

export const PRIVATE_VAULT_GRANT_MAX_BYTES =
  E2EE_SIZE_LIMITS.controlEnvelopeBytes;
const timestamp = z.string().datetime({ offset: true });

export const privateVaultGrantInputSchema = z
  .object({
    vaultId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    algorithmId: z.literal("anc/v1"),
    ciphertextByteLength: z
      .number()
      .int()
      .positive()
      .max(PRIVATE_VAULT_GRANT_MAX_BYTES),
    issuedAt: timestamp,
    expiresAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Grant expiry must be later than issuance",
      });
    }
  });

export type PrivateVaultGrantInput = z.infer<
  typeof privateVaultGrantInputSchema
>;
export interface PrivateVaultGrantMetadata extends PrivateVaultGrantInput {
  readonly serverReceivedAt: string;
}

export class PrivateVaultGrantNotFoundError extends Error {
  constructor() {
    super("Private Vault grant scope was not found");
    this.name = "PrivateVaultGrantNotFoundError";
  }
}

export class PrivateVaultGrantConflictError extends Error {
  constructor() {
    super("Private Vault grant conflicts with its immutable coordinate");
    this.name = "PrivateVaultGrantConflictError";
  }
}

const coordinate = (vaultId: string, grantId: string) =>
  ({ kind: "grant", vaultId, grantId }) as const;

function metadataFromRow(
  row: typeof schema.contentEncryptedVaultGrants.$inferSelect,
): PrivateVaultGrantMetadata {
  validatePrivateVaultGrantRow(row);
  return {
    vaultId: row.vaultId,
    grantId: row.grantId,
    recipientEndpointId: row.recipientEndpointId,
    algorithmId: row.algorithmId as "anc/v1",
    ciphertextByteLength: row.ciphertextByteLength,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    serverReceivedAt: row.serverReceivedAt,
  };
}

function sameGrant(
  left: PrivateVaultGrantMetadata,
  right: PrivateVaultGrantMetadata,
) {
  return (
    left.vaultId === right.vaultId &&
    left.grantId === right.grantId &&
    left.recipientEndpointId === right.recipientEndpointId &&
    left.algorithmId === right.algorithmId &&
    left.ciphertextByteLength === right.ciphertextByteLength &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt
  );
}

export interface PrivateVaultGrantStore {
  authorize(
    scope: PrivateVaultJobScope,
    input: PrivateVaultGrantInput,
  ): Promise<boolean>;
  persist(
    scope: PrivateVaultJobScope,
    grant: PrivateVaultGrantMetadata,
    stage: PrivateVaultCiphertextStage,
  ): Promise<PrivateVaultGrantMetadata>;
}

export const sqlPrivateVaultGrantStore: PrivateVaultGrantStore = {
  authorize: async (scope, input) => {
    const [row] = await getDb()
      .select({ vaultId: schema.contentEncryptedVaults.vaultId })
      .from(schema.contentEncryptedVaults)
      .innerJoin(
        schema.contentEncryptedVaultEndpoints,
        and(
          eq(
            schema.contentEncryptedVaultEndpoints.vaultId,
            schema.contentEncryptedVaults.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultEndpoints.ownerEmail,
            schema.contentEncryptedVaults.ownerEmail,
          ),
          eq(
            schema.contentEncryptedVaultEndpoints.orgId,
            schema.contentEncryptedVaults.orgId,
          ),
          eq(
            schema.contentEncryptedVaultEndpoints.endpointId,
            input.recipientEndpointId,
          ),
          eq(schema.contentEncryptedVaultEndpoints.endpointState, "online"),
        ),
      )
      .where(
        and(
          eq(schema.contentEncryptedVaults.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaults.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaults.orgId, scope.orgId),
          eq(schema.contentEncryptedVaults.vaultState, "active"),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  persist: async (scope, grant, stage) => {
    const row = {
      version: 1 as const,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      ...grant,
    };
    validatePrivateVaultGrantRow(row);
    return getDb().transaction(async (tx) => {
      await tx
        .insert(schema.contentEncryptedVaultGrants)
        .values(row)
        .onConflictDoNothing();
      const [storedRow] = await tx
        .select()
        .from(schema.contentEncryptedVaultGrants)
        .where(
          and(
            eq(schema.contentEncryptedVaultGrants.grantId, grant.grantId),
            eq(schema.contentEncryptedVaultGrants.vaultId, scope.vaultId),
            eq(schema.contentEncryptedVaultGrants.ownerEmail, scope.ownerEmail),
            eq(schema.contentEncryptedVaultGrants.orgId, scope.orgId),
          ),
        )
        .limit(1);
      const stored = storedRow ? metadataFromRow(storedRow) : null;
      if (!stored || !sameGrant(stored, grant))
        throw new PrivateVaultGrantConflictError();
      await commitPrivateVaultCiphertextStageInTransaction(
        tx,
        stage,
        grant.serverReceivedAt,
      );
      return stored;
    });
  },
};

export function createPrivateVaultGrantService(
  options: {
    store?: PrivateVaultGrantStore;
    put?: (input: {
      coordinate: ReturnType<typeof coordinate>;
      ciphertext: Uint8Array;
      expectedByteLength: number;
    }) => Promise<ProtectedCiphertextPutResult>;
    stage?: typeof privateVaultCiphertextStagingService;
    now?: () => Date;
  } = {},
) {
  const store = options.store ?? sqlPrivateVaultGrantStore;
  const put = options.put ?? putProtectedCiphertext;
  const staging = options.stage ?? privateVaultCiphertextStagingService;
  const now = options.now ?? (() => new Date());
  return {
    async authorize(
      scope: PrivateVaultJobScope,
      rawInput: PrivateVaultGrantInput,
    ) {
      const input = privateVaultGrantInputSchema.parse(rawInput);
      if (
        input.vaultId !== scope.vaultId ||
        !(await store.authorize(scope, input))
      )
        throw new PrivateVaultGrantNotFoundError();
      return input;
    },
    async create(
      scope: PrivateVaultJobScope,
      rawInput: PrivateVaultGrantInput & { ciphertext: Uint8Array },
    ) {
      const { ciphertext, ...metadata } = rawInput;
      const input = privateVaultGrantInputSchema.parse(metadata);
      if (
        input.vaultId !== scope.vaultId ||
        !(ciphertext instanceof Uint8Array) ||
        ciphertext.byteLength !== input.ciphertextByteLength
      )
        throw new PrivateVaultGrantNotFoundError();
      const serverReceivedAt = now().toISOString();
      const issuedAt = Date.parse(input.issuedAt);
      const expiresAt = Date.parse(input.expiresAt);
      const receivedAt = Date.parse(serverReceivedAt);
      if (
        expiresAt <= receivedAt ||
        issuedAt > receivedAt + 5 * 60 * 1000 ||
        expiresAt - issuedAt > 30 * 24 * 60 * 60 * 1000 ||
        !(await store.authorize(scope, input))
      )
        throw new PrivateVaultGrantNotFoundError();
      const grant: PrivateVaultGrantMetadata = { ...input, serverReceivedAt };
      const grantCoordinate = coordinate(input.vaultId, input.grantId);
      const ciphertextStage = await staging.stage(scope, grantCoordinate);
      await put({
        coordinate: grantCoordinate,
        ciphertext,
        expectedByteLength: input.ciphertextByteLength,
      });
      const stored = await store.persist(scope, grant, ciphertextStage);
      recordChange({
        source: "private-vault",
        type: "grant.created",
        key: grant.grantId,
        owner: scope.ownerEmail,
        ...(scope.orgId ? { orgId: scope.orgId } : {}),
      });
      return stored;
    },
  };
}

export const privateVaultGrantService = createPrivateVaultGrantService();
