import { nodeScopeKey } from "../../contract.js";
import type { NodeExecutorFor } from "../types.js";
import { runOperationNode } from "./operation-node.js";

/** Writes to an outside tool, once per item, under a receipt. */
export const executeAction: NodeExecutorFor<"action"> = (call) =>
  runOperationNode(call, {
    operationId: call.node.settings.operation,
    args: call.node.settings.args,
    scopeKey: nodeScopeKey(call.node),
  });
