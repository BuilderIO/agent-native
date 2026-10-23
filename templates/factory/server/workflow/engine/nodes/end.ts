import type { RecordBinding } from "../../contract.js";
import {
  evaluatePath,
  renderTemplate,
  validatePath,
  type Scope,
} from "../../expressions.js";
import { buildScope } from "../bindings.js";
import { END_STATUS } from "../constants.js";
import { failItem } from "../item-failure.js";
import { resolveTemplates } from "../templates.js";
import type { ItemFailure, NodeExecutorFor } from "../types.js";

type Recorded =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; failure: ItemFailure };

/**
 * The values an End writes onto an item, for one item. A binding with no value
 * here fails the item: a field the next story reads is never left out quietly.
 */
function resolveRecord(
  record: Readonly<Record<string, RecordBinding>>,
  scope: Scope,
): Recorded {
  const values: Record<string, unknown> = {};
  for (const [name, binding] of Object.entries(record)) {
    const missing = (why: string): Recorded => ({
      ok: false,
      failure: { code: "expression_failed", message: `record.${name}: ${why}` },
    });
    if (binding.mode === "fixed") {
      const resolved = resolveTemplates(binding.value, scope);
      if (!resolved.ok) return missing(resolved.error.message);
      values[name] = resolved.value;
      continue;
    }
    const check = validatePath(binding.path);
    if (!check.ok) return missing(check.error.message);
    const found = evaluatePath(check.path, scope);
    if (!found.found) return missing(`"${binding.path}" has no value here.`);
    values[name] = found.value;
  }
  return { ok: true, values };
}

/**
 * Finishes each item with the node's outcome. `done` and `dismissed` and
 * `needsManual` move the inbox item to its status (or to `setStatus`);
 * `released` changes nothing, so the item is offered again next tick. A reason
 * that cannot be written for an item fails it rather than ending it blank, and
 * so does a `record` value with nothing to read. Only a live run writes a
 * status and the recorded values with it; a dry or test run records what it
 * would write.
 */
export const executeEnd: NodeExecutorFor<"end"> = async (call) => {
  const { ctx, node, input, step } = call;
  const { outcome, reason, setStatus, record } = node.settings;
  const status = setStatus ?? END_STATUS[outcome];
  step.field("outcome", outcome);
  // A dry or test run moves no item, and says which status a live run would write.
  if (!ctx.runtime.live && status !== null) {
    step.field("wouldSetStatus", status);
  }
  if (record !== undefined) {
    step.field("records", Object.keys(record));
  }
  for (const item of input) {
    const counters = await ctx.runtime.countersOf(item.id);
    const scope = buildScope(ctx, item, counters, node.id);
    let rendered: string | undefined;
    if (reason !== undefined) {
      const written = renderTemplate(reason, scope);
      if (!written.ok) {
        await failItem(call, item, {
          code: "expression_failed",
          message: `reason: ${written.error.message}`,
        });
        continue;
      }
      rendered = written.value;
    }
    let extras: Record<string, unknown> | undefined;
    if (record !== undefined) {
      const recorded = resolveRecord(record, scope);
      if (!recorded.ok) {
        await failItem(call, item, recorded.failure);
        continue;
      }
      extras = recorded.values;
    }
    const ended = await ctx.runtime.end(item, {
      nodeId: node.id,
      outcome,
      status,
      ...(rendered === undefined ? {} : { reason: rendered }),
      ...(extras === undefined ? {} : { extras }),
    });
    if (!ended.ok) await failItem(call, item, ended.failure);
  }
  return { itemsByPort: {} };
};
