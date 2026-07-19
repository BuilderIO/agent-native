import { z } from "zod";

import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import type {
  PrivateVaultMigrationHostedClient,
  PrivateVaultMigrationItemProjection,
  PrivateVaultMigrationLedgerProjection,
  PrivateVaultMigrationSourceProjection,
} from "./content-migration-runtime.js";

const ACTION_PATH =
  "/_agent-native/actions/manage-private-vault-migration" as const;
const MAXIMUM_REQUEST_BYTES = 4 * 1024 * 1024;
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const opaqueIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const revisionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();

const ledgerSchema = z
  .object({
    migrationId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    state: z.enum([
      "preflight",
      "copying",
      "verifying",
      "ready_for_cutover",
      "cutover",
      "cleanup_eligible",
      "cleaned",
      "rolled_back",
      "failed",
    ]),
    sourceSnapshotHash: digestSchema,
    sourceCount: z.number().int().nonnegative().max(10_000),
    verifiedCount: z.number().int().nonnegative().max(10_000),
    cutoverManifestObjectId: opaqueIdSchema.nullable(),
    cutoverManifestRevisionId: revisionIdSchema.nullable(),
    cutoverManifestCiphertextHash: digestSchema.nullable(),
    exportBundleHash: digestSchema.nullable(),
    exportVerifiedAt: nullableTimestampSchema,
    recoveryDrillVerifiedAt: nullableTimestampSchema,
    backupRetentionAcknowledgedAt: nullableTimestampSchema,
    cutoverAt: nullableTimestampSchema,
    cleanupAt: nullableTimestampSchema,
    rolledBackAt: nullableTimestampSchema,
  })
  .strict();

const itemSchema = z
  .object({
    migrationId: opaqueIdSchema,
    sourceDocumentId: z.string().min(1).max(256),
    parentSourceDocumentId: z.string().min(1).max(256).nullable(),
    objectId: opaqueIdSchema,
    sourceDigest: digestSchema,
    state: z.enum(["pending", "sealed", "verified", "cleaned"]),
    sealedRevisionId: revisionIdSchema.nullable(),
    sealedCiphertextHash: digestSchema.nullable(),
    verifiedAt: nullableTimestampSchema,
    cleanupAt: nullableTimestampSchema,
  })
  .strict();

const sourceSchema = z
  .object({
    id: z.string().min(1).max(256),
    parentId: z.string().min(1).max(256).nullable(),
    title: z.string().max(16_384),
    content: z.string().max(1024 * 1024),
    description: z.string().max(131_072),
    icon: z.string().max(16_384).nullable(),
    position: z.number().int().safe(),
    isFavorite: z.boolean(),
    hideFromSearch: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

function exactOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new PrivateVaultMigrationTransportError();
  }
}

export class PrivateVaultMigrationTransportError extends Error {
  constructor() {
    super("Private Vault migration transport unavailable");
    this.name = "PrivateVaultMigrationTransportError";
  }
}

export class PrivateVaultContentMigrationTransport implements PrivateVaultMigrationHostedClient {
  readonly #session: PrivateVaultContentSession;
  readonly #origin: string;

  constructor(input: {
    readonly session: PrivateVaultContentSession;
    readonly origin: string;
  }) {
    this.#session = input.session;
    this.#origin = exactOrigin(input.origin);
  }

  async active(vaultId: string) {
    const parsed = this.#parse(
      z
        .object({
          operation: z.literal("active"),
          current: z
            .object({
              ledger: ledgerSchema,
              items: z.array(itemSchema).max(10_000),
            })
            .strict()
            .nullable(),
        })
        .strict(),
      await this.#post({ vaultId, operation: "active" }),
    );
    return parsed.current
      ? {
          ledger: parsed.current
            .ledger as PrivateVaultMigrationLedgerProjection,
          items: parsed.current.items as PrivateVaultMigrationItemProjection[],
        }
      : null;
  }

  async candidates(vaultId: string) {
    const parsed = this.#parse(
      z
        .object({
          operation: z.literal("candidates"),
          sourceCount: z.number().int().nonnegative().max(10_000),
          sourceDocumentIds: z.array(z.string().min(1).max(256)).max(10_000),
        })
        .strict(),
      await this.#post({ vaultId, operation: "candidates" }),
    );
    if (
      parsed.sourceCount !== parsed.sourceDocumentIds.length ||
      new Set(parsed.sourceDocumentIds).size !== parsed.sourceDocumentIds.length
    )
      throw new PrivateVaultMigrationTransportError();
    return Object.freeze([...parsed.sourceDocumentIds]);
  }

  async preflight(vaultId: string, sourceDocumentIds: readonly string[]) {
    const response = await this.#post({
      vaultId,
      operation: "preflight",
      sourceDocumentIds,
    });
    return this.#ledger(response, "preflight");
  }

  async status(vaultId: string, migrationId: string) {
    const response = await this.#post({
      vaultId,
      operation: "status",
      migrationId,
    });
    const parsed = this.#parse(
      z
        .object({
          operation: z.literal("status"),
          ledger: ledgerSchema,
          items: z.array(itemSchema).max(10_000),
        })
        .strict(),
      response,
    );
    return {
      ledger: parsed.ledger as PrivateVaultMigrationLedgerProjection,
      items: parsed.items as PrivateVaultMigrationItemProjection[],
    };
  }

  async begin(vaultId: string, migrationId: string) {
    return this.#ledger(
      await this.#post({ vaultId, operation: "begin", migrationId }),
      "begin",
    );
  }

  async readSource(
    vaultId: string,
    migrationId: string,
    sourceDocumentId: string,
  ) {
    const parsed = this.#parse(
      z
        .object({ operation: z.literal("read-source"), source: sourceSchema })
        .strict(),
      await this.#post({
        vaultId,
        operation: "read-source",
        migrationId,
        sourceDocumentId,
      }),
    );
    return parsed.source as PrivateVaultMigrationSourceProjection;
  }

  async verifyItem(input: {
    vaultId: string;
    migrationId: string;
    sourceDocumentId: string;
    revisionId: string;
    ciphertextHash: string;
  }) {
    return this.#ledger(
      await this.#post({ ...input, operation: "verify-item" }),
      "verify-item",
    );
  }

  async cutover(input: {
    vaultId: string;
    migrationId: string;
    objectId: string;
    revisionId: string;
    ciphertextHash: string;
  }) {
    return this.#ledger(
      await this.#post({ ...input, operation: "cutover" }),
      "cutover",
    );
  }

  async exportEvidence(vaultId: string, migrationId: string) {
    const parsed = this.#parse(
      z
        .object({
          operation: z.literal("evidence"),
          evidence: z
            .object({
              exportId: opaqueIdSchema,
              exportBundleHash: digestSchema,
              plaintextHash: digestSchema,
              sourceSnapshotHash: digestSchema,
              objectCount: z.number().int().positive().max(10_000),
            })
            .strict(),
        })
        .strict(),
      await this.#post({ vaultId, operation: "evidence", migrationId }),
    );
    return parsed.evidence;
  }

  async recordCleanupProof(input: {
    vaultId: string;
    migrationId: string;
    exportBundleHash: string;
    recoveryDrillId: string;
    backupDisclosureVersion: string;
  }) {
    return this.#ledger(
      await this.#post({ ...input, operation: "record-cleanup-proof" }),
      "record-cleanup-proof",
    );
  }

  async cleanup(vaultId: string, migrationId: string) {
    return this.#ledger(
      await this.#post({ vaultId, operation: "cleanup", migrationId }),
      "cleanup",
    );
  }

  #ledger(value: unknown, operation: string) {
    const parsed = this.#parse(
      z
        .object({ operation: z.literal(operation), ledger: ledgerSchema })
        .strict(),
      value,
    );
    return parsed.ledger as PrivateVaultMigrationLedgerProjection;
  }

  #parse<T>(schema: z.ZodType<T>, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw new PrivateVaultMigrationTransportError();
    }
  }

  async #post(bodyInput: Record<string, unknown>): Promise<unknown> {
    const url = `${this.#origin}${ACTION_PATH}`;
    const body = Buffer.from(JSON.stringify(bodyInput));
    if (body.byteLength === 0 || body.byteLength > MAXIMUM_REQUEST_BYTES)
      throw new PrivateVaultMigrationTransportError();
    try {
      const response = await this.#session.fetch(url, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          "Content-Length": String(body.byteLength),
          "Content-Type": "application/json",
          "X-Agent-Native-CSRF": "1",
          "X-Agent-Native-Frontend": "1",
        },
        body,
      });
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      const length = response.headers.get("content-length");
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        contentType !== "application/json" ||
        length === null ||
        !/^[1-9][0-9]*$/.test(length) ||
        Number(length) > MAXIMUM_RESPONSE_BYTES
      )
        throw new Error();
      const responseBytes = new Uint8Array(await response.arrayBuffer());
      try {
        if (responseBytes.byteLength !== Number(length)) throw new Error();
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
        );
      } finally {
        responseBytes.fill(0);
      }
    } catch {
      throw new PrivateVaultMigrationTransportError();
    } finally {
      body.fill(0);
    }
  }
}
