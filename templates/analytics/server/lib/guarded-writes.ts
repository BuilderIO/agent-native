import { createHash, randomUUID } from "node:crypto";

import { ActionContractError, fail } from "@agent-native/core/action";
import { stableStringify } from "@agent-native/toolkit/dashboard/panel-render-contract";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";

/** A retry with the same key inside this window always replays. */
export const WRITE_RECEIPT_RETRY_WINDOW_DAYS = 30;
/** Receipts are deleted after this many days; the key is then new again. */
export const WRITE_RECEIPT_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_BATCH_SIZE = 50;
// External MCP clients are the callers that must send the protocol arguments.
// A2A writes reach these actions through the receiving app's own agent
// (`tool`), because direct A2A action mode is read-only.
const EXTERNAL_MCP_CALLER = "mcp";

export type GuardedTargetKind =
  | "dashboard"
  | "analysis"
  | "dashboard-folder"
  | "report-subscription";

const TARGET_NOUN: Record<GuardedTargetKind, string> = {
  dashboard: "dashboard",
  analysis: "analysis",
  "dashboard-folder": "dashboard folder",
  "report-subscription": "report subscription",
};

export const IDEMPOTENCY_KEY_DESCRIPTION = `A new unique string for this write, such as a UUID. Required from external MCP clients. Resending the same key with the same arguments returns the first write's receipt (replayed: true) instead of writing again, even after later edits; the same key with different arguments fails with IDEMPOTENCY_KEY_REUSED. Retries are guaranteed to replay for ${WRITE_RECEIPT_RETRY_WINDOW_DAYS} days; receipts are deleted after ${WRITE_RECEIPT_RETENTION_DAYS} days.`;

export function expectedUpdatedAtDescription(record: string): string {
  return `The ${record}'s updatedAt from your last read, unchanged. Required from external MCP clients when changing an existing ${record}. If it has changed since, nothing is written and the call fails with a 409 whose details.currentRevision is the current updatedAt: read the ${record} again, redo the edit, and resend with that value.`;
}

export const idempotencyKeyArg = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(IDEMPOTENCY_KEY_DESCRIPTION);

export function expectedUpdatedAtArg(record: string) {
  return z
    .string()
    .min(1)
    .optional()
    .describe(expectedUpdatedAtDescription(record));
}

export interface WriteReceipt {
  receiptId: string;
  action: string;
  target: { kind: GuardedTargetKind; id: string };
  outcome: "applied" | "unchanged";
  /** The record's updatedAt before and after the write; `before` is null for a create. */
  revision: { before: string | null; after: string | null };
  /** The history entry holding the record as it was before the write, if one was kept. */
  revisionId: string | null;
  appliedAt: string;
  idempotency: {
    key: string;
    result: "applied" | "replayed";
    requestDigest: string;
    retryWindowDays: number;
    retentionDays: number;
  };
}

export interface WriteReplay {
  replayed: true;
  writeReceipt: WriteReceipt & { idempotency: { replayedAt: string } };
  message: string;
}

/** What a guarded store write reports from inside its transaction. */
export interface GuardedCommit {
  /** The id written; only a create the server names differs from the target. */
  targetId?: string;
  before: string | null;
  after: string | null;
  changed: boolean;
  revisionId?: string | null;
}

export type AnalyticsTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

/** Runs inside the write's transaction; throwing rolls the write back. */
export type GuardedCommitHook = (
  tx: AnalyticsTransaction,
  commit: GuardedCommit,
) => Promise<void>;

export interface GuardedStoreOptions {
  /**
   * The caller's fence. The store makes one attempt against exactly this
   * version and never substitutes a version it read itself.
   */
  expectedUpdatedAt?: string | undefined;
  onCommit?: GuardedCommitHook | undefined;
}

export interface GuardedWriteInput {
  action: string;
  target: { kind: GuardedTargetKind; id: string };
  caller: string | undefined;
  scope: { email: string; orgId: string | null };
  idempotencyKey?: string | undefined;
  expectedUpdatedAt?: string | undefined;
  /** Every argument that changes what the write does. */
  request: Record<string, unknown>;
}

/** The first row a query returned, or undefined when it returned none. */
export function firstRow<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

function expiryCutoff(now: number): string {
  return new Date(now - WRITE_RECEIPT_RETENTION_DAYS * DAY_MS).toISOString();
}

function receiptMismatch(receiptId: string): never {
  throw new ActionContractError(
    "The stored write receipt is inconsistent and cannot be replayed.",
    { errorCode: "RECEIPT_MISMATCH", statusCode: 409, details: { receiptId } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The receipt a row stores; anything else is refused, never replayed. */
function storedReceipt(row: {
  id: string;
  requestDigest: string;
  resultJson: string;
}): WriteReceipt {
  let value: unknown;
  try {
    value = JSON.parse(row.resultJson);
  } catch {
    receiptMismatch(row.id);
  }
  if (
    !isRecord(value) ||
    value.receiptId !== row.id ||
    !isRecord(value.target) ||
    !isRecord(value.revision) ||
    !isRecord(value.idempotency) ||
    value.idempotency.requestDigest !== row.requestDigest
  ) {
    receiptMismatch(row.id);
  }
  return value as unknown as WriteReceipt;
}

/**
 * The fence, the idempotency receipt, and the external-caller protocol for
 * one write. With neither a key nor a fence it does nothing, so the write runs
 * exactly as it did before receipts existed.
 */
export class GuardedWrite {
  readonly idempotencyKey: string | undefined;
  readonly expectedUpdatedAt: string | undefined;
  private digest: string | undefined;
  private committed: WriteReceipt | undefined;
  private authorize: (() => Promise<unknown>) | undefined;

  constructor(private readonly input: GuardedWriteInput) {
    this.idempotencyKey = input.idempotencyKey || undefined;
    this.expectedUpdatedAt = input.expectedUpdatedAt;
  }

  /** Whether the caller sent a fence or a key. */
  get active(): boolean {
    return (
      this.idempotencyKey !== undefined || this.expectedUpdatedAt !== undefined
    );
  }

  get callerScope(): string {
    const organization = this.input.scope.orgId
      ? `:org:${this.input.scope.orgId}`
      : "";
    return `${this.input.caller ?? "unspecified"}:user:${this.input.scope.email.toLowerCase()}${organization}`;
  }

  get requestDigest(): string {
    this.digest ??= createHash("sha256")
      .update(
        stableStringify({
          action: this.input.action,
          target: this.input.target,
          expectedUpdatedAt: this.expectedUpdatedAt ?? null,
          request: this.input.request,
        }),
      )
      .digest("hex");
    return this.digest;
  }

  /** The receipt this call committed, once its write has returned. */
  get receipt(): WriteReceipt | undefined {
    return this.committed;
  }

  /** The fence and receipt insert for the store write. */
  get store(): GuardedStoreOptions {
    return {
      expectedUpdatedAt: this.expectedUpdatedAt,
      onCommit: this.onCommit,
    };
  }

  /** The receipt insert to run inside the write's transaction, when keyed. */
  get onCommit(): GuardedCommitHook | undefined {
    return this.idempotencyKey === undefined
      ? undefined
      : (tx, commit) => this.commit(tx, commit);
  }

  /** External MCP clients must name every write with a key. */
  requireKey(): void {
    if (
      this.input.caller !== EXTERNAL_MCP_CALLER ||
      this.idempotencyKey !== undefined
    ) {
      return;
    }
    fail(
      `${this.input.action} over MCP requires idempotencyKey: a new unique string for this write. Send the same key again only to retry this exact request.`,
      { errorCode: "idempotency_key_required", statusCode: 400 },
    );
  }

  /** External MCP clients must fence every change to an existing record. */
  requireFence(): void {
    if (
      this.input.caller !== EXTERNAL_MCP_CALLER ||
      this.expectedUpdatedAt !== undefined
    ) {
      return;
    }
    const noun = TARGET_NOUN[this.input.target.kind];
    fail(
      `${this.input.action} over MCP requires expectedUpdatedAt: the updatedAt from your last read of this ${noun}.`,
      { errorCode: "expected_updated_at_required", statusCode: 400 },
    );
  }

  /**
   * The stored result of an earlier request with this key, or null. Call it
   * after authorizing the target. A different request under the same key is
   * a 409.
   */
  async replay(): Promise<WriteReplay | null> {
    if (this.idempotencyKey === undefined) return null;
    const table = schema.analyticsWriteReceipts;
    const stored = firstRow(
      await getDb().select().from(table).where(this.keyFilter()).limit(1),
    );
    if (!stored || stored.createdAt < expiryCutoff(Date.now())) return null;
    if (stored.requestDigest !== this.requestDigest) {
      throw new ActionContractError(
        `idempotencyKey "${this.idempotencyKey}" was already used for a different request (${stored.action}). Send a new idempotencyKey for a new write.`,
        {
          errorCode: "IDEMPOTENCY_KEY_REUSED",
          statusCode: 409,
          details: {
            idempotencyKey: this.idempotencyKey,
            action: stored.action,
            appliedAt: stored.createdAt,
          },
        },
      );
    }
    const receipt = storedReceipt(stored);
    const replayedAt = new Date().toISOString();
    return {
      replayed: true,
      writeReceipt: {
        ...receipt,
        idempotency: { ...receipt.idempotency, result: "replayed", replayedAt },
      },
      message: `Already applied at ${receipt.appliedAt} by an earlier request with this idempotencyKey; nothing was written again. Read the ${TARGET_NOUN[receipt.target.kind]} for its current state.`,
    };
  }

  /**
   * For a keyed request: authorizes, then answers from an earlier request's
   * receipt when there is one. A replay takes precedence over the fence,
   * which the original write advanced. Call it before any slow validation,
   * which could otherwise refuse a request that was already applied.
   */
  async preflight(
    authorize: () => Promise<unknown>,
  ): Promise<WriteReplay | null> {
    if (this.idempotencyKey === undefined) return null;
    this.authorize = authorize;
    await authorize();
    return this.replay();
  }

  /**
   * Runs the write. A keyed write that fails is answered from the receipt a
   * concurrent duplicate committed first, when there is one.
   */
  async settle<T>(
    write: () => Promise<T>,
  ): Promise<{ replayed: WriteReplay } | { written: T }> {
    try {
      return { written: await write() };
    } catch (error) {
      if (this.idempotencyKey === undefined) throw error;
      return { replayed: await this.replayAfterFailure(error) };
    }
  }

  async run<T>(
    authorize: () => Promise<unknown>,
    write: () => Promise<T>,
  ): Promise<{ replayed: WriteReplay } | { written: T }> {
    const replayed = await this.preflight(authorize);
    return replayed ? { replayed } : this.settle(write);
  }

  /**
   * What a guarded result adds: the version to fence the next write on, and
   * the receipt when keyed. Empty for a call that sent neither, so its
   * result keeps its shape.
   */
  resultFields(written: { updatedAt: string } | null): {
    updatedAt?: string | null;
    writeReceipt?: WriteReceipt;
  } {
    if (!this.active) return {};
    return {
      updatedAt: written?.updatedAt ?? null,
      ...(this.committed ? { writeReceipt: this.committed } : {}),
    };
  }

  /** `replayAfterFailure` as a `.catch` handler. */
  readonly recover = (error: unknown): Promise<WriteReplay> =>
    this.replayAfterFailure(error);

  /**
   * After a write fails: the receipt a concurrent request with this key
   * committed first, or the original error. Access is checked again before
   * that receipt is returned, since the caller may have lost it after
   * `preflight`; without a `preflight` there is nothing to check with, so the
   * error stands.
   */
  async replayAfterFailure(error: unknown): Promise<WriteReplay> {
    if (!this.authorize) throw error;
    const replay = await this.replay();
    if (!replay) throw error;
    await this.authorize();
    return replay;
  }

  private keyFilter() {
    const table = schema.analyticsWriteReceipts;
    return and(
      eq(table.targetKind, this.input.target.kind),
      eq(table.targetId, this.input.target.id),
      eq(table.callerScope, this.callerScope),
      eq(table.idempotencyKey, this.idempotencyKey as string),
    );
  }

  private async commit(
    tx: AnalyticsTransaction,
    commit: GuardedCommit,
  ): Promise<void> {
    this.committed = undefined;
    const table = schema.analyticsWriteReceipts;
    const now = Date.now();
    const cutoff = expiryCutoff(now);
    // An expired receipt no longer replays, so it gives its key up.
    await tx
      .delete(table)
      .where(and(this.keyFilter(), lt(table.createdAt, cutoff)));
    const receipt: WriteReceipt = {
      receiptId: randomUUID(),
      action: this.input.action,
      target: {
        kind: this.input.target.kind,
        id: commit.targetId ?? this.input.target.id,
      },
      outcome: commit.changed ? "applied" : "unchanged",
      revision: { before: commit.before, after: commit.after },
      revisionId: commit.revisionId ?? null,
      appliedAt: new Date(now).toISOString(),
      idempotency: {
        key: this.idempotencyKey as string,
        result: "applied",
        requestDigest: this.requestDigest,
        retryWindowDays: WRITE_RECEIPT_RETRY_WINDOW_DAYS,
        retentionDays: WRITE_RECEIPT_RETENTION_DAYS,
      },
    };
    await tx.insert(table).values({
      id: receipt.receiptId,
      ownerEmail: this.input.scope.email,
      orgId: this.input.scope.orgId,
      targetKind: this.input.target.kind,
      targetId: this.input.target.id,
      action: this.input.action,
      callerScope: this.callerScope,
      idempotencyKey: receipt.idempotency.key,
      requestDigest: receipt.idempotency.requestDigest,
      resultJson: JSON.stringify(receipt),
      createdAt: receipt.appliedAt,
    });
    // Bounded, and skips rows another writer is already deleting.
    const expired = tx
      .select({ id: table.id })
      .from(table)
      .where(lt(table.createdAt, cutoff))
      .orderBy(asc(table.createdAt))
      .limit(PRUNE_BATCH_SIZE)
      .for("update", { skipLocked: true });
    await tx.delete(table).where(inArray(table.id, expired));
    this.committed = receipt;
  }
}

export function guardWrite(input: GuardedWriteInput): GuardedWrite {
  return new GuardedWrite(input);
}
