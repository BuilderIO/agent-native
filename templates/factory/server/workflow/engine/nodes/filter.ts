import { OTHERWISE_PORT } from "../../ports.js";
import { buildScope } from "../bindings.js";
import { failItem } from "../item-failure.js";
import { evaluateRules } from "../rules.js";
import type { FlowItem, NodeExecutorFor } from "../types.js";

const MATCH_PORT = "match";

/**
 * Sends each item to Match or Otherwise. An item whose rules cannot be
 * evaluated (a path with no value, values that cannot be compared) goes to
 * neither: it fails, rather than quietly counting as "no match".
 */
export const executeFilter: NodeExecutorFor<"filter"> = async (call) => {
  const { ctx, node, input } = call;
  const match: FlowItem[] = [];
  const otherwise: FlowItem[] = [];
  for (const item of input) {
    const counters = await ctx.runtime.countersOf(item.id);
    const outcome = evaluateRules(
      node.settings.combinator,
      node.settings.rules,
      buildScope(ctx, item, counters, node.id),
      ctx.now(),
    );
    if (!outcome.ok) {
      await failItem(call, item, {
        code: "expression_failed",
        message: outcome.message,
      });
      continue;
    }
    const port = outcome.matched ? MATCH_PORT : OTHERWISE_PORT;
    (outcome.matched ? match : otherwise).push(item);
    ctx.runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "decision",
      port,
      summary: outcome.matched ? "matched" : "did not match",
    });
  }
  return { itemsByPort: { [MATCH_PORT]: match, [OTHERWISE_PORT]: otherwise } };
};
