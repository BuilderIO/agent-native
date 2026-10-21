import type {
  AiFailureCode,
  AiTurnItem,
  AiTurnRequest,
  AiTurnResult,
} from "../adapter.js";
import type { ResultField } from "../contract.js";
import { resultFieldFor, validateAiFields } from "./ai-fields.js";
import type { AiBinding } from "./bindings.js";
import type { StepBuilder } from "./step-builder.js";
import type {
  FlowItem,
  ItemFailure,
  StopReason,
  TickContext,
} from "./types.js";

/** One repair: the model sees its bad answer and the error, then fails the item. */
export const MAX_AI_REPAIRS = 1;

export function aiTurnItem(item: FlowItem): AiTurnItem {
  return { id: item.id, item: item.data, nodes: item.nodes };
}

function modelCapStop(ctx: TickContext): StopReason {
  return {
    code: "ai_cap_reached",
    message: `The model-call cap of ${ctx.budget.cap} for this run was reached.`,
  };
}

type AiInvocation =
  | { kind: "stop"; stop: StopReason }
  | { kind: "answered"; result: AiTurnResult };

/**
 * Runs one turn, unless the run has no model calls left. The cap is a pause,
 * not a failure: an item the model never saw is not an item it got wrong.
 */
export async function invokeAi(
  ctx: TickContext,
  step: StepBuilder,
  request: Omit<AiTurnRequest, "budget" | "signal" | "runId">,
): Promise<AiInvocation> {
  if (ctx.budget.remainingModelCalls() < 1) {
    return { kind: "stop", stop: modelCapStop(ctx) };
  }
  const result = await ctx.host.ai.run({
    ...request,
    budget: ctx.budget,
    signal: ctx.signal,
    runId: ctx.run.id,
  });
  if (result.threadId !== undefined) step.thread(result.threadId);
  if (result.threadPersistError !== undefined) {
    step.problem("threadPersistError", result.threadPersistError);
  }
  if (result.usageRecordError !== undefined) {
    step.problem("usageRecordError", result.usageRecordError);
  }
  if (result.ok && result.inputTruncated) step.inputTruncated();
  if (!result.ok && result.code === "budget") {
    return { kind: "stop", stop: modelCapStop(ctx) };
  }
  return { kind: "answered", result };
}

const AI_FAILURE_CODES: Readonly<Record<AiFailureCode, ItemFailure["code"]>> = {
  no_result: "ai_invalid_output",
  result_invalid: "ai_invalid_output",
  timeout: "provider_error",
  budget: "ai_cap_reached",
  credentials: "credential_missing",
  engine_error: "engine_error",
};

// A model that gave no usable answer, ran out of time, or hit an engine fault may answer next time;
// one with no credentials or no calls left will not.
const AI_FAILURES_WORTH_RETRYING: ReadonlySet<AiFailureCode> = new Set([
  "no_result",
  "result_invalid",
  "timeout",
  "engine_error",
]);

export function aiFailure(code: AiFailureCode, reason: string): ItemFailure {
  return {
    code: AI_FAILURE_CODES[code],
    message: `The AI turn failed (${code}): ${reason}`,
    ...(AI_FAILURES_WORTH_RETRYING.has(code) ? { retryable: true } : {}),
  };
}

type ItemAnswer =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; failure: ItemFailure };

/** What the model said about one item, checked; a missing or malformed answer fails that item. */
export function answerFor(
  result: Extract<AiTurnResult, { ok: true; mode: "perItem" }>,
  itemId: string,
  schema: Readonly<Record<string, ResultField>>,
): ItemAnswer {
  const outcome = result.results.find((entry) => entry.itemId === itemId);
  if (!outcome) {
    return {
      ok: false,
      failure: {
        code: "ai_invalid_output",
        retryable: true,
        message: "The AI turn returned nothing for this item.",
      },
    };
  }
  if (!outcome.ok) {
    return { ok: false, failure: aiFailure(outcome.code, outcome.reason) };
  }
  const checked = validateAiFields(outcome.fields, schema);
  return checked.ok
    ? checked
    : {
        ok: false,
        failure: {
          code: "ai_invalid_output",
          retryable: true,
          message: `The AI answer does not fit the declared fields: ${checked.message}.`,
        },
      };
}

type AiFill =
  | { kind: "filled"; values: Record<string, unknown> }
  | { kind: "failed"; failure: ItemFailure }
  | { kind: "stop"; stop: StopReason };

/** Has the model write the fields an action left to it, in one turn for the item. */
export async function fillAiFields(
  ctx: TickContext,
  step: StepBuilder,
  item: FlowItem,
  bindings: readonly AiBinding[],
  nodeId: string,
): Promise<AiFill> {
  const schema: Record<string, ResultField> = {};
  for (const binding of bindings) {
    const field = resultFieldFor(binding.field);
    if (field === null) {
      return {
        kind: "failed",
        failure: {
          code: "graph_invalid",
          message: `"${binding.name}" cannot be written by the model.`,
        },
      };
    }
    schema[binding.name] = field;
  }
  const [only] = bindings;
  const instruction =
    bindings.length === 1
      ? only.instruction
      : `Write each of these fields:\n${bindings.map((binding) => `- ${binding.name}: ${binding.instruction}`).join("\n")}`;

  const invocation = await invokeAi(ctx, step, {
    instruction,
    items: [aiTurnItem(item)],
    mode: "perItem",
    resultSchemaFields: schema,
    maxRepairs: MAX_AI_REPAIRS,
    tools: [],
    nodeId,
  });
  if (invocation.kind === "stop") return invocation;
  const { result } = invocation;
  if (!result.ok)
    return { kind: "failed", failure: aiFailure(result.code, result.reason) };
  if (result.mode !== "perItem") {
    return {
      kind: "failed",
      failure: {
        code: "ai_invalid_output",
        retryable: true,
        message:
          "The AI runner answered for the whole list when asked for one item.",
      },
    };
  }
  const answer = answerFor(result, item.id, schema);
  return answer.ok
    ? { kind: "filled", values: answer.fields }
    : { kind: "failed", failure: answer.failure };
}
