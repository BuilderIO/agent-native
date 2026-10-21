import { nodeScopeKey } from "../../contract.js";
import { NUDGES_COUNTER } from "../constants.js";
import type { NodeExecutorFor } from "../types.js";
import { runOperationNode } from "./operation-node.js";

/**
 * Hands work to another agent, or reads how it is going. The operation is
 * `<agent>.<op>`, so `builder` + `followUp` is `builder.followUp`. Each
 * follow-up that goes out counts as a nudge, which is what `{{ item.nudges }}`
 * reads when a graph limits how often it asks.
 */
export const executeAgent: NodeExecutorFor<"agent"> = (call) => {
  const { agent, op, args } = call.node.settings;
  return runOperationNode(call, {
    operationId: `${agent}.${op}`,
    args,
    scopeKey: nodeScopeKey(call.node),
    afterWrite:
      op === "followUp"
        ? async (item) => {
            await call.ctx.runtime.bump(item.id, NUDGES_COUNTER);
          }
        : undefined,
  });
};
