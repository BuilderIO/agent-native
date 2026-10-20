import { OTHERWISE_PORT, portsFor, routePort } from "../../ports.js";
import { buildScope } from "../bindings.js";
import { failItem } from "../item-failure.js";
import { evaluateRules } from "../rules.js";
import type { FlowItem, NodeExecutorFor } from "../types.js";

/**
 * Sends each item down the first route whose rules it meets, or Otherwise.
 * Every route's rules are read for every item, so a broken rule fails the item
 * on each pass and not only when an earlier route did not catch it.
 */
export const executeSwitch: NodeExecutorFor<"switch"> = async (call) => {
  const { ctx, node, input } = call;
  const byPort: Record<string, FlowItem[]> = Object.fromEntries(
    portsFor(node).map((port) => [port, []]),
  );
  for (const item of input) {
    const counters = await ctx.runtime.countersOf(item.id);
    const scope = buildScope(ctx, item, counters, node.id);
    let chosen: { port: string; label: string } = {
      port: OTHERWISE_PORT,
      label: "Otherwise",
    };
    let failure: string | undefined;
    for (const route of node.settings.routes) {
      const outcome = evaluateRules(
        route.combinator,
        route.rules,
        scope,
        ctx.now(),
      );
      if (!outcome.ok) {
        failure = `route "${route.id}": ${outcome.message}`;
        break;
      }
      if (outcome.matched && chosen.port === OTHERWISE_PORT) {
        chosen = { port: routePort(route.id), label: route.label };
      }
    }
    if (failure !== undefined) {
      await failItem(call, item, {
        code: "expression_failed",
        message: failure,
      });
      continue;
    }
    byPort[chosen.port].push(item);
    ctx.runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "decision",
      port: chosen.port,
      summary: `route: ${chosen.label}`,
    });
  }
  return { itemsByPort: byPort };
};
