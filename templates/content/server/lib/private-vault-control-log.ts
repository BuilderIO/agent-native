import { createHash } from "node:crypto";

import {
  controlLogStateSchema,
  decodeSignedControlLogEntry,
  encodeSignedControlLogEntry,
  resolveControlLogEndpointAuthorization,
  type ControlLogState,
  type ControlMembershipCommit,
  type SignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "@agent-native/core/e2ee";
import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const MAX_CONTROL_ENTRY_BYTES = 64 * 1024;

export interface PrivateVaultControlLogScope {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
}

export interface PrivateVaultControlLogExpectedHead {
  sequence: number | null;
  hash: string | null;
}

export class PrivateVaultControlLogError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "invalid_entry"
      | "unauthorized_genesis"
      | "recovery_authorization_required"
      | "head_mismatch"
      | "persisted_state_tampered"
      | "concurrent_append",
  ) {
    super("Private Vault control log verification failed");
    this.name = "PrivateVaultControlLogError";
  }
}

export interface PrivateVaultControlLogServiceOptions {
  /**
   * External ceremony/device trust anchor. Self-signed genesis bytes alone do
   * not prove that the current account authorized this vault.
   */
  authorizeGenesis(input: {
    scope: PrivateVaultControlLogScope;
    entry: SignedControlLogEntry;
    entryBytes: Uint8Array;
  }): Promise<boolean>;
  /** Verifies recovery authority outside the endpoint membership being pruned. */
  verifyRecoveryAuthorization?(input: {
    scope: PrivateVaultControlLogScope;
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  }): Promise<boolean>;
  now?: () => Date;
}

interface StoredEntryRow {
  id: string;
  entryId: string;
  vaultId: string;
  ownerEmail: string;
  orgId: string;
  sequence: number;
  previousHash: string;
  entryHash: string;
  signerEndpointId: string;
  signedAt: string;
  entryBytesBase64url: string;
  serverReceivedAt: string;
}

interface StoredHeadRow {
  vaultId: string;
  ownerEmail: string;
  orgId: string;
  sequence: number;
  headHash: string;
  membershipHash: string;
  signedAt: string;
  epoch: number;
  activeMembersJson: string;
  removedEndpointIdsJson: string;
  freshnessMode: string;
  serverReceivedAt: string;
}

interface VerifiedReduction {
  state: ControlLogState;
  entryHash: string;
  idempotent: boolean;
}

function normalizeScope(
  input: PrivateVaultControlLogScope,
): PrivateVaultControlLogScope {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const orgId = input.orgId.trim();
  const vaultId = input.vaultId.trim();
  if (!ownerEmail || ownerEmail.length > 320 || !vaultId) {
    throw new PrivateVaultControlLogError("not_found");
  }
  return { ownerEmail, orgId, vaultId };
}

function scopedEntry(scope: PrivateVaultControlLogScope) {
  return and(
    eq(
      schema.contentEncryptedVaultControlLogEntries.ownerEmail,
      scope.ownerEmail,
    ),
    eq(schema.contentEncryptedVaultControlLogEntries.orgId, scope.orgId),
    eq(schema.contentEncryptedVaultControlLogEntries.vaultId, scope.vaultId),
  );
}

function scopedHead(scope: PrivateVaultControlLogScope) {
  return and(
    eq(schema.contentEncryptedVaultControlHeads.ownerEmail, scope.ownerEmail),
    eq(schema.contentEncryptedVaultControlHeads.orgId, scope.orgId),
    eq(schema.contentEncryptedVaultControlHeads.vaultId, scope.vaultId),
  );
}

function encodeStoredBytes(bytes: Uint8Array): string {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_CONTROL_ENTRY_BYTES
  ) {
    throw new PrivateVaultControlLogError("invalid_entry");
  }
  return Buffer.from(bytes).toString("base64url");
}

function decodeStoredBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 88_000) {
    throw new PrivateVaultControlLogError("persisted_state_tampered");
  }
  const bytes = Uint8Array.from(Buffer.from(value, "base64url"));
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_CONTROL_ENTRY_BYTES ||
    Buffer.from(bytes).toString("base64url") !== value
  ) {
    throw new PrivateVaultControlLogError("persisted_state_tampered");
  }
  return bytes;
}

function headValues(
  scope: PrivateVaultControlLogScope,
  state: ControlLogState,
  serverReceivedAt: string,
) {
  return {
    vaultId: scope.vaultId,
    ownerEmail: scope.ownerEmail,
    orgId: scope.orgId,
    version: 1,
    sequence: state.sequence,
    headHash: state.headHash,
    membershipHash: state.membershipHash,
    signedAt: state.signedAt,
    epoch: state.epoch,
    activeMembersJson: JSON.stringify(state.activeMembers),
    removedEndpointIdsJson: JSON.stringify(state.removedEndpointIds),
    freshnessMode: state.freshnessMode,
    serverReceivedAt,
  };
}

function headMatchesState(row: StoredHeadRow, state: ControlLogState): boolean {
  return (
    row.sequence === state.sequence &&
    row.headHash === state.headHash &&
    row.membershipHash === state.membershipHash &&
    row.signedAt === state.signedAt &&
    row.epoch === state.epoch &&
    row.activeMembersJson === JSON.stringify(state.activeMembers) &&
    row.removedEndpointIdsJson === JSON.stringify(state.removedEndpointIds) &&
    row.freshnessMode === state.freshnessMode
  );
}

function expectedMatches(
  expected: PrivateVaultControlLogExpectedHead,
  state: ControlLogState | null,
): boolean {
  if (!state) return expected.sequence === null && expected.hash === null;
  return (
    expected.sequence === state.sequence && expected.hash === state.headHash
  );
}

export function createPrivateVaultControlLogService(
  options: PrivateVaultControlLogServiceOptions,
) {
  const now = options.now ?? (() => new Date());

  async function reduceEntry(
    scope: PrivateVaultControlLogScope,
    current: ControlLogState | null,
    entry: SignedControlLogEntry,
    entryBytes: Uint8Array,
  ): Promise<VerifiedReduction> {
    try {
      return await verifyAndReduceControlLogEntry({
        current,
        entry,
        verifyGenesisAuthorization: current
          ? undefined
          : async () => {
              try {
                return await options.authorizeGenesis({
                  scope,
                  entry,
                  entryBytes,
                });
              } catch {
                return false;
              }
            },
        verifyRecoveryAuthorization: options.verifyRecoveryAuthorization
          ? ({ commit, entry: recoveryEntry, current: recoveryCurrent }) =>
              options.verifyRecoveryAuthorization!({
                scope,
                commit,
                entry: recoveryEntry,
                current: recoveryCurrent,
              })
          : undefined,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "genesis_authorization_required"
      ) {
        throw new PrivateVaultControlLogError("unauthorized_genesis");
      }
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "recovery_authorization_required"
      ) {
        throw new PrivateVaultControlLogError(
          "recovery_authorization_required",
        );
      }
      throw new PrivateVaultControlLogError("invalid_entry");
    }
  }

  async function replayRows(
    scope: PrivateVaultControlLogScope,
    rows: readonly StoredEntryRow[],
  ): Promise<ControlLogState | null> {
    let state: ControlLogState | null = null;
    for (const row of rows) {
      const bytes = decodeStoredBytes(row.entryBytesBase64url);
      let entry: SignedControlLogEntry;
      try {
        entry = decodeSignedControlLogEntry(bytes);
      } catch {
        throw new PrivateVaultControlLogError("persisted_state_tampered");
      }
      let reduced: VerifiedReduction;
      try {
        reduced = await reduceEntry(scope, state, entry, bytes);
      } catch {
        throw new PrivateVaultControlLogError("persisted_state_tampered");
      }
      if (
        reduced.idempotent ||
        row.entryId !== entry.envelopeId ||
        row.vaultId !== entry.vaultId ||
        row.sequence !== entry.sequence ||
        row.previousHash !== entry.previousHash ||
        row.entryHash !== reduced.entryHash ||
        row.signerEndpointId !== entry.signerEndpointId ||
        row.signedAt !== entry.createdAt ||
        encodeStoredBytes(encodeSignedControlLogEntry(entry)) !==
          row.entryBytesBase64url
      ) {
        throw new PrivateVaultControlLogError("persisted_state_tampered");
      }
      state = reduced.state;
    }
    return state;
  }

  async function loadVerifiedState(
    scopeInput: PrivateVaultControlLogScope,
  ): Promise<ControlLogState | null> {
    const scope = normalizeScope(scopeInput);
    const rows = (await getDb()
      .select()
      .from(schema.contentEncryptedVaultControlLogEntries)
      .where(scopedEntry(scope))
      .orderBy(
        asc(schema.contentEncryptedVaultControlLogEntries.sequence),
      )) as StoredEntryRow[];
    const [head] = (await getDb()
      .select()
      .from(schema.contentEncryptedVaultControlHeads)
      .where(scopedHead(scope))
      .limit(1)) as StoredHeadRow[];
    const state = await replayRows(scope, rows);
    if (
      (!state && head) ||
      (state && (!head || !headMatchesState(head, state)))
    ) {
      throw new PrivateVaultControlLogError("persisted_state_tampered");
    }
    return state;
  }

  async function appendOnce(
    scopeInput: PrivateVaultControlLogScope,
    input: {
      entryBytes: Uint8Array;
      expectedHead: PrivateVaultControlLogExpectedHead;
    },
  ): Promise<{ state: ControlLogState; idempotent: boolean }> {
    const scope = normalizeScope(scopeInput);
    const encodedBytes = encodeStoredBytes(input.entryBytes);
    let candidate: SignedControlLogEntry;
    try {
      candidate = decodeSignedControlLogEntry(input.entryBytes);
    } catch {
      throw new PrivateVaultControlLogError("invalid_entry");
    }
    if (candidate.vaultId !== scope.vaultId) {
      throw new PrivateVaultControlLogError("invalid_entry");
    }
    const receivedAt = now().toISOString();

    return getDb().transaction(async (tx) => {
      const [vault] = await tx
        .select({ vaultId: schema.contentEncryptedVaults.vaultId })
        .from(schema.contentEncryptedVaults)
        .where(
          and(
            eq(schema.contentEncryptedVaults.vaultId, scope.vaultId),
            eq(schema.contentEncryptedVaults.ownerEmail, scope.ownerEmail),
            eq(schema.contentEncryptedVaults.orgId, scope.orgId),
          ),
        )
        .limit(1);
      if (!vault) throw new PrivateVaultControlLogError("not_found");

      const rows = (await tx
        .select()
        .from(schema.contentEncryptedVaultControlLogEntries)
        .where(scopedEntry(scope))
        .orderBy(
          asc(schema.contentEncryptedVaultControlLogEntries.sequence),
        )) as StoredEntryRow[];
      const [storedHead] = (await tx
        .select()
        .from(schema.contentEncryptedVaultControlHeads)
        .where(scopedHead(scope))
        .limit(1)) as StoredHeadRow[];
      const current = await replayRows(scope, rows);
      if (
        (!current && storedHead) ||
        (current && (!storedHead || !headMatchesState(storedHead, current)))
      ) {
        throw new PrivateVaultControlLogError("persisted_state_tampered");
      }

      if (current && candidate.sequence === current.sequence) {
        const idempotent = await reduceEntry(
          scope,
          current,
          candidate,
          input.entryBytes,
        );
        const stored = rows[rows.length - 1];
        if (
          !idempotent.idempotent ||
          !stored ||
          stored.entryHash !== idempotent.entryHash ||
          stored.entryBytesBase64url !== encodedBytes
        ) {
          throw new PrivateVaultControlLogError("invalid_entry");
        }
        return { state: current, idempotent: true };
      }
      if (!expectedMatches(input.expectedHead, current)) {
        throw new PrivateVaultControlLogError("head_mismatch");
      }

      const reduced = await reduceEntry(
        scope,
        current,
        candidate,
        input.entryBytes,
      );
      if (reduced.idempotent) {
        throw new PrivateVaultControlLogError("invalid_entry");
      }
      const [inserted] = await tx
        .insert(schema.contentEncryptedVaultControlLogEntries)
        .values({
          id: createHash("sha256")
            .update("anc/v1/content-control-entry\0")
            .update(scope.vaultId)
            .update("\0")
            .update(candidate.envelopeId)
            .digest("hex"),
          entryId: candidate.envelopeId,
          vaultId: scope.vaultId,
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          version: 1,
          sequence: candidate.sequence,
          previousHash: candidate.previousHash,
          entryHash: reduced.entryHash,
          signerEndpointId: candidate.signerEndpointId,
          signedAt: candidate.createdAt,
          entryBytesBase64url: encodedBytes,
          serverReceivedAt: receivedAt,
        })
        .onConflictDoNothing()
        .returning({
          entryId: schema.contentEncryptedVaultControlLogEntries.entryId,
        });
      if (!inserted) {
        throw new PrivateVaultControlLogError("concurrent_append");
      }

      const nextHead = headValues(scope, reduced.state, receivedAt);
      if (!current) {
        const [created] = await tx
          .insert(schema.contentEncryptedVaultControlHeads)
          .values(nextHead)
          .onConflictDoNothing()
          .returning({
            vaultId: schema.contentEncryptedVaultControlHeads.vaultId,
          });
        if (!created) {
          throw new PrivateVaultControlLogError("concurrent_append");
        }
      } else {
        const [updated] = await tx
          .update(schema.contentEncryptedVaultControlHeads)
          .set(nextHead)
          .where(
            and(
              scopedHead(scope),
              eq(
                schema.contentEncryptedVaultControlHeads.sequence,
                current.sequence,
              ),
              eq(
                schema.contentEncryptedVaultControlHeads.headHash,
                current.headHash,
              ),
            ),
          )
          .returning({
            vaultId: schema.contentEncryptedVaultControlHeads.vaultId,
          });
        if (!updated) {
          throw new PrivateVaultControlLogError("concurrent_append");
        }
      }
      return { state: reduced.state, idempotent: false };
    });
  }

  return {
    async append(
      scope: PrivateVaultControlLogScope,
      input: {
        entryBytes: Uint8Array;
        expectedHead: PrivateVaultControlLogExpectedHead;
      },
    ) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await appendOnce(scope, input);
        } catch (error) {
          if (
            !(error instanceof PrivateVaultControlLogError) ||
            error.code !== "concurrent_append" ||
            attempt === 1
          ) {
            throw error;
          }
        }
      }
      throw new PrivateVaultControlLogError("concurrent_append");
    },

    loadVerifiedState,

    async resolveBrokerAuthorization(
      scopeInput: PrivateVaultControlLogScope,
      endpointId: string,
    ) {
      const scope = normalizeScope(scopeInput);
      const state = await loadVerifiedState(scope);
      if (!state) return null;
      const resolved = resolveControlLogEndpointAuthorization(
        controlLogStateSchema.parse(state),
        endpointId,
        now(),
      );
      return resolved ? { ...scope, ...resolved } : null;
    },
  };
}
