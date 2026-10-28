import { WorkflowError, type FieldBinding } from "../../contract.js";
import { assertWithinStepCap, jsonByteLength } from "../../items.js";
import type { OperationDefinition } from "../../operations.js";
import { fillAiFields } from "../ai-call.js";
import { buildScope, checkFieldValue, resolveBindings } from "../bindings.js";
import { describeJson, isRecord } from "../bounds.js";
import { callOperation, performEffect } from "../call.js";
import { ROUNDS_COUNTER, ROUND_STRIDE } from "../constants.js";
import { failItem } from "../item-failure.js";
import type { FlowItem, NodeCall, NodeOutcome, StopReason } from "../types.js";

interface OperationNodeSpec {
  operationId: string;
  args: Readonly<Record<string, FieldBinding>>;
  /** The name the result is attached under: `{{ nodes.<scopeKey>.* }}`. */
  scopeKey: string;
  /** Runs after a live write that this tick made (not one it found already done). */
  afterWrite?: (item: FlowItem) => Promise<void>;
}

type ItemResult =
  | { kind: "ok"; item: FlowItem }
  | { kind: "failed" }
  | { kind: "stop"; stop: StopReason };

const WOULD_CALL_SAMPLES = 3;

function attach(item: FlowItem, scopeKey: string, value: unknown): FlowItem {
  return { ...item, nodes: { ...item.nodes, [scopeKey]: value } };
}

/**
 * A write's result as later nodes read it: the response, with the receipt's
 * `externalRef` and `url` at the top. A response too big to keep is dropped
 * and says so, because the write already happened and failing the item now
 * would only make the next attempt do it again. A write found already done
 * has only the part of its response the receipt kept, and says so too.
 */
function writeResult(
  output: unknown,
  externalRef: string | undefined,
  url: string | undefined,
  outputTruncated: boolean,
): Record<string, unknown> {
  let base: Record<string, unknown> = {};
  if (isRecord(output)) base = { ...output };
  else if (output !== undefined && output !== null) base = { value: output };
  try {
    assertWithinStepCap([base], { maxItems: 1 });
  } catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    base = { outputDropped: true, outputBytes: jsonByteLength(base) };
  }
  return {
    ...base,
    ...(outputTruncated ? { outputTruncated: true } : {}),
    ...(externalRef === undefined ? {} : { externalRef }),
    ...(url === undefined ? {} : { url }),
  };
}

function dryWriteResult(def: OperationDefinition): Record<string, unknown> {
  return {
    dryRun: true,
    operation: def.id,
    ...(def.receipt ? { externalRef: "(dry run)" } : {}),
    ...(def.receipt?.url ? { url: "(dry run)" } : {}),
  };
}

/**
 * Lookup, Action and Agent run the same way: fill an operation's fields for
 * each item, call it, attach what came back. A read runs in every mode. A
 * write runs under a receipt in a live run; in a dry or test run it is
 * resolved and recorded but never called.
 */
export async function runOperationNode(
  call: NodeCall,
  spec: OperationNodeSpec,
): Promise<NodeOutcome> {
  const { ctx, step } = call;
  const def = ctx.host.catalog.get(spec.operationId);
  if (!def) {
    throw new WorkflowError(
      "graph_invalid",
      `Operation "${spec.operationId}" is not in the catalog.`,
    );
  }

  const out: FlowItem[] = [];
  const wouldCall: { item: string; fields: unknown }[] = [];
  let reused = 0;
  let stop: StopReason | undefined;
  let deferred = 0;

  const runItem = async (item: FlowItem): Promise<ItemResult> => {
    const counters = await ctx.runtime.countersOf(item.id);
    const resolved = resolveBindings(
      spec.args,
      def,
      buildScope(ctx, item, counters, call.node.id),
    );
    if (!resolved.ok) {
      await failItem(call, item, resolved.failure);
      return { kind: "failed" };
    }
    const fields = resolved.fields;

    if (resolved.aiBindings.length > 0) {
      const filled = await fillAiFields(
        ctx,
        step,
        item,
        resolved.aiBindings,
        call.node.id,
      );
      if (filled.kind === "stop") return filled;
      if (filled.kind === "failed") {
        await failItem(call, item, filled.failure);
        return { kind: "failed" };
      }
      for (const binding of resolved.aiBindings) {
        const value = filled.values[binding.name];
        const problem = checkFieldValue(binding.field, value);
        if (problem) {
          await failItem(call, item, {
            code: "ai_invalid_output",
            retryable: true,
            message: `args.${binding.name}: ${problem}`,
          });
          return { kind: "failed" };
        }
        fields[binding.name] = value;
      }
    }

    if (def.effect === "read") {
      const result = await callOperation(ctx, {
        operation: def,
        fields,
        credentialSlot: def.credential.provider,
        mode: ctx.mode,
        signal: ctx.signal,
      });
      if (!result.ok) {
        await failItem(call, item, {
          code: result.code,
          message: result.message,
          ...(result.retryable && result.sideEffect === "none"
            ? { retryable: true }
            : {}),
        });
        return { kind: "failed" };
      }
      if (result.output === undefined) {
        await failItem(call, item, {
          code: "lookup_failed",
          message: `${def.id} returned no output, which is not the same as an empty result.`,
        });
        return { kind: "failed" };
      }
      try {
        assertWithinStepCap([result.output], { maxItems: 1 });
      } catch (error) {
        if (!(error instanceof WorkflowError)) throw error;
        await failItem(call, item, {
          code: error.code,
          message: error.message,
        });
        return { kind: "failed" };
      }
      ctx.runtime.record({
        itemId: item.id,
        nodeId: call.node.id,
        kind: "output",
        summary: `${spec.scopeKey}: ${describeJson(result.output, 1500)}`,
      });
      return { kind: "ok", item: attach(item, spec.scopeKey, result.output) };
    }

    if (!ctx.runtime.live) {
      wouldCall.push({ item: item.id, fields });
      ctx.runtime.record({
        itemId: item.id,
        nodeId: call.node.id,
        kind: "effect",
        port: "out",
        summary: `would call ${def.id} with ${describeJson(fields, 1500)}`,
      });
      return {
        kind: "ok",
        item: attach(item, spec.scopeKey, dryWriteResult(def)),
      };
    }

    const effect = await performEffect(ctx, {
      nodeId: call.node.id,
      itemId: item.id,
      def,
      fields,
      ...(item.receiptSalt === undefined ? {} : { salt: item.receiptSalt }),
      firstAttempt: (counters[ROUNDS_COUNTER] ?? 0) * ROUND_STRIDE,
    });
    step.receipt(effect.receiptKey);
    if (effect.kind === "needs_check") {
      await failItem(
        call,
        item,
        { code: "effect_needs_check", message: effect.message },
        { needsCheck: true },
      );
      return { kind: "failed" };
    }
    if (effect.kind === "failed") {
      await failItem(call, item, effect.failure);
      return { kind: "failed" };
    }
    if (effect.reused) reused += 1;
    ctx.runtime.wrote(item.id, effect.at);
    ctx.runtime.record({
      itemId: item.id,
      nodeId: call.node.id,
      kind: "effect",
      port: "out",
      receiptKey: effect.receiptKey,
      summary: `${effect.reused ? "already done, reused" : "called"} ${def.id}${effect.externalRef === undefined ? "" : ` -> ${effect.externalRef}`}${effect.url === undefined ? "" : ` (${effect.url})`}`,
    });
    if (!effect.reused) await spec.afterWrite?.(item);
    return {
      kind: "ok",
      item: attach(
        item,
        spec.scopeKey,
        writeResult(
          effect.output,
          effect.externalRef,
          effect.url,
          effect.outputTruncated === true,
        ),
      ),
    };
  };

  for (const [index, item] of call.input.entries()) {
    const reason = ctx.stopReason();
    if (reason) {
      stop = reason;
      deferred = call.input.length - index;
      break;
    }
    const result = await runItem(item);
    if (result.kind === "stop") {
      stop = result.stop;
      deferred = call.input.length - index;
      break;
    }
    if (result.kind === "ok") out.push(result.item);
  }

  step.field("operation", def.id);
  if (reused > 0) step.field("reused", reused);
  if (wouldCall.length > 0) {
    step.field("wouldCallCount", wouldCall.length);
    step.field(
      "wouldCall",
      wouldCall.slice(0, WOULD_CALL_SAMPLES).map((entry) => ({
        item: entry.item,
        fields: describeJson(entry.fields, 400),
      })),
    );
  }
  if (deferred > 0) step.field("deferred", deferred);
  return { itemsByPort: { out }, ...(stop ? { stop } : {}) };
}
