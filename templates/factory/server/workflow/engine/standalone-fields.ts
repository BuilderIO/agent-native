import type { WorkflowGraph, WorkflowNodeOfKind } from "../contract.js";
import type { OperationDefinition } from "../operations.js";
import { buildScope, resolveBindings } from "./bindings.js";
import type { ItemFailure } from "./types.js";
import { runWindowOfGraph } from "./window.js";

export type StandaloneFields =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; failure: ItemFailure };

/**
 * The field values of a lookup that reads nothing about an item, as a run would
 * resolve them: the same bindings, the same `{{ }}` and path evaluation, over
 * the workflow's settings and a run that starts now, with no item. A path with
 * no value fails here as it fails in a run. A binding a model would write needs
 * an item, so it is refused; `canTestWithoutItems` has already ruled those out.
 */
export function resolveStandaloneFields(args: {
  node: WorkflowNodeOfKind<"lookup">;
  def: OperationDefinition;
  graph: WorkflowGraph;
  lastTriggerAt: string | null;
  now: Date;
  runId: string;
}): StandaloneFields {
  const { node, def, graph, now } = args;
  const trigger = graph.nodes.find(
    (candidate): candidate is WorkflowNodeOfKind<"trigger"> =>
      candidate.kind === "trigger",
  );
  const window = trigger
    ? runWindowOfGraph({
        graph,
        trigger,
        lastTriggerAt: args.lastTriggerAt,
        end: now,
      })
    : undefined;
  if (!window?.ok) {
    return {
      ok: false,
      failure: {
        code: "engine_error",
        message: window?.message ?? "The graph has no trigger.",
      },
    };
  }
  const scope = buildScope(
    {
      graph,
      run: { id: args.runId, startedAt: now.toISOString() },
      mode: "test",
      window: window.window,
      scheduledFor: null,
    },
    undefined,
    {},
    node.id,
  );
  const resolved = resolveBindings(node.settings.args, def, scope);
  if (!resolved.ok) return resolved;
  if (resolved.aiBindings.length > 0) {
    return {
      ok: false,
      failure: {
        code: "graph_invalid",
        message:
          "A field a model writes needs an item, so this step has no test on its own.",
      },
    };
  }
  return { ok: true, fields: resolved.fields };
}
