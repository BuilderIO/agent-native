import { randomUUID } from "node:crypto";

import {
  E2EE_SIZE_LIMITS,
  opaqueAlgorithmIdSchema,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import {
  deleteProtectedCiphertextAt,
  putProtectedCiphertext,
  readProtectedCiphertextAt,
  type ProtectedCiphertextPutResult,
} from "@agent-native/core/protected-ciphertext";
import { recordChange } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  validatePrivateVaultJobResultRow,
  validatePrivateVaultJobRow,
} from "../../shared/private-vault-hosted-records.js";
import { getDb, schema } from "../db/index.js";
import {
  commitPrivateVaultCiphertextStageInTransaction,
  privateVaultCiphertextStagingService,
  type PrivateVaultCiphertextStage,
} from "./private-vault-ciphertext-staging.js";
import {
  buildPrivateVaultRetentionItem,
  enqueuePrivateVaultRetentionItem,
  enqueuePrivateVaultRetentionItems,
} from "./private-vault-retention.js";

export const PRIVATE_VAULT_JOB_MAX_BYTES = E2EE_SIZE_LIMITS.jobPayloadBytes;
export const PRIVATE_VAULT_RESULT_MAX_BYTES =
  E2EE_SIZE_LIMITS.resultPayloadBytes;
export const PRIVATE_VAULT_JOB_ACTION_MAX_BYTES = 1024 * 1024;
export const PRIVATE_VAULT_JOB_MAX_RETRIES = 100;
export const PRIVATE_VAULT_DEFAULT_LEASE_MS = 60_000;

const positiveEpoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const byteLength = (maximum: number) =>
  z.number().int().positive().max(maximum);

export const privateVaultJobInputSchema = z
  .object({
    vaultId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    grantId: opaqueIdSchema,
    recipientEndpointId: opaqueIdSchema,
    epoch: positiveEpoch,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(PRIVATE_VAULT_JOB_MAX_BYTES),
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Job expiry must be later than issuance",
      });
    }
  });

export const privateVaultJobResultInputSchema = z
  .object({
    vaultId: opaqueIdSchema,
    jobId: opaqueIdSchema,
    epoch: positiveEpoch,
    jobHash: opaqueIdSchema,
    algorithmId: opaqueAlgorithmIdSchema,
    ciphertextByteLength: byteLength(PRIVATE_VAULT_RESULT_MAX_BYTES),
    state: z.enum(["completed", "failed"]),
    retryCount: z
      .number()
      .int()
      .nonnegative()
      .max(PRIVATE_VAULT_JOB_MAX_RETRIES),
  })
  .strict();

export type PrivateVaultJobInput = z.infer<typeof privateVaultJobInputSchema>;
export type PrivateVaultJobResultInput = z.infer<
  typeof privateVaultJobResultInputSchema
>;
export type PrivateVaultJobState =
  | "queued"
  | "leased"
  | "acknowledged"
  | "retry_wait"
  | "cancelled"
  | "completed"
  | "failed";

export interface PrivateVaultJobScope {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
}

/** Authenticated endpoint identity supplied by the PR5 authenticator, never request data. */
export interface PrivateVaultEndpointPrincipal extends PrivateVaultJobScope {
  endpointId: string;
}

export interface PrivateVaultJobMetadata extends PrivateVaultJobInput {
  state: PrivateVaultJobState;
  retryCount: number;
  retryAt: string | null;
  leaseExpiresAt: string | null;
  serverReceivedAt: string;
}

export interface PrivateVaultJobResultMetadata extends PrivateVaultJobResultInput {
  endpointId: string;
  serverReceivedAt: string;
}

export class PrivateVaultJobNotFoundError extends Error {
  constructor() {
    super("Private Vault job was not found");
    this.name = "PrivateVaultJobNotFoundError";
  }
}

export class PrivateVaultJobConflictError extends Error {
  constructor() {
    super("Private Vault job transition conflicts with current state");
    this.name = "PrivateVaultJobConflictError";
  }
}

export class PrivateVaultEndpointAuthenticationUnavailableError extends Error {
  constructor() {
    super("Private Vault endpoint authentication is unavailable");
    this.name = "PrivateVaultEndpointAuthenticationUnavailableError";
  }
}

export function requirePrivateVaultJobActionScope(
  vaultId: string,
): PrivateVaultJobScope {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new PrivateVaultJobNotFoundError();
  return { ownerEmail, orgId: getRequestOrgId() ?? "", vaultId };
}

function normalizeScope<T extends PrivateVaultJobScope>(input: T): T {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320) {
    throw new PrivateVaultJobNotFoundError();
  }
  return {
    ...input,
    ownerEmail,
    orgId: input.orgId.trim(),
    vaultId: opaqueIdSchema.parse(input.vaultId),
  };
}

function jobCoordinate(
  vaultId: string,
  jobId: string,
  part: "request" | "result",
) {
  return { kind: "job" as const, vaultId, jobId, part };
}

function sameJob(a: PrivateVaultJobMetadata, b: PrivateVaultJobMetadata) {
  return (
    a.vaultId === b.vaultId &&
    a.jobId === b.jobId &&
    a.grantId === b.grantId &&
    a.recipientEndpointId === b.recipientEndpointId &&
    a.epoch === b.epoch &&
    a.algorithmId === b.algorithmId &&
    a.ciphertextByteLength === b.ciphertextByteLength &&
    a.issuedAt === b.issuedAt &&
    a.expiresAt === b.expiresAt
  );
}

function sameJobResult(
  a: PrivateVaultJobResultMetadata,
  b: PrivateVaultJobResultMetadata,
) {
  return (
    a.vaultId === b.vaultId &&
    a.jobId === b.jobId &&
    a.endpointId === b.endpointId &&
    a.epoch === b.epoch &&
    a.jobHash === b.jobHash &&
    a.algorithmId === b.algorithmId &&
    a.ciphertextByteLength === b.ciphertextByteLength &&
    a.state === b.state &&
    a.retryCount === b.retryCount
  );
}

export function buildPrivateVaultJobRetentionItem(
  scope: PrivateVaultJobScope,
  jobId: string,
  triggerAt: string,
) {
  return buildPrivateVaultRetentionItem({
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
    vaultId: scope.vaultId,
    resourceKind: "job",
    resourceId: jobId,
    epoch: null,
    triggerAt,
  });
}

function activeEndpointPredicate(principal: PrivateVaultEndpointPrincipal) {
  return exists(
    getDb()
      .select({ one: sql`1` })
      .from(schema.contentEncryptedVaultEndpoints)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultEndpoints.endpointId,
            principal.endpointId,
          ),
          eq(schema.contentEncryptedVaultEndpoints.vaultId, principal.vaultId),
          eq(
            schema.contentEncryptedVaultEndpoints.ownerEmail,
            principal.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultEndpoints.orgId, principal.orgId),
          eq(schema.contentEncryptedVaultEndpoints.endpointState, "online"),
        ),
      ),
  );
}

function metadataFromRow(
  row: typeof schema.contentEncryptedVaultJobs.$inferSelect,
): PrivateVaultJobMetadata {
  validatePrivateVaultJobRow(row);
  return {
    vaultId: row.vaultId,
    jobId: row.jobId,
    grantId: row.grantId,
    recipientEndpointId: row.recipientEndpointId,
    epoch: row.epoch,
    algorithmId: row.algorithmId,
    ciphertextByteLength: row.ciphertextByteLength,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    state: row.jobState as PrivateVaultJobState,
    retryCount: row.retryCount,
    retryAt: row.retryAt,
    leaseExpiresAt: row.leaseExpiresAt,
    serverReceivedAt: row.serverReceivedAt,
  };
}

export interface PrivateVaultJobStore {
  isActiveEndpoint(principal: PrivateVaultEndpointPrincipal): Promise<boolean>;
  authorizeEnqueue(
    scope: PrivateVaultJobScope,
    input: PrivateVaultJobInput,
    now: string,
  ): Promise<boolean>;
  get(
    scope: PrivateVaultJobScope,
    jobId: string,
  ): Promise<PrivateVaultJobMetadata | null>;
  persist(
    scope: PrivateVaultJobScope,
    job: PrivateVaultJobMetadata,
    stage: PrivateVaultCiphertextStage,
  ): Promise<PrivateVaultJobMetadata>;
  list(scope: PrivateVaultJobScope): Promise<PrivateVaultJobMetadata[]>;
  cancel(
    scope: PrivateVaultJobScope,
    jobId: string,
    now: string,
  ): Promise<PrivateVaultJobMetadata | null>;
  claim(
    principal: PrivateVaultEndpointPrincipal,
    now: string,
    leaseExpiresAt: string,
  ): Promise<PrivateVaultJobMetadata | null>;
  acknowledge(
    principal: PrivateVaultEndpointPrincipal,
    jobId: string,
    retryCount: number,
    now: string,
  ): Promise<PrivateVaultJobMetadata | null>;
  retry(
    principal: PrivateVaultEndpointPrincipal,
    jobId: string,
    retryCount: number,
    retryAt: string,
    now: string,
  ): Promise<PrivateVaultJobMetadata | null>;
  requeue(
    principal: PrivateVaultEndpointPrincipal,
    jobId: string,
    retryCount: number,
    now: string,
  ): Promise<PrivateVaultJobMetadata | null>;
  complete(
    principal: PrivateVaultEndpointPrincipal,
    result: PrivateVaultJobResultMetadata,
    now: string,
    stage: PrivateVaultCiphertextStage,
  ): Promise<PrivateVaultJobMetadata | null>;
  getResult(
    scope: PrivateVaultJobScope,
    jobId: string,
  ): Promise<PrivateVaultJobResultMetadata | null>;
}

export interface PrivateVaultJobBlobStore {
  put(input: {
    coordinate: ReturnType<typeof jobCoordinate>;
    ciphertext: Uint8Array;
    expectedByteLength: number;
  }): Promise<ProtectedCiphertextPutResult>;
  read(
    coordinate: ReturnType<typeof jobCoordinate>,
  ): Promise<{ ciphertext: Uint8Array; byteLength: number }>;
  delete(
    coordinate: ReturnType<typeof jobCoordinate>,
  ): Promise<{ deleted: boolean }>;
}

export interface PrivateVaultJobStagingService {
  stage(
    scope: PrivateVaultJobScope,
    coordinate: ReturnType<typeof jobCoordinate>,
  ): Promise<PrivateVaultCiphertextStage>;
  clearAfterMetadataCommit(stage: PrivateVaultCiphertextStage): Promise<void>;
}

export const sqlPrivateVaultJobStore: PrivateVaultJobStore = {
  isActiveEndpoint: async (principal) => {
    const [endpoint] = await getDb()
      .select({ endpointId: schema.contentEncryptedVaultEndpoints.endpointId })
      .from(schema.contentEncryptedVaultEndpoints)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultEndpoints.endpointId,
            principal.endpointId,
          ),
          eq(schema.contentEncryptedVaultEndpoints.vaultId, principal.vaultId),
          eq(
            schema.contentEncryptedVaultEndpoints.ownerEmail,
            principal.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultEndpoints.orgId, principal.orgId),
          eq(schema.contentEncryptedVaultEndpoints.endpointState, "online"),
        ),
      )
      .limit(1);
    return Boolean(endpoint);
  },
  authorizeEnqueue: async (scope, input, now) => {
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
      .innerJoin(
        schema.contentEncryptedVaultGrants,
        and(
          eq(
            schema.contentEncryptedVaultGrants.vaultId,
            schema.contentEncryptedVaults.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultGrants.ownerEmail,
            schema.contentEncryptedVaults.ownerEmail,
          ),
          eq(
            schema.contentEncryptedVaultGrants.orgId,
            schema.contentEncryptedVaults.orgId,
          ),
          eq(schema.contentEncryptedVaultGrants.grantId, input.grantId),
          eq(
            schema.contentEncryptedVaultGrants.recipientEndpointId,
            input.recipientEndpointId,
          ),
          eq(schema.contentEncryptedVaultGrants.algorithmId, input.algorithmId),
        ),
      )
      .innerJoin(
        schema.contentEncryptedVaultKeyEpochs,
        and(
          eq(
            schema.contentEncryptedVaultKeyEpochs.vaultId,
            schema.contentEncryptedVaults.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultKeyEpochs.ownerEmail,
            schema.contentEncryptedVaults.ownerEmail,
          ),
          eq(
            schema.contentEncryptedVaultKeyEpochs.orgId,
            schema.contentEncryptedVaults.orgId,
          ),
          eq(schema.contentEncryptedVaultKeyEpochs.epoch, input.epoch),
          eq(schema.contentEncryptedVaultKeyEpochs.state, "active"),
        ),
      )
      .where(
        and(
          eq(schema.contentEncryptedVaults.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaults.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaults.orgId, scope.orgId),
          eq(schema.contentEncryptedVaults.vaultState, "active"),
          lte(schema.contentEncryptedVaultGrants.issuedAt, now),
        ),
      )
      .limit(1);
    if (!row) return false;
    const [grant] = await getDb()
      .select({ expiresAt: schema.contentEncryptedVaultGrants.expiresAt })
      .from(schema.contentEncryptedVaultGrants)
      .where(
        and(
          eq(schema.contentEncryptedVaultGrants.grantId, input.grantId),
          eq(schema.contentEncryptedVaultGrants.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaultGrants.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaultGrants.orgId, scope.orgId),
        ),
      )
      .limit(1);
    return Boolean(
      grant &&
      Date.parse(grant.expiresAt) > Date.parse(now) &&
      Date.parse(input.expiresAt) <= Date.parse(grant.expiresAt),
    );
  },
  get: async (scope, jobId) => {
    const [row] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultJobs)
      .where(
        and(
          eq(schema.contentEncryptedVaultJobs.jobId, jobId),
          eq(schema.contentEncryptedVaultJobs.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaultJobs.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaultJobs.orgId, scope.orgId),
        ),
      )
      .limit(1);
    return row ? metadataFromRow(row) : null;
  },
  persist: async (scope, job, stage) => {
    const row = {
      version: 1 as const,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      jobId: job.jobId,
      vaultId: scope.vaultId,
      grantId: job.grantId,
      recipientEndpointId: job.recipientEndpointId,
      epoch: job.epoch,
      algorithmId: job.algorithmId,
      ciphertextByteLength: job.ciphertextByteLength,
      issuedAt: job.issuedAt,
      expiresAt: job.expiresAt,
      jobState: job.state,
      retryCount: job.retryCount,
      retryAt: job.retryAt,
      leaseExpiresAt: job.leaseExpiresAt,
      serverReceivedAt: job.serverReceivedAt,
    };
    validatePrivateVaultJobRow(row);
    return getDb().transaction(async (tx) => {
      const [vault] = await tx
        .select({ vaultId: schema.contentEncryptedVaults.vaultId })
        .from(schema.contentEncryptedVaults)
        .where(
          and(
            eq(schema.contentEncryptedVaults.vaultId, scope.vaultId),
            eq(schema.contentEncryptedVaults.ownerEmail, scope.ownerEmail),
            eq(schema.contentEncryptedVaults.orgId, scope.orgId),
            eq(schema.contentEncryptedVaults.vaultState, "active"),
          ),
        )
        .limit(1);
      if (!vault) throw new PrivateVaultJobNotFoundError();
      await tx
        .insert(schema.contentEncryptedVaultJobs)
        .values(row)
        .onConflictDoNothing();
      const [storedRow] = await tx
        .select()
        .from(schema.contentEncryptedVaultJobs)
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, job.jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, scope.vaultId),
            eq(schema.contentEncryptedVaultJobs.ownerEmail, scope.ownerEmail),
            eq(schema.contentEncryptedVaultJobs.orgId, scope.orgId),
          ),
        )
        .limit(1);
      const stored = storedRow ? metadataFromRow(storedRow) : null;
      if (!stored || !sameJob(stored, job)) {
        throw new PrivateVaultJobConflictError();
      }
      await commitPrivateVaultCiphertextStageInTransaction(
        tx,
        stage,
        job.serverReceivedAt,
      );
      return stored;
    });
  },
  list: async (scope) => {
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultJobs)
      .where(
        and(
          eq(schema.contentEncryptedVaultJobs.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaultJobs.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaultJobs.orgId, scope.orgId),
        ),
      )
      .orderBy(
        asc(schema.contentEncryptedVaultJobs.serverReceivedAt),
        asc(schema.contentEncryptedVaultJobs.jobId),
      );
    return rows.map(metadataFromRow);
  },
  cancel: async (scope, jobId, now) =>
    getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "cancelled", retryAt: null, leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, scope.vaultId),
            eq(schema.contentEncryptedVaultJobs.ownerEmail, scope.ownerEmail),
            eq(schema.contentEncryptedVaultJobs.orgId, scope.orgId),
            inArray(schema.contentEncryptedVaultJobs.jobState, [
              "queued",
              "leased",
              "acknowledged",
              "retry_wait",
            ]),
          ),
        )
        .returning();
      if (!row) return null;
      const metadata = metadataFromRow(row);
      await enqueuePrivateVaultRetentionItem(
        tx,
        buildPrivateVaultJobRetentionItem(scope, jobId, now),
      );
      return metadata;
    }),
  claim: async (principal, now, leaseExpiresAt) => {
    return getDb().transaction(async (tx) => {
      const [activeEndpoint] = await tx
        .select({
          endpointId: schema.contentEncryptedVaultEndpoints.endpointId,
        })
        .from(schema.contentEncryptedVaultEndpoints)
        .where(
          and(
            eq(
              schema.contentEncryptedVaultEndpoints.endpointId,
              principal.endpointId,
            ),
            eq(
              schema.contentEncryptedVaultEndpoints.vaultId,
              principal.vaultId,
            ),
            eq(
              schema.contentEncryptedVaultEndpoints.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultEndpoints.orgId, principal.orgId),
            eq(schema.contentEncryptedVaultEndpoints.endpointState, "online"),
          ),
        )
        .limit(1);
      if (!activeEndpoint) return null;
      const expiredRows = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "cancelled", retryAt: null, leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            lte(schema.contentEncryptedVaultJobs.expiresAt, now),
            inArray(schema.contentEncryptedVaultJobs.jobState, [
              "queued",
              "leased",
              "acknowledged",
              "retry_wait",
            ]),
          ),
        )
        .returning();
      expiredRows.forEach(metadataFromRow);
      if (expiredRows.length > 0) {
        await enqueuePrivateVaultRetentionItems(
          tx,
          expiredRows.map((row) =>
            buildPrivateVaultJobRetentionItem(principal, row.jobId, now),
          ),
        );
      }
      const readyRetryRows = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "queued", retryAt: null, leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "retry_wait"),
            lte(schema.contentEncryptedVaultJobs.retryAt, now),
          ),
        )
        .returning();
      readyRetryRows.forEach(metadataFromRow);
      const exhaustedLeaseRows = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "cancelled", leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "leased"),
            lte(schema.contentEncryptedVaultJobs.leaseExpiresAt, now),
            gte(
              schema.contentEncryptedVaultJobs.retryCount,
              PRIVATE_VAULT_JOB_MAX_RETRIES,
            ),
          ),
        )
        .returning();
      exhaustedLeaseRows.forEach(metadataFromRow);
      if (exhaustedLeaseRows.length > 0) {
        await enqueuePrivateVaultRetentionItems(
          tx,
          exhaustedLeaseRows.map((row) =>
            buildPrivateVaultJobRetentionItem(principal, row.jobId, now),
          ),
        );
      }
      const expiredLeaseRows = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({
          jobState: "queued",
          leaseExpiresAt: null,
          retryCount: sql`${schema.contentEncryptedVaultJobs.retryCount} + 1`,
        })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "leased"),
            lte(schema.contentEncryptedVaultJobs.leaseExpiresAt, now),
            lt(
              schema.contentEncryptedVaultJobs.retryCount,
              PRIVATE_VAULT_JOB_MAX_RETRIES,
            ),
          ),
        )
        .returning();
      expiredLeaseRows.forEach(metadataFromRow);
      const [candidate] = await tx
        .select()
        .from(schema.contentEncryptedVaultJobs)
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "queued"),
            gt(schema.contentEncryptedVaultJobs.expiresAt, now),
          ),
        )
        .orderBy(
          asc(schema.contentEncryptedVaultJobs.serverReceivedAt),
          asc(schema.contentEncryptedVaultJobs.jobId),
        )
        .limit(1);
      if (!candidate || Date.parse(candidate.expiresAt) <= Date.parse(now))
        return null;
      const [claimed] = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "leased", leaseExpiresAt })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, candidate.jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "queued"),
            eq(
              schema.contentEncryptedVaultJobs.retryCount,
              candidate.retryCount,
            ),
            gt(schema.contentEncryptedVaultJobs.expiresAt, now),
          ),
        )
        .returning();
      return claimed ? metadataFromRow(claimed) : null;
    });
  },
  acknowledge: async (principal, jobId, retryCount, now) =>
    getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "acknowledged", leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "leased"),
            eq(schema.contentEncryptedVaultJobs.retryCount, retryCount),
            gt(schema.contentEncryptedVaultJobs.leaseExpiresAt, now),
            gt(schema.contentEncryptedVaultJobs.expiresAt, now),
            activeEndpointPredicate(principal),
          ),
        )
        .returning();
      return row ? metadataFromRow(row) : null;
    }),
  retry: async (principal, jobId, retryCount, retryAt, now) => {
    if (retryCount >= PRIVATE_VAULT_JOB_MAX_RETRIES) return null;
    return getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({
          jobState: "retry_wait",
          retryCount: retryCount + 1,
          retryAt,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            or(
              eq(schema.contentEncryptedVaultJobs.jobState, "acknowledged"),
              and(
                eq(schema.contentEncryptedVaultJobs.jobState, "leased"),
                gt(schema.contentEncryptedVaultJobs.leaseExpiresAt, now),
              ),
            ),
            eq(schema.contentEncryptedVaultJobs.retryCount, retryCount),
            gt(schema.contentEncryptedVaultJobs.expiresAt, now),
            gt(schema.contentEncryptedVaultJobs.expiresAt, retryAt),
            activeEndpointPredicate(principal),
          ),
        )
        .returning();
      return row ? metadataFromRow(row) : null;
    });
  },
  requeue: async (principal, jobId, retryCount, now) =>
    getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: "queued", retryAt: null, leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "retry_wait"),
            eq(schema.contentEncryptedVaultJobs.retryCount, retryCount),
            lte(schema.contentEncryptedVaultJobs.retryAt, now),
            gt(schema.contentEncryptedVaultJobs.expiresAt, now),
            activeEndpointPredicate(principal),
          ),
        )
        .returning();
      return row ? metadataFromRow(row) : null;
    }),
  complete: async (principal, result, now, stage) =>
    getDb().transaction(async (tx) => {
      const [job] = await tx
        .update(schema.contentEncryptedVaultJobs)
        .set({ jobState: result.state, retryAt: null, leaseExpiresAt: null })
        .where(
          and(
            eq(schema.contentEncryptedVaultJobs.jobId, result.jobId),
            eq(schema.contentEncryptedVaultJobs.vaultId, principal.vaultId),
            eq(
              schema.contentEncryptedVaultJobs.ownerEmail,
              principal.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultJobs.orgId, principal.orgId),
            eq(
              schema.contentEncryptedVaultJobs.recipientEndpointId,
              principal.endpointId,
            ),
            eq(schema.contentEncryptedVaultJobs.jobState, "acknowledged"),
            eq(schema.contentEncryptedVaultJobs.retryCount, result.retryCount),
            eq(schema.contentEncryptedVaultJobs.epoch, result.epoch),
            eq(
              schema.contentEncryptedVaultJobs.algorithmId,
              result.algorithmId,
            ),
            gt(schema.contentEncryptedVaultJobs.expiresAt, now),
            activeEndpointPredicate(principal),
          ),
        )
        .returning();
      if (!job) return null;
      const resultRow = {
        version: 1 as const,
        jobId: result.jobId,
        vaultId: principal.vaultId,
        ownerEmail: principal.ownerEmail,
        orgId: principal.orgId,
        endpointId: principal.endpointId,
        epoch: result.epoch,
        jobHash: result.jobHash,
        algorithmId: result.algorithmId,
        ciphertextByteLength: result.ciphertextByteLength,
        jobState: result.state,
        serverReceivedAt: result.serverReceivedAt,
      };
      validatePrivateVaultJobResultRow(resultRow);
      await tx.insert(schema.contentEncryptedVaultJobResults).values(resultRow);
      await enqueuePrivateVaultRetentionItem(
        tx,
        buildPrivateVaultJobRetentionItem(principal, result.jobId, now),
      );
      await commitPrivateVaultCiphertextStageInTransaction(
        tx,
        stage,
        result.serverReceivedAt,
      );
      return metadataFromRow(job);
    }),
  getResult: async (scope, jobId) => {
    const [row] = await getDb()
      .select({
        vaultId: schema.contentEncryptedVaultJobResults.vaultId,
        ownerEmail: schema.contentEncryptedVaultJobResults.ownerEmail,
        orgId: schema.contentEncryptedVaultJobResults.orgId,
        version: schema.contentEncryptedVaultJobResults.version,
        jobId: schema.contentEncryptedVaultJobResults.jobId,
        endpointId: schema.contentEncryptedVaultJobResults.endpointId,
        epoch: schema.contentEncryptedVaultJobResults.epoch,
        jobHash: schema.contentEncryptedVaultJobResults.jobHash,
        algorithmId: schema.contentEncryptedVaultJobResults.algorithmId,
        ciphertextByteLength:
          schema.contentEncryptedVaultJobResults.ciphertextByteLength,
        jobState: schema.contentEncryptedVaultJobResults.jobState,
        retryCount: schema.contentEncryptedVaultJobs.retryCount,
        serverReceivedAt:
          schema.contentEncryptedVaultJobResults.serverReceivedAt,
      })
      .from(schema.contentEncryptedVaultJobResults)
      .innerJoin(
        schema.contentEncryptedVaultJobs,
        and(
          eq(
            schema.contentEncryptedVaultJobs.jobId,
            schema.contentEncryptedVaultJobResults.jobId,
          ),
          eq(
            schema.contentEncryptedVaultJobs.vaultId,
            schema.contentEncryptedVaultJobResults.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultJobs.ownerEmail,
            schema.contentEncryptedVaultJobResults.ownerEmail,
          ),
          eq(
            schema.contentEncryptedVaultJobs.orgId,
            schema.contentEncryptedVaultJobResults.orgId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.contentEncryptedVaultJobResults.jobId, jobId),
          eq(schema.contentEncryptedVaultJobResults.vaultId, scope.vaultId),
          eq(
            schema.contentEncryptedVaultJobResults.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultJobResults.orgId, scope.orgId),
        ),
      )
      .limit(1);
    if (!row) return null;
    validatePrivateVaultJobResultRow({
      version: row.version,
      vaultId: row.vaultId,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      jobId: row.jobId,
      endpointId: row.endpointId,
      epoch: row.epoch,
      jobHash: row.jobHash,
      algorithmId: row.algorithmId,
      ciphertextByteLength: row.ciphertextByteLength,
      jobState: row.jobState,
      serverReceivedAt: row.serverReceivedAt,
    });
    return {
      vaultId: row.vaultId,
      jobId: row.jobId,
      endpointId: row.endpointId,
      epoch: row.epoch,
      jobHash: row.jobHash,
      algorithmId: row.algorithmId,
      ciphertextByteLength: row.ciphertextByteLength,
      state: row.jobState as "completed" | "failed",
      retryCount: row.retryCount,
      serverReceivedAt: row.serverReceivedAt,
    };
  },
};

const coreBlobStore: PrivateVaultJobBlobStore = {
  put: putProtectedCiphertext,
  read: readProtectedCiphertextAt,
  delete: deleteProtectedCiphertextAt,
};

function emitJobSync(scope: PrivateVaultJobScope, jobId: string, type: string) {
  recordChange({
    source: "private-vault",
    type,
    key: jobId,
    owner: scope.ownerEmail,
    ...(scope.orgId ? { orgId: scope.orgId } : {}),
  });
}

export function createPrivateVaultJobService(
  options: {
    store?: PrivateVaultJobStore;
    blobs?: PrivateVaultJobBlobStore;
    now?: () => string;
    leaseMs?: number;
    emitSync?: typeof emitJobSync;
    staging?: PrivateVaultJobStagingService;
  } = {},
) {
  const store = options.store ?? sqlPrivateVaultJobStore;
  const blobs = options.blobs ?? coreBlobStore;
  const now = options.now ?? (() => new Date().toISOString());
  const leaseMs = options.leaseMs ?? PRIVATE_VAULT_DEFAULT_LEASE_MS;
  const emitSync = options.emitSync ?? emitJobSync;
  const staging = options.staging ?? privateVaultCiphertextStagingService;

  async function authorizeEnqueue(
    scopeInput: PrivateVaultJobScope,
    input: PrivateVaultJobInput,
  ) {
    const scope = normalizeScope(scopeInput);
    const parsed = privateVaultJobInputSchema.parse(input);
    const at = now();
    if (
      Date.parse(parsed.issuedAt) > Date.parse(at) ||
      Date.parse(parsed.expiresAt) <= Date.parse(at) ||
      !(await store.authorizeEnqueue(scope, parsed, at))
    )
      throw new PrivateVaultJobNotFoundError();
    return { scope, parsed };
  }

  return {
    authorizeEnqueue,
    async enqueue(
      scopeInput: PrivateVaultJobScope,
      input: PrivateVaultJobInput & { ciphertext: Uint8Array },
    ) {
      const { ciphertext, ...metadataInput } = input;
      const { scope, parsed } = await authorizeEnqueue(
        scopeInput,
        metadataInput,
      );
      if (
        !(ciphertext instanceof Uint8Array) ||
        ciphertext.byteLength !== parsed.ciphertextByteLength
      )
        throw new PrivateVaultJobConflictError();
      const job: PrivateVaultJobMetadata = {
        ...parsed,
        state: "queued",
        retryCount: 0,
        retryAt: null,
        leaseExpiresAt: null,
        serverReceivedAt: now(),
      };
      const coordinate = jobCoordinate(scope.vaultId, job.jobId, "request");
      const committed = await store.get(scope, job.jobId);
      if (committed) {
        if (!sameJob(committed, job)) {
          throw new PrivateVaultJobConflictError();
        }
        await blobs.put({
          coordinate,
          ciphertext,
          expectedByteLength: job.ciphertextByteLength,
        });
        return committed;
      }
      const stage = await staging.stage(scope, coordinate);
      const blob = await blobs.put({
        coordinate,
        ciphertext,
        expectedByteLength: job.ciphertextByteLength,
      });
      try {
        const stored = await store.persist(scope, job, stage);
        emitSync(scope, job.jobId, "job-queued");
        return stored;
      } catch (error) {
        const concurrent = await store.get(scope, job.jobId).catch(() => null);
        if (concurrent && sameJob(concurrent, job)) {
          return concurrent;
        }
        if (blob.created) await blobs.delete(coordinate).catch(() => undefined);
        throw error;
      }
    },
    async list(scopeInput: PrivateVaultJobScope) {
      return store.list(normalizeScope(scopeInput));
    },
    async cancel(scopeInput: PrivateVaultJobScope, jobId: string) {
      const scope = normalizeScope(scopeInput);
      const job = await store.cancel(scope, opaqueIdSchema.parse(jobId), now());
      if (!job) throw new PrivateVaultJobNotFoundError();
      emitSync(scope, job.jobId, "job-cancelled");
      return job;
    },
    async getRequest(
      principalInput: PrivateVaultEndpointPrincipal,
      jobId: string,
    ) {
      const principal = normalizeScope({
        ...principalInput,
        endpointId: opaqueIdSchema.parse(principalInput.endpointId),
      });
      if (!(await store.isActiveEndpoint(principal)))
        throw new PrivateVaultJobNotFoundError();
      const job = await store.get(principal, opaqueIdSchema.parse(jobId));
      if (
        !job ||
        job.recipientEndpointId !== principal.endpointId ||
        !["leased", "acknowledged"].includes(job.state)
      )
        throw new PrivateVaultJobNotFoundError();
      const stored = await blobs.read(
        jobCoordinate(job.vaultId, job.jobId, "request"),
      );
      if (
        stored.byteLength !== job.ciphertextByteLength ||
        stored.ciphertext.byteLength !== job.ciphertextByteLength
      )
        throw new PrivateVaultJobConflictError();
      return { job, ...stored };
    },
    async claim(principalInput: PrivateVaultEndpointPrincipal) {
      const principal = normalizeScope({
        ...principalInput,
        endpointId: opaqueIdSchema.parse(principalInput.endpointId),
      });
      if (!(await store.isActiveEndpoint(principal))) return null;
      const at = now();
      return store.claim(
        principal,
        at,
        new Date(Date.parse(at) + leaseMs).toISOString(),
      );
    },
    async acknowledge(
      principalInput: PrivateVaultEndpointPrincipal,
      jobId: string,
      retryCount: number,
    ) {
      const principal = normalizeScope({
        ...principalInput,
        endpointId: opaqueIdSchema.parse(principalInput.endpointId),
      });
      if (!(await store.isActiveEndpoint(principal)))
        throw new PrivateVaultJobConflictError();
      const job = await store.acknowledge(
        principal,
        opaqueIdSchema.parse(jobId),
        retryCount,
        now(),
      );
      if (!job) throw new PrivateVaultJobConflictError();
      emitSync(principal, job.jobId, "job-acknowledged");
      return job;
    },
    async retry(
      principalInput: PrivateVaultEndpointPrincipal,
      jobId: string,
      retryCount: number,
      retryAt: string,
    ) {
      const principal = normalizeScope({
        ...principalInput,
        endpointId: opaqueIdSchema.parse(principalInput.endpointId),
      });
      protocolTimestampSchema.parse(retryAt);
      const at = now();
      if (
        Date.parse(retryAt) <= Date.parse(at) ||
        !(await store.isActiveEndpoint(principal))
      )
        throw new PrivateVaultJobConflictError();
      const job = await store.retry(
        principal,
        opaqueIdSchema.parse(jobId),
        retryCount,
        retryAt,
        at,
      );
      if (!job) throw new PrivateVaultJobConflictError();
      emitSync(principal, job.jobId, "job-retry-wait");
      return job;
    },
    async requeue(
      principalInput: PrivateVaultEndpointPrincipal,
      jobId: string,
      retryCount: number,
    ) {
      const principal = normalizeScope({
        ...principalInput,
        endpointId: opaqueIdSchema.parse(principalInput.endpointId),
      });
      if (!(await store.isActiveEndpoint(principal)))
        throw new PrivateVaultJobConflictError();
      const job = await store.requeue(
        principal,
        opaqueIdSchema.parse(jobId),
        retryCount,
        now(),
      );
      if (!job) throw new PrivateVaultJobConflictError();
      emitSync(principal, job.jobId, "job-queued");
      return job;
    },
    async submitResult(
      principalInput: PrivateVaultEndpointPrincipal,
      input: PrivateVaultJobResultInput & { ciphertext: Uint8Array },
    ) {
      const principal = normalizeScope({
        ...principalInput,
        endpointId: opaqueIdSchema.parse(principalInput.endpointId),
      });
      if (!(await store.isActiveEndpoint(principal)))
        throw new PrivateVaultJobConflictError();
      const { ciphertext, ...metadataInput } = input;
      const parsed = privateVaultJobResultInputSchema.parse(metadataInput);
      if (
        parsed.vaultId !== principal.vaultId ||
        !(ciphertext instanceof Uint8Array) ||
        ciphertext.byteLength !== parsed.ciphertextByteLength
      )
        throw new PrivateVaultJobConflictError();
      const receivedAt = now();
      const result: PrivateVaultJobResultMetadata = {
        ...parsed,
        endpointId: principal.endpointId,
        serverReceivedAt: receivedAt,
      };
      /*
       * `jobHash` is deliberately opaque to the PR4 hosted relay. The PR5
       * authenticated broker/client must recompute and verify it against the
       * decrypted signed request before accepting a result; this server only
       * fences the endpoint, attempt, epoch, suite, and immutable result slot.
       */
      const coordinate = jobCoordinate(
        principal.vaultId,
        parsed.jobId,
        "result",
      );
      const committed = await store.getResult(principal, parsed.jobId);
      if (committed) {
        if (!sameJobResult(committed, result)) {
          throw new PrivateVaultJobConflictError();
        }
        await blobs.put({
          coordinate,
          ciphertext,
          expectedByteLength: parsed.ciphertextByteLength,
        });
        return committed;
      }
      const stage = await staging.stage(principal, coordinate);
      const blob = await blobs.put({
        coordinate,
        ciphertext,
        expectedByteLength: parsed.ciphertextByteLength,
      });
      try {
        const completed = await store.complete(
          principal,
          result,
          receivedAt,
          stage,
        );
        if (!completed) throw new PrivateVaultJobConflictError();
        emitSync(principal, parsed.jobId, `job-${parsed.state}`);
        return result;
      } catch (error) {
        const existing = await store
          .getResult(principal, parsed.jobId)
          .catch(() => null);
        if (existing && sameJobResult(existing, result)) {
          return existing;
        }
        if (blob.created) await blobs.delete(coordinate).catch(() => undefined);
        throw error;
      }
    },
    async getResult(scopeInput: PrivateVaultJobScope, jobId: string) {
      const scope = normalizeScope(scopeInput);
      const result = await store.getResult(scope, opaqueIdSchema.parse(jobId));
      if (!result) throw new PrivateVaultJobNotFoundError();
      const stored = await blobs.read(
        jobCoordinate(scope.vaultId, result.jobId, "result"),
      );
      if (
        stored.byteLength !== result.ciphertextByteLength ||
        stored.ciphertext.byteLength !== result.ciphertextByteLength
      )
        throw new PrivateVaultJobConflictError();
      return { result, ...stored };
    },
  };
}

export const privateVaultJobService = createPrivateVaultJobService();

export function decodePrivateVaultJobCiphertext(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new PrivateVaultJobConflictError();
  return Uint8Array.from(Buffer.from(value, "base64"));
}
