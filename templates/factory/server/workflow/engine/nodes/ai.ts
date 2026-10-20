import { nodeScopeKey } from "../../contract.js";
import {
  aiFailure,
  aiTurnItem,
  answerFor,
  invokeAi,
  MAX_AI_REPAIRS,
} from "../ai-call.js";
import { validateAiFields } from "../ai-fields.js";
import { describeJson, stableHash } from "../bounds.js";
import { failItem } from "../item-failure.js";
import { collectMembers } from "../members.js";
import type {
  FlowItem,
  ItemFailure,
  NodeCall,
  NodeExecutorFor,
  StopReason,
} from "../types.js";

/**
 * The id of a whole-list answer comes from the items it is about, never from
 * the run: the same items coming round again are the same answer, so a write
 * made for it is not made twice, and a run that retries it finds its receipt.
 */
function wholeListItemId(nodeId: string, itemIds: readonly string[]): string {
  return `ai:${nodeId}:${stableHash(JSON.stringify([...itemIds].sort()))}`;
}

function attach(item: FlowItem, scopeKey: string, fields: unknown): FlowItem {
  return { ...item, nodes: { ...item.nodes, [scopeKey]: fields } };
}

/**
 * Has the model judge items and return declared fields. Per item, the input
 * goes in batches of `batchSize` and every item gets its own answer; for the
 * whole list, one answer covers all of them and one item comes out standing
 * for the lot. Prose, a missing answer, or fields that do not fit fail the
 * item, never reach the next node. With nothing to judge, no call is made.
 */
export const executeAi: NodeExecutorFor<"ai"> = async (call) => {
  const { ctx, node, input, step } = call;
  const { instruction, result: schema, mode, tools, batchSize } = node.settings;
  const scopeKey = nodeScopeKey(node);
  if (input.length === 0) return { itemsByPort: { out: [] } };

  const request = {
    instruction,
    resultSchemaFields: schema,
    maxRepairs: MAX_AI_REPAIRS,
    tools,
    nodeId: node.id,
    ...(node.settings.inputBudgetTokens === undefined
      ? {}
      : { inputBudgetTokens: node.settings.inputBudgetTokens }),
  };
  const failAll = async (items: readonly FlowItem[], failure: ItemFailure) => {
    for (const item of items) await failItem(call, item, failure);
  };

  if (mode === "wholeList") {
    const stopped = ctx.stopReason();
    if (stopped) return stopOutcome(step, stopped, input, []);
    const invocation = await invokeAi(ctx, step, {
      ...request,
      items: input.map(aiTurnItem),
      mode: "wholeList",
    });
    if (invocation.kind === "stop") {
      return stopOutcome(step, invocation.stop, input, []);
    }
    const { result } = invocation;
    if (!result.ok) {
      await failAll(input, aiFailure(result.code, result.reason));
      return { itemsByPort: { out: [] } };
    }
    if (result.mode !== "wholeList") {
      await failAll(input, {
        code: "ai_invalid_output",
        retryable: true,
        message:
          "The AI runner answered per item when asked for the whole list.",
      });
      return { itemsByPort: { out: [] } };
    }
    const checked = validateAiFields(result.fields, schema);
    if (!checked.ok) {
      await failAll(input, {
        code: "ai_invalid_output",
        retryable: true,
        message: `The AI answer does not fit the declared fields: ${checked.message}.`,
      });
      return { itemsByPort: { out: [] } };
    }
    ctx.runtime.fold(input, node.id);
    const combined: FlowItem = {
      id: wholeListItemId(
        node.id,
        input.map((item) => item.id),
      ),
      data: { count: input.length, itemIds: input.map((item) => item.id) },
      nodes: { [scopeKey]: checked.fields },
      inbox: false,
      members: collectMembers(input),
    };
    ctx.runtime.record({
      itemId: combined.id,
      nodeId: node.id,
      kind: "output",
      port: "out",
      ...(result.threadId === undefined ? {} : { threadId: result.threadId }),
      summary: describeJson(checked.fields, 1500),
    });
    return { itemsByPort: { out: [combined] } };
  }

  const out: FlowItem[] = [];
  for (let from = 0; from < input.length; from += batchSize) {
    const batch = input.slice(from, from + batchSize);
    const stopped = ctx.stopReason();
    if (stopped) return stopOutcome(step, stopped, input.slice(from), out);
    const invocation = await invokeAi(ctx, step, {
      ...request,
      items: batch.map(aiTurnItem),
      mode: "perItem",
    });
    if (invocation.kind === "stop") {
      return stopOutcome(step, invocation.stop, input.slice(from), out);
    }
    const { result } = invocation;
    if (!result.ok) {
      await failAll(batch, aiFailure(result.code, result.reason));
      continue;
    }
    if (result.mode !== "perItem") {
      await failAll(batch, {
        code: "ai_invalid_output",
        retryable: true,
        message:
          "The AI runner answered for the whole list when asked per item.",
      });
      continue;
    }
    for (const item of batch) {
      const answer = answerFor(result, item.id, schema);
      if (!answer.ok) {
        await failItem(call, item, answer.failure);
        continue;
      }
      ctx.runtime.record({
        itemId: item.id,
        nodeId: node.id,
        kind: "output",
        ...(result.threadId === undefined ? {} : { threadId: result.threadId }),
        summary: describeJson(answer.fields, 1500),
      });
      out.push(attach(item, scopeKey, answer.fields));
    }
  }
  return { itemsByPort: { out } };
};

function stopOutcome(
  step: NodeCall["step"],
  stop: StopReason,
  unfinished: readonly FlowItem[],
  out: FlowItem[],
) {
  step.field("deferred", unfinished.length);
  return { itemsByPort: { out }, stop, unfinished };
}
