import {
  isWriteAllowedForNode,
  workflowNodeSchema,
  type FieldBinding,
  type NodeKind,
  type OperationDefinition,
  type OperationNodeKind,
  type WorkflowNode,
  type WorkflowNodeSettings,
} from "./engine.js";
import { reject, type NodeVariant, type Outcome } from "./types.js";
import type { WorkflowCatalog } from "./types.js";

/** Content a new node starts with; the author is expected to replace it. */
const DEFAULT_AI_INSTRUCTION = "Describe what to decide.";
const DEFAULT_RESULT_FIELD = "answer";
const DEFAULT_SPLIT_FIELD = "item.extras.items";
const DEFAULT_RULE_LEFT = "item.title";

const KINDS_WITH_OPERATIONS: readonly NodeKind[] = [
  "source",
  "lookup",
  "action",
  "agent",
  "wait",
];

export function operationDefaultBinding(
  field: OperationDefinition["fields"][number],
): FieldBinding {
  if (field.default !== undefined)
    return { mode: "fixed", value: field.default };
  switch (field.type) {
    case "number":
      return { mode: "fixed", value: 0 };
    case "boolean":
      return { mode: "fixed", value: false };
    case "enum":
      return { mode: "fixed", value: field.enum?.[0] ?? "" };
    case "json":
      return { mode: "fixed", value: {} };
    default:
      return { mode: "fixed", value: "" };
  }
}

/**
 * Parameters the engine fills itself: the cursor of a polling source and the
 * window of a windowed one. They are not the author's to set.
 */
export function engineManagedParams(def: OperationDefinition): Set<string> {
  return new Set(
    [def.cursor?.param, def.window?.fromParam, def.window?.toParam].filter(
      (name): name is string => name !== undefined,
    ),
  );
}

export function defaultArgs(
  def: OperationDefinition,
): Record<string, FieldBinding> {
  const managed = engineManagedParams(def);
  const args: Record<string, FieldBinding> = {};
  for (const field of def.fields) {
    if (field.required && !managed.has(field.name)) {
      args[field.name] = operationDefaultBinding(field);
    }
  }
  return args;
}

/** The operations a node of this kind may run, grouped by the order pickers show them. */
export function operationsForKind(
  catalog: WorkflowCatalog,
  kind: OperationNodeKind | "condition",
): OperationDefinition[] {
  const as: OperationNodeKind = kind === "condition" ? "lookup" : kind;
  return catalog
    .list()
    .filter(
      (def) =>
        isWriteAllowedForNode(def, as) &&
        (as !== "action" || def.effect === "write"),
    )
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label),
    );
}

function pickOperation(
  catalog: WorkflowCatalog,
  as: OperationNodeKind | "condition",
  operationId: string | undefined,
  prefer?: (def: OperationDefinition) => boolean,
): Outcome<{ def: OperationDefinition }> {
  if (operationId === undefined) {
    const [first] = operationsForKind(catalog, as).filter(
      prefer ?? (() => true),
    );
    return first
      ? { ok: true, def: first }
      : reject("operation_required", `The catalog has no operation for ${as}.`);
  }
  const def = catalog.get(operationId);
  const kind: OperationNodeKind = as === "condition" ? "lookup" : as;
  if (
    !def ||
    !isWriteAllowedForNode(def, kind) ||
    (kind === "action" && def.effect !== "write")
  ) {
    return reject(
      "operation_mismatch",
      `${operationId} cannot run as a ${as} node.`,
    );
  }
  return { ok: true, def };
}

function sourceSettings(
  catalog: WorkflowCatalog,
  operationId: string | undefined,
  variant: NodeVariant | undefined,
): Outcome<{ settings: unknown }> {
  const readsProvider =
    operationId !== undefined ||
    variant === "provider-query" ||
    variant === "window";
  if (!readsProvider) {
    return {
      ok: true,
      settings:
        variant === "status"
          ? { source: "status", status: "received", takeLimit: 10 }
          : { source: "inbox-poll", poller: "slack", takeLimit: 5 },
    };
  }
  const picked = pickOperation(
    catalog,
    "source",
    operationId,
    variant === "window" ? (def) => def.window !== undefined : undefined,
  );
  if (!picked.ok) return picked;
  const windowed = variant === "window" || (!variant && picked.def.window);
  return {
    ok: true,
    settings: windowed
      ? {
          source: "window",
          operation: picked.def.id,
          args: defaultArgs(picked.def),
          maxItems: 50,
        }
      : {
          source: "provider-query",
          operation: picked.def.id,
          args: defaultArgs(picked.def),
          memory: "inbox",
          maxItems: 50,
        },
  };
}

function waitSettings(
  catalog: WorkflowCatalog,
  operationId: string | undefined,
  variant: NodeVariant | undefined,
): Outcome<{ settings: unknown }> {
  if (variant === "time") {
    return {
      ok: true,
      settings: { wait: "time", duration: { amount: 1, unit: "hours" } },
    };
  }
  if (variant === "condition") {
    const picked = pickOperation(catalog, "condition", operationId);
    if (!picked.ok) return picked;
    return {
      ok: true,
      settings: {
        wait: "condition",
        operation: picked.def.id,
        args: defaultArgs(picked.def),
        rule: { left: DEFAULT_RULE_LEFT, op: "isTrue" },
        everyMinutes: 15,
        limitHours: 24,
      },
    };
  }
  return {
    ok: true,
    settings: { wait: "reply", limitHours: 24, acceptFrom: "anyone" },
  };
}

function combineSettings(variant: NodeVariant | undefined): unknown {
  switch (variant) {
    case "count":
      return { mode: "count" };
    case "groupBy":
      return { mode: "groupBy", key: DEFAULT_RULE_LEFT };
    case "summarize":
      return {
        mode: "summarize",
        summarize: {
          group: DEFAULT_RULE_LEFT,
          value: "item.extras.amount",
          agg: "sum",
        },
      };
    default:
      return { mode: "list" };
  }
}

function agentSettings(
  catalog: WorkflowCatalog,
  operationId: string | undefined,
): Outcome<{ settings: unknown }> {
  if (operationId === undefined) {
    const start = catalog.get("builder.start");
    return {
      ok: true,
      settings: {
        agent: "builder",
        op: "start",
        args: start ? defaultArgs(start) : {},
      },
    };
  }
  const picked = pickOperation(catalog, "agent", operationId);
  if (!picked.ok) return picked;
  const implementation = picked.def.implementation;
  if (implementation.type !== "builder") {
    return reject(
      "operation_mismatch",
      `${operationId} is not an agent operation.`,
    );
  }
  return {
    ok: true,
    settings: {
      agent: "builder",
      op: implementation.op,
      args: defaultArgs(picked.def),
    },
  };
}

function settingsFor(
  kind: NodeKind,
  catalog: WorkflowCatalog,
  operationId: string | undefined,
  variant: NodeVariant | undefined,
): Outcome<{ settings: unknown }> {
  const settings = (value: unknown) => ({ ok: true as const, settings: value });
  switch (kind) {
    case "trigger":
      return settings({ schedule: { every: "15m" } });
    case "source":
      return sourceSettings(catalog, operationId, variant);
    case "lookup":
    case "action": {
      const picked = pickOperation(catalog, kind, operationId);
      if (!picked.ok) return picked;
      return settings({
        operation: picked.def.id,
        args: defaultArgs(picked.def),
      });
    }
    case "filter":
      return settings({
        combinator: "all",
        rules: [{ left: DEFAULT_RULE_LEFT, op: "contains", right: "" }],
      });
    case "switch":
      return settings({
        routes: [
          {
            id: "route1",
            label: "Route 1",
            combinator: "all",
            rules: [{ left: DEFAULT_RULE_LEFT, op: "contains", right: "" }],
          },
        ],
      });
    case "combine":
      return settings(combineSettings(variant));
    case "split":
      return settings({ field: DEFAULT_SPLIT_FIELD });
    case "ai":
      return settings({
        instruction: DEFAULT_AI_INSTRUCTION,
        result: { [DEFAULT_RESULT_FIELD]: { type: "string" } },
        mode: "perItem",
      });
    case "agent":
      return agentSettings(catalog, operationId);
    case "wait":
      return waitSettings(catalog, operationId, variant);
    case "end":
      return settings({ outcome: "done" });
  }
}

/** Settings for a node of `kind` that pass the contract's schema, or why none can be built. */
export function defaultNodeSettings(
  kind: NodeKind,
  catalog: WorkflowCatalog,
  options: { operationId?: string; variant?: NodeVariant } = {},
): Outcome<{ settings: WorkflowNodeSettings }> {
  if (
    options.operationId !== undefined &&
    !KINDS_WITH_OPERATIONS.includes(kind)
  ) {
    return reject(
      "operation_mismatch",
      `A ${kind} node does not run an operation.`,
    );
  }
  const made = settingsFor(kind, catalog, options.operationId, options.variant);
  if (!made.ok) return made;
  const parsed = workflowNodeSchema.safeParse({
    id: "default",
    name: "default",
    position: { x: 0, y: 0 },
    kind,
    settings: made.settings,
  });
  if (!parsed.success) {
    return reject(
      "invalid_settings",
      `The default ${kind} settings are not valid: ${parsed.error.message}`,
    );
  }
  return { ok: true, settings: parsed.data.settings };
}

/** Builds a node of `kind` that passes the contract's schema, or says why it cannot. */
export function createNode(
  kind: NodeKind,
  fields: { id: string; name: string; position: { x: number; y: number } },
  catalog: WorkflowCatalog,
  options: { operationId?: string; variant?: NodeVariant } = {},
): Outcome<{ node: WorkflowNode }> {
  const made = defaultNodeSettings(kind, catalog, options);
  if (!made.ok) return made;
  const parsed = workflowNodeSchema.safeParse({
    ...fields,
    kind,
    settings: made.settings,
  });
  if (!parsed.success) {
    return reject("invalid_settings", parsed.error.message);
  }
  return { ok: true, node: parsed.data };
}
