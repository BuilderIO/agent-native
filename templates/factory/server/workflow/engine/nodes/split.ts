import { evaluatePath, validatePath } from "../../expressions.js";
import { buildScope } from "../bindings.js";
import { isRecord } from "../bounds.js";
import { failItem } from "../item-failure.js";
import type { FlowItem, NodeExecutorFor } from "../types.js";

const MAX_ID_LENGTH = 200;

/**
 * One item with a list becomes one item per entry. An entry that names its own
 * `id` keeps it, so a list of reports splits back into the reports it was
 * built from. Every child still reads what the parent carried.
 */
export const executeSplit: NodeExecutorFor<"split"> = async (call) => {
  const { ctx, node, input } = call;
  const out: FlowItem[] = [];
  for (const item of input) {
    const counters = await ctx.runtime.countersOf(item.id);
    const check = validatePath(node.settings.field);
    if (!check.ok) {
      await failItem(call, item, {
        code: "expression_failed",
        message: check.error.message,
      });
      continue;
    }
    const found = evaluatePath(
      check.path,
      buildScope(ctx, item, counters, node.id),
    );
    if (!found.found) {
      await failItem(call, item, {
        code: "expression_failed",
        message: `"${node.settings.field}" has no value here.`,
      });
      continue;
    }
    if (!Array.isArray(found.value)) {
      await failItem(call, item, {
        code: "expression_failed",
        message: `"${node.settings.field}" is not a list, so it cannot be split.`,
      });
      continue;
    }
    const children = found.value.map((entry, index): FlowItem => {
      const named =
        isRecord(entry) &&
        typeof entry.id === "string" &&
        entry.id !== "" &&
        entry.id.length <= MAX_ID_LENGTH;
      const id = named ? (entry.id as string) : `${item.id}#${index}`;
      return {
        id,
        data: isRecord(entry) ? entry : { value: entry },
        nodes: item.nodes,
        inbox: item.members?.includes(id) === true,
      };
    });
    ctx.runtime.split(item, node.id, children);
    ctx.runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "output",
      port: "out",
      summary: `split into ${children.length} item${children.length === 1 ? "" : "s"}`,
    });
    for (const child of children) {
      ctx.runtime.record({
        itemId: child.id,
        nodeId: node.id,
        kind: "output",
        summary: `split from ${item.id}`,
      });
    }
    out.push(...children);
  }
  return { itemsByPort: { out } };
};
