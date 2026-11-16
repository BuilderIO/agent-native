import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { readProviderConnections } from "../server/lib/factory-workflow-connections.js";
import { isAgentCaller } from "../server/lib/factory-workflow-context.js";
import { describeSettingsShape } from "../server/lib/factory-workflow-settings-shape.js";
import { watchAgentCall } from "../server/lib/factory-workflow-tripwires.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import {
  MAX_EDGES,
  MAX_NODES,
  NODE_KINDS,
  fieldBindingSchema,
  nodeKindSchema,
  recordBindingSchema,
  resultFieldSchema,
  ruleSchema,
  workflowEdgeSchema,
  workflowNodeSchema,
  workflowSettingsSchema,
  type NodeKind,
  type WorkflowNode,
} from "../server/workflow/contract.js";
import {
  operationOutputs,
  type OperationDefinition,
  type OperationOutput,
} from "../server/workflow/operations.js";
import {
  ERROR_PORT,
  LIMIT_REACHED_PORT,
  OTHERWISE_PORT,
  STATIC_PORTS,
  portsFor,
  routePort,
} from "../server/workflow/ports.js";

// Four kinds can fail one item at a time. The long explanation is said once, on the graph; each kind only points at it.
const ON_ERROR_NOTE = ' Can set onError "route" (see graph.errorPortNote).';
const ERROR_PORT_NOTE =
  'A lookup, action, ai or agent node set to onError "route" gets an extra error port. An item that fails there (after any retries, and at once in a dry run) leaves by it carrying item.error {code, message, node, outcomeUnknown} instead of ending for a person, and is not counted as failed. The failed node has no output on that path, so read item.error, not nodes.<that node>. The error port must lead to a node, or the save is refused (port_leads_nowhere). A write that may have happened (outcomeUnknown true) is never retried and is still handed to a person, so end that path with needsManual.';

const PURPOSE: Record<NodeKind, string> = {
  trigger:
    "Says when the workflow looks for new work. Exactly one per workflow; it has no inputs.",
  source:
    "Starts a list of items: new messages from an inbox poller, a provider query, a time window, or items already in a status. An inbox poller or cursor query starts from the moment the workflow goes live and never works through what was already there.",
  lookup:
    "Reads one thing about each item (a thread, a ticket, a pull request) and attaches it under the node's name. Runs in a dry run. When no lookup covers an endpoint, <provider>.apiRequest (label API request) sends a read-only GET to any path of a connected provider; read its description with operationIds before using it." +
    ON_ERROR_NOTE,
  action:
    "Does one write to an outside tool (post a message, create a task, merge). Does not run in a dry run." +
    ON_ERROR_NOTE,
  filter:
    "Sends each item to Match or Otherwise by field rules combined with all or any.",
  switch:
    "Like Filter with more routes: one port per rule set, plus Otherwise.",
  combine:
    "Turns many items into one holding a list, a count, groups, or totals against a baseline.",
  split: "Turns one item with a list field into one item per entry.",
  ai:
    "Asks the agent for a judgment and returns only the declared result fields. A failure never looks like an answer." +
    ON_ERROR_NOTE,
  agent:
    "Hands work to another agent (Builder) and follows it: start, check, or follow up." +
    ON_ERROR_NOTE,
  wait: "Parks the item here until a reply arrives, a time passes, or a condition is met; everything else keeps moving.",
  end: "Finishes the item with an outcome: done, dismissed with a reason, needsManual, or released. An optional record writes up to ten named values (typed in, or read from an earlier node or the settings) onto the item with its status.",
};

type JsonSchema = Record<string, unknown>;

function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json: JsonSchema = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  });
  delete json.$schema;
  return json;
}

function settingsSchemaByKind(): Map<NodeKind, JsonSchema> {
  const byKind = new Map<NodeKind, JsonSchema>();
  for (const option of workflowNodeSchema.options) {
    byKind.set(option.shape.kind.value, toJsonSchema(option.shape.settings));
  }
  return byKind;
}

function sampleWait(
  settings: Extract<WorkflowNode, { kind: "wait" }>["settings"],
): WorkflowNode {
  return {
    id: "sample",
    name: "sample",
    kind: "wait",
    position: { x: 0, y: 0 },
    settings,
  };
}

// The ports a node exposes depend on its settings for two kinds; ask the same
// function the validator uses instead of listing them again.
function portsOf(kind: NodeKind) {
  if (kind === "switch") {
    return { ports: [routePort("<route id>"), OTHERWISE_PORT] };
  }
  if (kind === "wait") {
    return {
      portsByMode: {
        reply: portsFor(
          sampleWait({ wait: "reply", limitHours: 24, acceptFrom: "anyone" }),
        ),
        time: portsFor(
          sampleWait({ wait: "time", duration: { amount: 1, unit: "hours" } }),
        ),
        condition: portsFor(
          sampleWait({
            wait: "condition",
            operation: "sample.operation",
            args: {},
            rule: { left: "item.title", op: "isEmpty" },
            everyMinutes: 15,
            limitHours: 24,
          }),
        ),
      },
    };
  }
  return { ports: [...STATIC_PORTS[kind]] };
}

// Shapes the settings of several kinds share, named once in the index instead
// of spelled out in every kind that uses them.
function sharedShapes(): Record<string, JsonSchema> {
  return {
    binding: toJsonSchema(fieldBindingSchema),
    recordBinding: toJsonSchema(recordBindingSchema),
    rule: toJsonSchema(ruleSchema),
    resultField: toJsonSchema(resultFieldSchema),
  };
}

// The node, edge and settings shapes of a graph. The index, and anything an
// agent reads, gets the same one-line notation as each kind's settings; only
// the app's full view keeps the JSON Schema.
function graphShapes(oneLine: boolean): {
  node: JsonSchema | string;
  edge: JsonSchema | string;
  settings: JsonSchema | string;
} {
  const { shape } = workflowNodeSchema.options[0];
  const node = toJsonSchema(
    z.object({
      id: shape.id,
      name: shape.name,
      label: shape.label,
      position: shape.position,
    }),
  );
  const edge = toJsonSchema(workflowEdgeSchema);
  const settings = toJsonSchema(workflowSettingsSchema);
  if (!oneLine) return { node, edge, settings };
  return {
    node: describeSettingsShape(node).shape,
    edge: describeSettingsShape(edge).shape,
    settings: describeSettingsShape(settings).shape,
  };
}

function hasOpenEndpoint(operation: OperationDefinition): boolean {
  return (
    operation.implementation.type === "provider-request" &&
    operation.implementation.freeForm !== undefined
  );
}

// An index line for an agent drops what its id already says: the provider key,
// and the "Slack: " the labels start with for the canvas, so the room goes to
// operations instead.
function labelWithoutProvider(operation: OperationDefinition): string {
  const [first = "", ...rest] = operation.label.split(": ");
  const bare = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return rest.length > 0 && bare(first) === bare(operation.provider)
    ? rest.join(": ")
    : operation.label;
}

// Field notes are for the agent that writes graphs, so like an operation's own
// description they come with the operation asked for by id or provider, not
// with all of them at once.
function withoutFieldNotes(
  fields: OperationDefinition["fields"],
): OperationDefinition["fields"] {
  return fields.map(({ description: _note, ...field }) => field);
}

// One line per field, `name:type`, `!` when required, an enum's values inline:
// enough to pick an operation and see what it needs without its full schema.
function indexFields(operation: OperationDefinition): string[] {
  return operation.fields.map(
    (field) =>
      `${field.name}:${field.type === "enum" ? `enum<${(field.enum ?? []).join("|")}>` : field.type}${field.required ? "!" : ""}`,
  );
}

// The names a graph may read from `nodes.<step>`, `?` after one that can hold null. Types and descriptions come with the operation read in full.
function indexOutputs(outputs: readonly OperationOutput[]): string[] {
  return outputs.map((output) => `${output.name}${output.nullable ? "?" : ""}`);
}

export default defineAction({
  description:
    'Read the building blocks of a Factory workflow: the twelve node kinds with their ports and the shape of each kind\'s settings, the operation catalog (what each Source, Lookup, Action and Agent node can call, with its fields), the edge and graph shape, and whether each provider is connected for this person. The full catalog is too large for one tool result, so call it with view index first: connection status, the graph shape, every kind with its ports and a one-line settingsShape (key required, key? optional, "a"|"b" choices, 1-10 range, [x] list, {<name>:x} map, a bare name such as binding is defined in shapes), and one compact line per operation (id, whose first part is the provider, label, node kinds, effect, field names and types, ! for required). That is enough to choose the operations. Then read the ones you use in full with one more call: operationIds (or provider) returns those operations\' fields, each with its description and the notes on how to fill it, and their outputs: the only names a later step may read as nodes.<step>.<name>, ? after one that can be null (a save that reads another name is refused), and only the node kinds they serve; kind returns one kind\'s full settings JSON Schema. Call it before building or editing a graph with save-factory-workflow.',
  schema: z.object({
    view: z
      .enum(["full", "index"])
      .default("full")
      .describe(
        "index returns the compact catalog an agent should read first; full (the default) returns every kind's full settings schema and every operation in full, unless operationIds or provider narrows it.",
      ),
    kind: nodeKindSchema
      .optional()
      .describe(
        "Only this node kind, with its settings schema and the operations it can call (source, lookup, action, agent).",
      ),
    provider: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe(
        "Only this provider's operations, in full, the node kinds they serve, and its connection status, such as slack.",
      ),
    operationIds: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Only these operations, in full, and the node kinds they serve, such as slack.postMessage. Ids come from the index.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input, context) =>
    watchAgentCall(
      { action: "describe-workflow-node-catalog", input, context, slow: true },
      async (watch) => {
        const { view, kind, provider, operationIds } = input;
        const { userEmail, orgId } = await requireWorkspaceMember(
          workspaceMemberIdentityFromContext(context),
        );
        watch.inOrg(orgId);
        const compact = view === "index";
        // An agent pays for every character it reads, so it gets a narrower, denser
        // result; the app keeps the one it has always had.
        const forAgent = isAgentCaller(context);
        const schemas = settingsSchemaByKind();
        const catalog = OPERATION_CATALOG.list();
        if (provider && !catalog.some((entry) => entry.provider === provider)) {
          fail(
            `No operations for provider "${provider}". Providers: ${[...new Set(catalog.map((entry) => entry.provider))].sort().join(", ")}.`,
            { errorCode: "unknown_provider", statusCode: 404 },
          );
        }
        const unknownIds = (operationIds ?? []).filter(
          (id) => !catalog.some((entry) => entry.id === id),
        );
        if (unknownIds.length > 0) {
          fail(
            `No operation ${unknownIds.map((id) => `"${id}"`).join(", ")}. Read the ids from view index.`,
            { errorCode: "unknown_operation", statusCode: 404 },
          );
        }
        const matching = catalog.filter(
          (operation) =>
            (!provider || operation.provider === provider) &&
            (!operationIds || operationIds.includes(operation.id)) &&
            (!kind ||
              (operation.nodeKinds as readonly string[]).includes(kind)),
        );
        const named = provider !== undefined || operationIds !== undefined;
        const served = new Set<string>(
          matching.flatMap((operation) => operation.nodeKinds),
        );
        const shared = sharedShapes();
        const sharedUsed = new Set<string>();
        // For an agent, operations asked for by name bring only the kinds that
        // call them, and outside a single kind each kind is its one-line shape
        // rather than its full schema.
        const nodeKinds = NODE_KINDS.filter(
          (candidate) =>
            (!kind || candidate === kind) &&
            (!(forAgent && named) || served.has(candidate)),
        ).map((candidate) => {
          const base = {
            kind: candidate,
            purpose: PURPOSE[candidate],
            ...portsOf(candidate),
          };
          const schema = schemas.get(candidate) ?? {};
          if (!forAgent)
            return compact && !kind ? base : { ...base, settings: schema };
          if (kind || !(compact || named)) return { ...base, settings: schema };
          const { shape, used } = describeSettingsShape(schema, shared);
          for (const name of used) sharedUsed.add(name);
          return { ...base, settingsShape: shape };
        });
        const indexed = compact && !named;
        const dense = indexed && forAgent;
        const describeOperation = (operation: OperationDefinition) => {
          const outputs = operationOutputs(operation);
          return {
            id: operation.id,
            ...(dense ? {} : { provider: operation.provider }),
            label: dense ? labelWithoutProvider(operation) : operation.label,
            ...(operation.description && named
              ? { description: operation.description }
              : {}),
            nodeKinds: operation.nodeKinds,
            effect: operation.effect,
            fields: indexed
              ? indexFields(operation)
              : named
                ? operation.fields
                : withoutFieldNotes(operation.fields),
            // An agent's index leaves outputs to the call that reads the operation
            // in full, which is where they are needed; the app's index keeps them.
            ...(outputs && !dense
              ? { outputs: indexed ? indexOutputs(outputs) : outputs }
              : {}),
          };
        };
        // The API request is one definition per provider. The index an agent
        // reads lists it once, with the providers it exists for, so it does not
        // pay for eleven copies of the same line.
        const openRequests = dense ? matching.filter(hasOpenEndpoint) : [];
        const operations = [
          ...matching
            .filter((operation) => !openRequests.includes(operation))
            .map(describeOperation),
          ...openRequests.slice(0, 1).map((operation) => {
            const { provider: _own, ...entry } = describeOperation(operation);
            return {
              ...entry,
              id: `<provider>.${operation.id.slice(operation.provider.length + 1)}`,
              providers: openRequests.map((request) => request.provider),
            };
          }),
        ];
        const providerIds = [
          ...new Set(
            matching.map((operation) => operation.credential.provider),
          ),
        ];
        const providers =
          providerIds.length === 0
            ? []
            : await readProviderConnections(providerIds, { userEmail, orgId });
        // The tool result is cut at the tail, so what an agent must not lose (who
        // is connected, how a graph is wired) comes before the long lists.
        const result = {
          view,
          providers,
          graph: kind
            ? undefined
            : {
                ...graphShapes(forAgent || compact),
                limits: { maxNodes: MAX_NODES, maxEdges: MAX_EDGES },
                loopPort: LIMIT_REACHED_PORT,
                errorPort: ERROR_PORT,
                errorPortNote: ERROR_PORT_NOTE,
              },
          shapes:
            !forAgent || sharedUsed.size === 0
              ? undefined
              : Object.fromEntries(
                  [...sharedUsed].map((name) => [
                    name,
                    describeSettingsShape(shared[name], shared).shape,
                  ]),
                ),
          nodeKinds,
          operations,
        };
        return forAgent ? JSON.stringify(result) : result;
      },
    ),
});
