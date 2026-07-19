import { randomUUID } from "node:crypto";

import {
  E2EE_SUITE_ID,
  opaqueIdSchema,
  opaqueRevisionSchema,
} from "@agent-native/core/e2ee";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  deleteProtectedCiphertextAt,
  deleteProtectedCiphertextPrefix,
  ProtectedCiphertextCollisionError,
  putProtectedCiphertext,
  readProtectedCiphertextAt,
  type ProtectedCiphertextPutResult,
} from "@agent-native/core/protected-ciphertext";
import { recordChange } from "@agent-native/core/server";
import {
  getRequestAuthSource,
  getRequestOrgId,
  getRequestStableUserId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { CONTENT_PRIVATE_VAULT_ACCESS_FLAG } from "../../shared/private-vault-feature-flags.js";
import {
  validatePrivateVaultObjectRow,
  validatePrivateVaultRevisionRow,
  validatePrivateVaultSyncEventRow,
} from "../../shared/private-vault-hosted-records.js";
import { getDb, schema } from "../db/index.js";
import {
  commitPrivateVaultCiphertextStageInTransaction,
  privateVaultCiphertextStagingService,
  type PrivateVaultCiphertextStage,
  type PrivateVaultStageCoordinate,
} from "./private-vault-ciphertext-staging.js";
import { resolvePrivateVaultScopeForStableIdentity } from "./private-vault-genesis-account-scope.js";
import {
  buildPrivateVaultRetentionItem,
  enqueuePrivateVaultRetentionItem,
} from "./private-vault-retention.js";

export const PRIVATE_VAULT_OBJECT_MAX_BYTES = 256 * 1024 * 1024;
export const PRIVATE_VAULT_ACTION_MAX_BYTES = 1024 * 1024;

const objectTypeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9._:-]*$/);

export const privateVaultObjectRevisionInputSchema = z
  .object({
    vaultId: opaqueIdSchema,
    objectId: opaqueIdSchema,
    revisionId: opaqueIdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    objectType: objectTypeSchema,
    algorithmId: z.literal(E2EE_SUITE_ID),
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    parentRevisionIds: z.array(opaqueIdSchema).max(32).default([]),
    ciphertextByteLength: z
      .number()
      .int()
      .positive()
      .max(PRIVATE_VAULT_OBJECT_MAX_BYTES),
  })
  .strict();

export type PrivateVaultObjectRevisionInput = z.infer<
  typeof privateVaultObjectRevisionInputSchema
>;

export interface PrivateVaultScope {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
}

export async function requirePrivateVaultActionScope(
  vaultId: string,
): Promise<PrivateVaultScope> {
  if (getRequestAuthSource() !== "better-auth") {
    throw new PrivateVaultObjectNotFoundError();
  }
  const userId = getRequestStableUserId();
  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  if (!userId || !ownerEmail || !orgId) {
    throw new PrivateVaultObjectNotFoundError();
  }
  if (
    !(await isFeatureFlagEnabled(CONTENT_PRIVATE_VAULT_ACCESS_FLAG, {
      userEmail: ownerEmail.trim().toLowerCase(),
      userKey: userId,
      orgId,
    }))
  ) {
    throw new PrivateVaultObjectNotFoundError();
  }
  const scope = await resolvePrivateVaultScopeForStableIdentity({
    userId,
    email: ownerEmail,
    orgId,
    vaultId,
  });
  if (!scope) throw new PrivateVaultObjectNotFoundError();
  return scope;
}

export interface PrivateVaultRevisionMetadata extends PrivateVaultObjectRevisionInput {
  serverReceivedAt: string;
}

export interface PrivateVaultObjectIndexEntry {
  objectId: string;
  objectType: string;
  latestRevision: PrivateVaultRevisionMetadata;
}

interface StoredObject {
  objectId: string;
  objectType: string;
  objectState: string;
}

export interface PrivateVaultObjectStore {
  requireActiveVault(scope: PrivateVaultScope): Promise<boolean>;
  getObject(
    scope: PrivateVaultScope,
    objectId: string,
  ): Promise<StoredObject | null>;
  getRevision(
    scope: PrivateVaultScope,
    objectId: string,
    revisionId: string,
  ): Promise<PrivateVaultRevisionMetadata | null>;
  persistRevision(
    scope: PrivateVaultScope,
    metadata: PrivateVaultRevisionMetadata,
    eventId: string,
    stage: PrivateVaultCiphertextStage,
  ): Promise<PrivateVaultRevisionMetadata>;
  listRevisions(
    scope: PrivateVaultScope,
    objectId: string,
  ): Promise<PrivateVaultRevisionMetadata[]>;
  listObjects(
    scope: PrivateVaultScope,
  ): Promise<PrivateVaultObjectIndexEntry[]>;
  beginDelete(
    scope: PrivateVaultScope,
    objectId: string,
    eventId: string,
    serverReceivedAt: string,
  ): Promise<StoredObject | null>;
  finishDelete(
    scope: PrivateVaultScope,
    objectId: string,
    eventId: string,
    serverReceivedAt: string,
  ): Promise<void>;
}

function validatedObjectWrite<T extends Record<string, unknown>>(row: T): T {
  validatePrivateVaultObjectRow({ version: 1, ...row });
  return row;
}

function validatedRevisionWrite<T extends Record<string, unknown>>(row: T): T {
  validatePrivateVaultRevisionRow({ version: 1, ...row });
  return row;
}

function validatedSyncWrite<T extends Record<string, unknown>>(row: T): T {
  validatePrivateVaultSyncEventRow({ version: 1, ...row });
  return row;
}

export interface PrivateVaultObjectBlobStore {
  put(input: {
    coordinate: {
      kind: "object";
      vaultId: string;
      objectId: string;
      revisionId: string;
      part: "header";
    };
    ciphertext: Uint8Array;
    expectedByteLength: number;
  }): Promise<ProtectedCiphertextPutResult>;
  read(coordinate: {
    kind: "object";
    vaultId: string;
    objectId: string;
    revisionId: string;
    part: "header";
  }): Promise<{ ciphertext: Uint8Array; byteLength: number }>;
  delete(coordinate: {
    kind: "object";
    vaultId: string;
    objectId: string;
    revisionId: string;
    part: "header";
  }): Promise<{ deleted: boolean }>;
  deleteObject(prefix: {
    scope: "object";
    vaultId: string;
    objectId: string;
  }): Promise<{ deleted: number }>;
}

export interface PrivateVaultObjectStagingStore {
  stage(
    scope: PrivateVaultScope,
    coordinate: PrivateVaultStageCoordinate,
  ): Promise<PrivateVaultCiphertextStage>;
  clearAfterMetadataCommit(entry: PrivateVaultCiphertextStage): Promise<void>;
}

export class PrivateVaultObjectNotFoundError extends Error {
  constructor() {
    super("Private Vault object was not found");
    this.name = "PrivateVaultObjectNotFoundError";
  }
}

export class PrivateVaultObjectConflictError extends Error {
  constructor(
    message = "Private Vault object revision conflicts with stored metadata",
  ) {
    super(message);
    this.name = "PrivateVaultObjectConflictError";
  }
}

function normalizeScope(input: PrivateVaultScope): PrivateVaultScope {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail || ownerEmail.length > 320) {
    throw new PrivateVaultObjectNotFoundError();
  }
  return {
    ownerEmail,
    orgId: input.orgId.trim(),
    vaultId: opaqueIdSchema.parse(input.vaultId),
  };
}

function coordinate(
  metadata: Pick<
    PrivateVaultRevisionMetadata,
    "vaultId" | "objectId" | "revisionId"
  >,
) {
  return {
    kind: "object" as const,
    vaultId: metadata.vaultId,
    objectId: metadata.objectId,
    revisionId: metadata.revisionId,
    part: "header" as const,
  };
}

function sameRevision(
  stored: PrivateVaultRevisionMetadata,
  requested: PrivateVaultRevisionMetadata,
): boolean {
  return (
    stored.vaultId === requested.vaultId &&
    stored.objectId === requested.objectId &&
    stored.revisionId === requested.revisionId &&
    stored.objectType === requested.objectType &&
    stored.algorithmId === requested.algorithmId &&
    stored.epoch === requested.epoch &&
    stored.ciphertextByteLength === requested.ciphertextByteLength &&
    JSON.stringify(stored.parentRevisionIds) ===
      JSON.stringify(requested.parentRevisionIds)
  );
}

function parseRevisionRow(
  row: {
    vaultId: string;
    objectId: string;
    revisionId: string;
    epoch: number;
    algorithmId: string;
    ciphertextByteLength: number;
    opaqueRevisionJson: string;
    serverReceivedAt: string;
  },
  objectType: string,
): PrivateVaultRevisionMetadata {
  const opaque = opaqueRevisionSchema.parse(JSON.parse(row.opaqueRevisionJson));
  return privateVaultObjectRevisionInputSchema.parse({
    vaultId: row.vaultId,
    objectId: row.objectId,
    revisionId: row.revisionId,
    revision: opaque.revision,
    objectType,
    algorithmId: row.algorithmId,
    epoch: row.epoch,
    parentRevisionIds: opaque.parentRevisionIds,
    ciphertextByteLength: row.ciphertextByteLength,
  }) as PrivateVaultRevisionMetadata & { serverReceivedAt: string };
}

function rowMetadata(
  row: Parameters<typeof parseRevisionRow>[0],
  objectType: string,
): PrivateVaultRevisionMetadata {
  return {
    ...parseRevisionRow(row, objectType),
    serverReceivedAt: row.serverReceivedAt,
  };
}

export const sqlPrivateVaultObjectStore: PrivateVaultObjectStore = {
  requireActiveVault: async (scope) => {
    const [vault] = await getDb()
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
    return Boolean(vault);
  },
  getObject: async (scope, objectId) => {
    const [object] = await getDb()
      .select({
        objectId: schema.contentEncryptedVaultObjects.objectId,
        objectType: schema.contentEncryptedVaultObjects.objectType,
        objectState: schema.contentEncryptedVaultObjects.objectState,
      })
      .from(schema.contentEncryptedVaultObjects)
      .where(
        and(
          eq(schema.contentEncryptedVaultObjects.objectId, objectId),
          eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaultObjects.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
        ),
      )
      .limit(1);
    return object ?? null;
  },
  getRevision: async (scope, objectId, revisionId) => {
    const object = await sqlPrivateVaultObjectStore.getObject(scope, objectId);
    if (!object) return null;
    const [row] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultObjectRevisions)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultObjectRevisions.revisionId,
            revisionId,
          ),
          eq(schema.contentEncryptedVaultObjectRevisions.objectId, objectId),
          eq(
            schema.contentEncryptedVaultObjectRevisions.vaultId,
            scope.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultObjectRevisions.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultObjectRevisions.orgId, scope.orgId),
        ),
      )
      .limit(1);
    return row ? rowMetadata(row, object.objectType) : null;
  },
  persistRevision: async (scope, metadata, eventId, stage) => {
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
      if (!vault) throw new PrivateVaultObjectNotFoundError();

      const [existingObject] = await tx
        .select()
        .from(schema.contentEncryptedVaultObjects)
        .where(
          and(
            eq(schema.contentEncryptedVaultObjects.objectId, metadata.objectId),
            eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
            eq(
              schema.contentEncryptedVaultObjects.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
          ),
        )
        .limit(1);
      if (
        existingObject &&
        (existingObject.objectState !== "active" ||
          existingObject.objectType !== metadata.objectType)
      ) {
        throw new PrivateVaultObjectConflictError();
      }
      if (!existingObject) {
        await tx
          .insert(schema.contentEncryptedVaultObjects)
          .values(
            validatedObjectWrite({
              objectId: metadata.objectId,
              vaultId: scope.vaultId,
              ownerEmail: scope.ownerEmail,
              orgId: scope.orgId,
              objectType: metadata.objectType,
              objectState: "active",
              serverReceivedAt: metadata.serverReceivedAt,
            }),
          )
          .onConflictDoNothing();
        const [claimedObject] = await tx
          .select()
          .from(schema.contentEncryptedVaultObjects)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultObjects.objectId,
                metadata.objectId,
              ),
              eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
              eq(
                schema.contentEncryptedVaultObjects.ownerEmail,
                scope.ownerEmail,
              ),
              eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
            ),
          )
          .limit(1);
        if (
          !claimedObject ||
          claimedObject.objectState !== "active" ||
          claimedObject.objectType !== metadata.objectType
        ) {
          throw new PrivateVaultObjectConflictError();
        }
      }

      const [existingRevision] = await tx
        .select()
        .from(schema.contentEncryptedVaultObjectRevisions)
        .where(
          and(
            eq(
              schema.contentEncryptedVaultObjectRevisions.revisionId,
              metadata.revisionId,
            ),
            eq(
              schema.contentEncryptedVaultObjectRevisions.objectId,
              metadata.objectId,
            ),
            eq(
              schema.contentEncryptedVaultObjectRevisions.vaultId,
              scope.vaultId,
            ),
            eq(
              schema.contentEncryptedVaultObjectRevisions.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultObjectRevisions.orgId, scope.orgId),
          ),
        )
        .limit(1);
      if (existingRevision) {
        const parsed = rowMetadata(existingRevision, metadata.objectType);
        if (!sameRevision(parsed, metadata)) {
          throw new PrivateVaultObjectConflictError();
        }
        await commitPrivateVaultCiphertextStageInTransaction(
          tx,
          stage,
          metadata.serverReceivedAt,
        );
        return parsed;
      }

      const opaqueRevision = opaqueRevisionSchema.parse({
        version: 1,
        vaultId: metadata.vaultId,
        objectId: metadata.objectId,
        revisionId: metadata.revisionId,
        revision: metadata.revision,
        parentRevisionIds: metadata.parentRevisionIds,
        epoch: metadata.epoch,
        ciphertextByteLength: metadata.ciphertextByteLength,
        serverReceivedAt: metadata.serverReceivedAt,
      });
      const opaqueRevisionJson = JSON.stringify(opaqueRevision);
      const inserted = await tx
        .insert(schema.contentEncryptedVaultObjectRevisions)
        .values(
          validatedRevisionWrite({
            revisionId: metadata.revisionId,
            vaultId: scope.vaultId,
            objectId: metadata.objectId,
            ownerEmail: scope.ownerEmail,
            orgId: scope.orgId,
            epoch: metadata.epoch,
            algorithmId: metadata.algorithmId,
            ciphertextByteLength: metadata.ciphertextByteLength,
            opaqueRevisionJson,
            serverReceivedAt: metadata.serverReceivedAt,
          }),
        )
        .onConflictDoNothing()
        .returning({
          revisionId: schema.contentEncryptedVaultObjectRevisions.revisionId,
        });
      if (inserted.length === 0) {
        const [concurrentRevision] = await tx
          .select()
          .from(schema.contentEncryptedVaultObjectRevisions)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultObjectRevisions.revisionId,
                metadata.revisionId,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.objectId,
                metadata.objectId,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.vaultId,
                scope.vaultId,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.ownerEmail,
                scope.ownerEmail,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.orgId,
                scope.orgId,
              ),
            ),
          )
          .limit(1);
        if (!concurrentRevision) throw new PrivateVaultObjectConflictError();
        const parsed = rowMetadata(concurrentRevision, metadata.objectType);
        if (!sameRevision(parsed, metadata)) {
          throw new PrivateVaultObjectConflictError();
        }
        await commitPrivateVaultCiphertextStageInTransaction(
          tx,
          stage,
          metadata.serverReceivedAt,
        );
        return parsed;
      }
      await tx.insert(schema.contentEncryptedVaultSyncEvents).values(
        validatedSyncWrite({
          eventId,
          vaultId: scope.vaultId,
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          objectId: metadata.objectId,
          eventType: "object-revision",
          opaqueRevisionJson,
          serverReceivedAt: metadata.serverReceivedAt,
        }),
      );
      await commitPrivateVaultCiphertextStageInTransaction(
        tx,
        stage,
        metadata.serverReceivedAt,
      );
      return metadata;
    });
  },
  listRevisions: async (scope, objectId) => {
    const object = await sqlPrivateVaultObjectStore.getObject(scope, objectId);
    if (!object || object.objectState !== "active") {
      throw new PrivateVaultObjectNotFoundError();
    }
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultObjectRevisions)
      .where(
        and(
          eq(schema.contentEncryptedVaultObjectRevisions.objectId, objectId),
          eq(
            schema.contentEncryptedVaultObjectRevisions.vaultId,
            scope.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultObjectRevisions.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultObjectRevisions.orgId, scope.orgId),
        ),
      )
      .orderBy(
        asc(schema.contentEncryptedVaultObjectRevisions.serverReceivedAt),
        asc(schema.contentEncryptedVaultObjectRevisions.revisionId),
      );
    return rows.map((row) => rowMetadata(row, object.objectType));
  },
  listObjects: async (scope) => {
    const objects = await getDb()
      .select({
        objectId: schema.contentEncryptedVaultObjects.objectId,
        objectType: schema.contentEncryptedVaultObjects.objectType,
      })
      .from(schema.contentEncryptedVaultObjects)
      .where(
        and(
          eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
          eq(schema.contentEncryptedVaultObjects.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
          eq(schema.contentEncryptedVaultObjects.objectState, "active"),
        ),
      )
      .orderBy(asc(schema.contentEncryptedVaultObjects.objectId))
      .limit(10_001);
    if (objects.length > 10_000) {
      throw new PrivateVaultObjectConflictError(
        "Private Vault object index requires pagination",
      );
    }
    const revisions = await getDb()
      .select()
      .from(schema.contentEncryptedVaultObjectRevisions)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultObjectRevisions.vaultId,
            scope.vaultId,
          ),
          eq(
            schema.contentEncryptedVaultObjectRevisions.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultObjectRevisions.orgId, scope.orgId),
        ),
      )
      .orderBy(
        asc(schema.contentEncryptedVaultObjectRevisions.objectId),
        asc(schema.contentEncryptedVaultObjectRevisions.serverReceivedAt),
        asc(schema.contentEncryptedVaultObjectRevisions.revisionId),
      )
      .limit(100_001);
    if (revisions.length > 100_000) {
      throw new PrivateVaultObjectConflictError(
        "Private Vault revision index requires pagination",
      );
    }
    const objectTypes = new Map(
      objects.map((object) => [object.objectId, object.objectType]),
    );
    const latest = new Map<string, PrivateVaultRevisionMetadata>();
    for (const row of revisions) {
      const objectType = objectTypes.get(row.objectId);
      if (objectType) latest.set(row.objectId, rowMetadata(row, objectType));
    }
    return objects.flatMap((object) => {
      const latestRevision = latest.get(object.objectId);
      return latestRevision ? [{ ...object, latestRevision }] : [];
    });
  },
  beginDelete: async (scope, objectId, eventId, serverReceivedAt) => {
    return getDb().transaction(async (tx) => {
      const [object] = await tx
        .select()
        .from(schema.contentEncryptedVaultObjects)
        .where(
          and(
            eq(schema.contentEncryptedVaultObjects.objectId, objectId),
            eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
            eq(
              schema.contentEncryptedVaultObjects.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
          ),
        )
        .limit(1);
      if (!object) return null;
      if (object.objectState === "active") {
        validatedObjectWrite({
          objectId: object.objectId,
          vaultId: object.vaultId,
          ownerEmail: object.ownerEmail,
          orgId: object.orgId,
          objectType: object.objectType,
          objectState: "delete_pending",
          serverReceivedAt: object.serverReceivedAt,
        });
        await tx
          .update(schema.contentEncryptedVaultObjects)
          .set({ objectState: "delete_pending" })
          .where(
            and(
              eq(schema.contentEncryptedVaultObjects.objectId, objectId),
              eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
              eq(
                schema.contentEncryptedVaultObjects.ownerEmail,
                scope.ownerEmail,
              ),
              eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
            ),
          );
        await tx.insert(schema.contentEncryptedVaultSyncEvents).values(
          validatedSyncWrite({
            eventId,
            vaultId: scope.vaultId,
            ownerEmail: scope.ownerEmail,
            orgId: scope.orgId,
            objectId,
            eventType: "object-delete-pending",
            opaqueRevisionJson: null,
            serverReceivedAt,
          }),
        );
        return { ...object, objectState: "delete_pending" };
      }
      return object;
    });
  },
  finishDelete: async (scope, objectId, eventId, serverReceivedAt) => {
    await getDb().transaction(async (tx) => {
      const [object] = await tx
        .select()
        .from(schema.contentEncryptedVaultObjects)
        .where(
          and(
            eq(schema.contentEncryptedVaultObjects.objectId, objectId),
            eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
            eq(
              schema.contentEncryptedVaultObjects.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
            eq(
              schema.contentEncryptedVaultObjects.objectState,
              "delete_pending",
            ),
          ),
        )
        .limit(1);
      if (!object) return;
      validatedObjectWrite({
        objectId: object.objectId,
        vaultId: object.vaultId,
        ownerEmail: object.ownerEmail,
        orgId: object.orgId,
        objectType: object.objectType,
        objectState: "deleted",
        serverReceivedAt: object.serverReceivedAt,
      });
      await tx
        .update(schema.contentEncryptedVaultObjects)
        .set({ objectState: "deleted" })
        .where(
          and(
            eq(schema.contentEncryptedVaultObjects.objectId, objectId),
            eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
            eq(
              schema.contentEncryptedVaultObjects.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
            eq(
              schema.contentEncryptedVaultObjects.objectState,
              "delete_pending",
            ),
          ),
        );
      await tx.insert(schema.contentEncryptedVaultSyncEvents).values(
        validatedSyncWrite({
          eventId,
          vaultId: scope.vaultId,
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          objectId,
          eventType: "object-deleted",
          opaqueRevisionJson: null,
          serverReceivedAt,
        }),
      );
      await enqueuePrivateVaultRetentionItem(
        tx,
        buildPrivateVaultRetentionItem({
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          vaultId: scope.vaultId,
          resourceKind: "object",
          resourceId: objectId,
          epoch: null,
          triggerAt: serverReceivedAt,
        }),
      );
    });
  },
};

const coreBlobStore: PrivateVaultObjectBlobStore = {
  put: putProtectedCiphertext,
  read: readProtectedCiphertextAt,
  delete: deleteProtectedCiphertextAt,
  deleteObject: deleteProtectedCiphertextPrefix,
};

function emitObjectSync(
  scope: PrivateVaultScope,
  objectId: string,
  type: "object-revision" | "object-delete-pending" | "object-deleted",
) {
  recordChange({
    source: "private-vault",
    type,
    key: objectId,
    owner: scope.ownerEmail,
    ...(scope.orgId ? { orgId: scope.orgId } : {}),
  });
}

export function createPrivateVaultObjectService(
  options: {
    store?: PrivateVaultObjectStore;
    blobs?: PrivateVaultObjectBlobStore;
    now?: () => string;
    eventId?: () => string;
    emitSync?: typeof emitObjectSync;
    staging?: PrivateVaultObjectStagingStore;
  } = {},
) {
  const store = options.store ?? sqlPrivateVaultObjectStore;
  const blobs = options.blobs ?? coreBlobStore;
  const now = options.now ?? (() => new Date().toISOString());
  const eventId = options.eventId ?? randomUUID;
  const emitSync = options.emitSync ?? emitObjectSync;
  const staging = options.staging ?? privateVaultCiphertextStagingService;

  async function authorizePut(
    scopeInput: PrivateVaultScope,
    input: PrivateVaultObjectRevisionInput,
  ) {
    const scope = normalizeScope(scopeInput);
    const parsed = privateVaultObjectRevisionInputSchema.parse(input);
    if (!(await store.requireActiveVault(scope))) {
      throw new PrivateVaultObjectNotFoundError();
    }
    const existingObject = await store.getObject(scope, parsed.objectId);
    if (
      existingObject &&
      (existingObject.objectState !== "active" ||
        existingObject.objectType !== parsed.objectType)
    ) {
      throw new PrivateVaultObjectConflictError();
    }
    return { scope, parsed };
  }

  return {
    authorizePut,
    async putRevision(
      scopeInput: PrivateVaultScope,
      input: PrivateVaultObjectRevisionInput & { ciphertext: Uint8Array },
    ) {
      const { ciphertext, ...metadataInput } = input;
      const { scope, parsed } = await authorizePut(scopeInput, metadataInput);
      if (
        !(ciphertext instanceof Uint8Array) ||
        ciphertext.byteLength !== parsed.ciphertextByteLength
      ) {
        throw new PrivateVaultObjectConflictError(
          "Ciphertext length does not match revision metadata",
        );
      }
      const receivedAt = now();
      const metadata: PrivateVaultRevisionMetadata = {
        ...parsed,
        serverReceivedAt: receivedAt,
      };
      const committed = await store.getRevision(
        scope,
        parsed.objectId,
        parsed.revisionId,
      );
      if (committed) {
        if (!sameRevision(committed, metadata)) {
          throw new PrivateVaultObjectConflictError();
        }
        try {
          // Lost-response retries verify immutable equal bytes at the provider
          // instead of reopening the terminal staging coordinate.
          await blobs.put({
            coordinate: coordinate(metadata),
            ciphertext,
            expectedByteLength: parsed.ciphertextByteLength,
          });
        } catch (error) {
          if (error instanceof ProtectedCiphertextCollisionError) {
            throw new PrivateVaultObjectConflictError();
          }
          throw error;
        }
        return committed;
      }
      const staged = await staging.stage(scope, coordinate(metadata));
      let blob: ProtectedCiphertextPutResult;
      try {
        blob = await blobs.put({
          coordinate: coordinate(metadata),
          ciphertext,
          expectedByteLength: parsed.ciphertextByteLength,
        });
      } catch (error) {
        if (error instanceof ProtectedCiphertextCollisionError) {
          throw new PrivateVaultObjectConflictError();
        }
        throw error;
      }
      try {
        const persisted = await store.persistRevision(
          scope,
          metadata,
          eventId(),
          staged,
        );
        emitSync(scope, parsed.objectId, "object-revision");
        return persisted;
      } catch (error) {
        const concurrent = await store
          .getRevision(scope, parsed.objectId, parsed.revisionId)
          .catch(() => null);
        if (concurrent && sameRevision(concurrent, metadata)) {
          return concurrent;
        }
        if (blob.created) {
          await blobs.delete(coordinate(metadata)).catch(() => undefined);
        }
        throw error;
      }
    },

    async getMetadata(
      scopeInput: PrivateVaultScope,
      objectIdInput: string,
      revisionIdInput: string,
    ) {
      const scope = normalizeScope(scopeInput);
      const objectId = opaqueIdSchema.parse(objectIdInput);
      const revisionId = opaqueIdSchema.parse(revisionIdInput);
      if (!(await store.requireActiveVault(scope))) {
        throw new PrivateVaultObjectNotFoundError();
      }
      const object = await store.getObject(scope, objectId);
      if (!object || object.objectState !== "active") {
        throw new PrivateVaultObjectNotFoundError();
      }
      const revision = await store.getRevision(scope, objectId, revisionId);
      if (!revision) throw new PrivateVaultObjectNotFoundError();
      return revision;
    },

    async getRevision(
      scopeInput: PrivateVaultScope,
      objectId: string,
      revisionId: string,
    ) {
      const metadata = await this.getMetadata(scopeInput, objectId, revisionId);
      const blob = await blobs.read(coordinate(metadata));
      if (blob.byteLength !== metadata.ciphertextByteLength) {
        throw new PrivateVaultObjectConflictError(
          "Stored ciphertext length does not match revision metadata",
        );
      }
      return { metadata, ciphertext: blob.ciphertext };
    },

    async listRevisions(scopeInput: PrivateVaultScope, objectIdInput: string) {
      const scope = normalizeScope(scopeInput);
      const objectId = opaqueIdSchema.parse(objectIdInput);
      if (!(await store.requireActiveVault(scope))) {
        throw new PrivateVaultObjectNotFoundError();
      }
      return store.listRevisions(scope, objectId);
    },

    async listObjects(scopeInput: PrivateVaultScope) {
      const scope = normalizeScope(scopeInput);
      if (!(await store.requireActiveVault(scope))) {
        throw new PrivateVaultObjectNotFoundError();
      }
      return store.listObjects(scope);
    },

    async deleteObject(scopeInput: PrivateVaultScope, objectIdInput: string) {
      const scope = normalizeScope(scopeInput);
      const objectId = opaqueIdSchema.parse(objectIdInput);
      if (!(await store.requireActiveVault(scope))) {
        throw new PrivateVaultObjectNotFoundError();
      }
      const pending = await store.beginDelete(
        scope,
        objectId,
        eventId(),
        now(),
      );
      if (!pending) throw new PrivateVaultObjectNotFoundError();
      if (pending.objectState === "deleted") return { deleted: true };
      if (pending.objectState !== "delete_pending") {
        throw new PrivateVaultObjectConflictError();
      }
      emitSync(scope, objectId, "object-delete-pending");
      await blobs.deleteObject({
        scope: "object",
        vaultId: scope.vaultId,
        objectId,
      });
      await store.finishDelete(scope, objectId, eventId(), now());
      emitSync(scope, objectId, "object-deleted");
      return { deleted: true };
    },
  };
}

export const privateVaultObjectService = createPrivateVaultObjectService();

export function decodePrivateVaultCiphertext(
  value: string,
  maxBytes = PRIVATE_VAULT_ACTION_MAX_BYTES,
): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new PrivateVaultObjectConflictError(
      "Ciphertext must be canonical base64",
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    throw new PrivateVaultObjectConflictError(
      "Ciphertext exceeds the action limit",
    );
  }
  if (bytes.toString("base64") !== value) {
    throw new PrivateVaultObjectConflictError(
      "Ciphertext must be canonical base64",
    );
  }
  return new Uint8Array(bytes);
}
