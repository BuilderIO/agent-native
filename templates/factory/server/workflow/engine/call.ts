import {
  WorkflowStoreError,
  type OperationRequest,
  type OperationResult,
} from "../adapter.js";
import { WorkflowError, receiptKey } from "../contract.js";
import type { Receipt } from "../contract.js";
import type { OperationDefinition } from "../operations.js";
import { fitText } from "./bounds.js";
import { MAX_SPENT_RECEIPT_KEYS, RETRY_BACKOFF_MS } from "./constants.js";
import { boundReceiptOutput } from "./receipt-output.js";
import type { ItemFailure, TickContext } from "./types.js";

/**
 * Repeats a call that failed with nothing done and says it is worth another
 * try. Backoff goes through the clock, so a test never sleeps. A failure that
 * may have had an effect is never repeated here.
 */
export async function retrying<R>(
  ctx: TickContext,
  run: () => Promise<R>,
  retryable: (result: R) => boolean,
): Promise<R> {
  for (let tried = 0; ; tried += 1) {
    const result = await run();
    if (!retryable(result) || tried >= RETRY_BACKOFF_MS.length) return result;
    await ctx.host.clock.sleep(RETRY_BACKOFF_MS[tried], ctx.signal);
  }
}

export function isSafelyRetryable(result: OperationResult): boolean {
  return !result.ok && result.retryable && result.sideEffect === "none";
}

/** A read, or any call that needs no receipt. */
export function callOperation(
  ctx: TickContext,
  request: OperationRequest,
): Promise<OperationResult> {
  return retrying(
    ctx,
    () => ctx.host.operations.execute(request),
    isSafelyRetryable,
  );
}

type EffectOutcome =
  | {
      kind: "done";
      receiptKey: string;
      /** An earlier attempt already ran it; nothing was called. */
      reused: boolean;
      /** When the write was done: now for a write this call made, the receipt's own time for one it found. */
      at: string;
      /** The response; on a reused write, the part its receipt kept. */
      output?: unknown;
      /** Only a reused write can say its `output` is part of the response. */
      outputTruncated?: true;
      externalRef?: string;
      url?: string;
    }
  | { kind: "needs_check"; receiptKey: string; message: string }
  | { kind: "failed"; receiptKey: string; failure: ItemFailure };

interface EffectCall {
  nodeId: string;
  itemId: string;
  def: OperationDefinition;
  fields: Readonly<Record<string, unknown>>;
  /** The item's `receiptSalt`: what tells this write from the one made for the same id last time. */
  salt?: string;
  /**
   * The first receipt key to try: the item's round. The keys a failed attempt
   * spent are skipped by looking, not by counting failures of the whole item,
   * because an item that failed at a later node must find this write's
   * receipt `done` again, not mint a new key and send it twice.
   */
  firstAttempt: number;
}

/**
 * Runs one write under a receipt. The receipt is written before the call and
 * closed after it, so a crash in between leaves a `started` receipt with no
 * reference: the next run finds it and stops for a person instead of posting
 * twice. A done receipt is the answer, reused without calling. A failed
 * receipt means that attempt is spent, so the next key is tried.
 */
export async function performEffect(
  ctx: TickContext,
  call: EffectCall,
): Promise<EffectOutcome> {
  const { host, scope, workflowId } = ctx;
  const summary = fitText(`${call.def.id} at ${call.nodeId}`, 500);
  const stamp = (): string => host.clock.now().toISOString();
  const put = (receipt: Omit<Receipt, "at">, at: string = stamp()) =>
    host.store.putReceipt(scope, workflowId, { ...receipt, at });

  let attempt = call.firstAttempt;
  let calls = 0;
  for (let spent = 0; spent <= MAX_SPENT_RECEIPT_KEYS; spent += 1) {
    const key = receiptKey({
      workflowId,
      itemId: call.itemId,
      nodeId: call.nodeId,
      attempt,
      ...(call.salt === undefined ? {} : { salt: call.salt }),
    });
    const existing = await host.store.getReceipt(scope, key);
    if (existing?.status === "done") {
      return {
        kind: "done",
        receiptKey: key,
        reused: true,
        at: existing.at,
        ...(existing.output === undefined ? {} : { output: existing.output }),
        ...(existing.outputTruncated ? { outputTruncated: true as const } : {}),
        ...(existing.externalRef === undefined
          ? {}
          : { externalRef: existing.externalRef }),
        ...(existing.url === undefined ? {} : { url: existing.url }),
      };
    }
    if (existing?.status === "started") {
      ctx.invariantBroken({
        invariant: "receipt_started_without_ref_on_resume",
        severity: "error",
        nodeId: call.nodeId,
        operationId: call.def.id,
        details: {
          itemId: call.itemId,
          attempt,
          hasExternalRef: existing.externalRef !== undefined,
        },
      });
      return {
        kind: "needs_check",
        receiptKey: key,
        message: `${call.def.id} was started on an earlier attempt and never confirmed; check whether it happened before running it again.`,
      };
    }
    if (existing?.status === "failed") {
      attempt += 1;
      continue;
    }

    try {
      await put({ key, status: "started", summary });
    } catch (error) {
      // Another attempt wrote this key between the read above and this write.
      if (
        error instanceof WorkflowStoreError &&
        error.code === "receipt_conflict"
      ) {
        ctx.invariantBroken({
          invariant: "duplicate_receipt_key",
          severity: "error",
          nodeId: call.nodeId,
          operationId: call.def.id,
          details: { itemId: call.itemId, attempt },
        });
      }
      throw error;
    }
    const result = await host.operations.execute({
      operation: call.def,
      fields: call.fields,
      credentialSlot: call.def.credential.provider,
      receiptKey: key,
      mode: ctx.mode,
      signal: ctx.signal,
    });
    calls += 1;

    if (result.ok) {
      const bounded = boundReceiptOutput(result.output);
      const at = stamp();
      await put(
        {
          key,
          status: "done",
          summary,
          ...(bounded === undefined
            ? {}
            : {
                output: bounded.output,
                ...(bounded.truncated ? { outputTruncated: true } : {}),
              }),
          ...(result.externalRef === undefined
            ? {}
            : { externalRef: result.externalRef }),
          ...(result.url === undefined ? {} : { url: result.url }),
        },
        at,
      );
      return {
        kind: "done",
        receiptKey: key,
        reused: false,
        at,
        output: result.output,
        ...(result.externalRef === undefined
          ? {}
          : { externalRef: result.externalRef }),
        ...(result.url === undefined ? {} : { url: result.url }),
      };
    }

    if (result.sideEffect === "maybe") {
      // Left `started`: it may have happened, so no later run may repeat it.
      return {
        kind: "needs_check",
        receiptKey: key,
        message: `${call.def.id} may have happened (${result.code}: ${result.message}); check before running it again.`,
      };
    }
    if (result.sideEffect === "done") {
      await put({
        key,
        status: "done",
        summary: fitText(`${summary}; reported ${result.code}`, 500),
      });
      return {
        kind: "needs_check",
        receiptKey: key,
        message: `${call.def.id} ran but reported a failure (${result.code}: ${result.message}); check its result.`,
      };
    }

    await put({ key, status: "failed", summary: fitText(result.message, 500) });
    const failure: ItemFailure = {
      code: result.code,
      message: result.message,
      ...(result.retryable ? { retryable: true } : {}),
    };
    if (!result.retryable || calls > RETRY_BACKOFF_MS.length) {
      return { kind: "failed", receiptKey: key, failure };
    }
    await host.clock.sleep(RETRY_BACKOFF_MS[calls - 1], ctx.signal);
    attempt += 1;
  }
  throw new WorkflowError(
    "engine_error",
    `${call.def.id} for ${call.itemId} has more than ${MAX_SPENT_RECEIPT_KEYS} spent receipt keys at ${call.nodeId}.`,
  );
}
