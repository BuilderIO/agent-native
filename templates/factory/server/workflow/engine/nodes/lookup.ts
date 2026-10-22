import { nodeScopeKey } from "../../contract.js";
import type { NodeExecutorFor } from "../types.js";
import { runOperationNode } from "./operation-node.js";

/** Reads one thing about each item and attaches it under the node's name. */
export const executeLookup: NodeExecutorFor<"lookup"> = (call) =>
  runOperationNode(call, {
    operationId: call.node.settings.operation,
    args: call.node.settings.args,
    scopeKey: nodeScopeKey(call.node),
  });
