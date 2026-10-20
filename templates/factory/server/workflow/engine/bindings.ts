import { loopCounterKey, type FieldBinding } from "../contract.js";
import { evaluatePath, validatePath, type Scope } from "../expressions.js";
import type { OperationDefinition, OperationField } from "../operations.js";
import { resultFieldFor } from "./ai-fields.js";
import type { LoopInfo } from "./graph-order.js";
import { resolveTemplates } from "./templates.js";
import type { FlowItem, ItemFailure, TickContext } from "./types.js";

/**
 * `{{ loop.iteration }}` and `{{ loop.max }}` for a node inside a loop: how
 * many times this item has been sent back around so far (0 on its first pass)
 * and how many times it may be. A node outside every loop has neither, so a
 * path to one fails instead of reading as zero.
 */
function loopScope(
  loops: readonly LoopInfo[] | undefined,
  nodeId: string | undefined,
  counters: Readonly<Record<string, number>>,
): Record<string, unknown> {
  const loop =
    nodeId === undefined
      ? undefined
      : loops?.find((candidate) => candidate.body.has(nodeId));
  return loop
    ? {
        iteration: counters[loopCounterKey(loop.edgeId)] ?? 0,
        max: loop.max,
      }
    : {};
}

/**
 * What `{{ item.* }}`, `{{ nodes.* }}`, `{{ settings.* }}`, `{{ run.* }}` and
 * `{{ loop.* }}` read for one item at one node. The engine's own `id` and
 * counters win over a data field of the same name, so `item.id` and
 * `item.attempts` can be trusted. `item.rounds` is how many times the item has
 * been released to come back next tick or sent back around a loop; a group item
 * that is released only on one path counts the visits that took that path.
 */
export function buildScope(
  ctx: Pick<TickContext, "graph" | "run" | "mode" | "window" | "scheduledFor"> &
    Partial<Pick<TickContext, "loops">>,
  item: FlowItem | undefined,
  counters: Readonly<Record<string, number>> = {},
  nodeId?: string,
): Scope {
  return {
    item:
      item === undefined
        ? undefined
        : {
            ...item.data,
            id: item.id,
            attempts: counters.attempts ?? 0,
            nudges: counters.nudges ?? 0,
            rounds: counters.rounds ?? 0,
          },
    nodes: item?.nodes ?? {},
    settings: { ...ctx.graph.settings },
    run: {
      id: ctx.run.id,
      mode: ctx.mode,
      startedAt: ctx.run.startedAt,
      scheduledFor: ctx.scheduledFor,
      windowStart: ctx.window.start,
      windowEnd: ctx.window.end,
    },
    loop: loopScope(ctx.loops, nodeId, counters),
  };
}

export interface AiBinding {
  name: string;
  instruction: string;
  field: OperationField;
}

type ResolvedBindings =
  | {
      ok: true;
      fields: Record<string, unknown>;
      aiBindings: AiBinding[];
    }
  | { ok: false; failure: ItemFailure };

const fail = (
  code: ItemFailure["code"],
  message: string,
): { ok: false; failure: ItemFailure } => ({
  ok: false,
  failure: { code, message },
});

function describeKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** Null when `value` fits the declared field; otherwise what is wrong with it. */
export function checkFieldValue(
  field: OperationField,
  value: unknown,
): string | null {
  switch (field.type) {
    case "string":
    case "text":
      return typeof value === "string"
        ? null
        : `expected text but got ${describeKind(value)}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `expected a number but got ${describeKind(value)}`;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `expected true or false but got ${describeKind(value)}`;
    case "enum":
      return typeof value === "string" && (field.enum ?? []).includes(value)
        ? null
        : `expected one of ${(field.enum ?? []).join(", ")} but got ${JSON.stringify(value)}`;
    case "json":
      return value === undefined ? "expected a value" : null;
  }
}

/**
 * Turns a node's argument bindings into the operation's field values for one
 * item. Fixed text and paths are filled from the scope; an AI-written binding
 * is returned for the caller to have the model write. A path with no value, or
 * a value of the wrong type, fails the item instead of reaching the provider.
 */
export function resolveBindings(
  args: Readonly<Record<string, FieldBinding>>,
  def: OperationDefinition,
  scope: Scope,
): ResolvedBindings {
  const fields: Record<string, unknown> = {};
  const aiBindings: AiBinding[] = [];

  for (const field of def.fields) {
    if (field.default !== undefined && !(field.name in args)) {
      fields[field.name] = field.default;
    }
  }

  for (const [name, binding] of Object.entries(args)) {
    const field = def.fields.find((candidate) => candidate.name === name);
    if (!field) {
      return fail("graph_invalid", `${def.id} has no field "${name}".`);
    }
    switch (binding.mode) {
      case "fixed": {
        const resolved = resolveTemplates(binding.value, scope);
        if (!resolved.ok) {
          return fail(
            "expression_failed",
            `args.${name}: ${resolved.error.message}`,
          );
        }
        fields[name] = resolved.value;
        break;
      }
      case "path": {
        const check = validatePath(binding.path);
        if (!check.ok) {
          return fail(
            "expression_failed",
            `args.${name}: ${check.error.message}`,
          );
        }
        const found = evaluatePath(check.path, scope);
        if (!found.found) {
          return fail(
            "expression_failed",
            `args.${name}: "${binding.path}" has no value here.`,
          );
        }
        fields[name] = found.value;
        break;
      }
      case "ai":
        if (resultFieldFor(field) === null) {
          return fail(
            "graph_invalid",
            `args.${name}: a ${field.type} field cannot be written by the model.`,
          );
        }
        aiBindings.push({ name, instruction: binding.instruction, field });
        break;
    }
  }

  for (const [name, value] of Object.entries(fields)) {
    const field = def.fields.find((candidate) => candidate.name === name);
    const problem = field ? checkFieldValue(field, value) : null;
    if (problem) return fail("expression_failed", `args.${name}: ${problem}`);
  }
  return { ok: true, fields, aiBindings };
}
