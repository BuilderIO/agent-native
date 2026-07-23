import { defineAction, embedApp } from "@agent-native/core";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  getDashboard,
  upsertDashboardWithRetry,
  type DashboardRecord,
} from "../server/lib/dashboards-store";
import {
  applyDashboardMutationOperations,
  DASHBOARD_MUTATION_API_TYPES,
  DASHBOARD_MUTATION_EXAMPLES,
  parseDashboardMutationScript,
  type DashboardMutationOperation,
  type DashboardMutationResult,
} from "./dashboard-mutation-api";
import { compactDashboardResult } from "./dashboard-panel-order";
import { validateDashboardConfig, validatePanelSql } from "./update-dashboard";

const mutationTargetSchema = {
  position: z.enum(["top", "bottom"]).optional(),
  index: z.number().int().nonnegative().optional(),
  beforePanelId: z.string().optional(),
  afterPanelId: z.string().optional(),
  nextToPanelId: z
    .string()
    .optional()
    .describe("Place the panel in the same visible row, after this panel id."),
  rowNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based visible row number for row-aware placement."),
  rowPosition: z
    .enum(["start", "end"])
    .optional()
    .describe("Where in rowNumber to place the panel. Defaults to end."),
};

const mutationOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("movePanels"),
    panelIds: z.array(z.string()).min(1),
    ...mutationTargetSchema,
  }),
  z.object({
    op: z.literal("removePanels"),
    panelIds: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal("updatePanel"),
    panelId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("updatePanelPath"),
    panelId: z.string(),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("insertPanel"),
    panel: z.record(z.string(), z.unknown()),
    ...mutationTargetSchema,
  }),
  z.object({
    op: z.literal("duplicatePanel"),
    panelId: z.string(),
    newPanelId: z.string(),
    patch: z.record(z.string(), z.unknown()).optional(),
    ...mutationTargetSchema,
  }),
  z.object({
    op: z.literal("setDashboard"),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("setFilterDefault"),
    filterId: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
]);

function parseJsonArrayString(
  value: string,
  fieldName: string,
): DashboardMutationOperation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err: any) {
    throw new Error(`${fieldName} must be a JSON array: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  return parsed.map((op, index) => {
    try {
      return mutationOperationSchema.parse(op) as DashboardMutationOperation;
    } catch (err: any) {
      throw new Error(`${fieldName}[${index}] is invalid: ${err.message}`);
    }
  });
}

const operationsInputSchema = z
  .union([
    z.array(mutationOperationSchema),
    z.string().transform((value) => {
      const trimmed = value.trim();
      return trimmed ? parseJsonArrayString(trimmed, "operations") : undefined;
    }),
  ])
  .optional();

function nonEmptyCode(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function nonEmptyOperations(
  value: DashboardMutationOperation[] | undefined,
): DashboardMutationOperation[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

const apiHelp =
  "Constrained TypeScript-like dashboard mutation script. The server parses only calls on `dashboard`; it does not execute arbitrary JavaScript. " +
  "No variables, imports, loops, functions, templates, network, filesystem, or DB access. Arguments must be JSON-compatible literals, so quote object keys. " +
  "Subjects: dashboard.set, dashboard.setFilterDefault, dashboard.panel, dashboard.panels, dashboard.panelsMatching, dashboard.section, dashboard.insertPanel. " +
  'For a simple default-filter change, use `dashboard.setFilterDefault("emailFilter","exclude_builder");`; it verifies the filter and option value without resending every filter or revalidating unchanged panel SQL. ' +
  'Selection methods: moveToTop, moveToBottom, moveBefore, moveAfter, moveToIndex, moveNextTo, moveToRow, remove, set, setTitle, setSql, setWidth, setConfig, setConfigPath, duplicate. Duplicate supports one chained placement method, for example `dashboard.panel("source").duplicate("copy", {"chartType":"bar"}).nextTo("source");`. ' +
  "Inserted panels support atTop, atBottom, before, after, atIndex, nextTo, atRow, atRowStart, and atRowEnd. Use nextTo(panelId) or atRow(rowNumber) for visible row placement. " +
  "AI-generated first-party panels are dashboard-time-bound by default: set config.timeScope to dashboard and include a matching dashboard time filter in SQL. Allowed values are dashboard, fixed-window, cohort-history, and all-time; use all-time only when the user requests full available history and put all-time, lifetime, or historical in the title or description. A {{timeRange}} token requires the timeRange select filter; {{<id>Start}}/{{<id>End}} require a matching date-range filter. Server validation rejects unbound first-party SQL. " +
  `Examples: ${DASHBOARD_MUTATION_EXAMPLES.slice(0, 5).join(" ")}`;

const agentInputSchema = z.object({
  dashboardId: z
    .string()
    .min(1)
    .describe("Dashboard id, e.g. 'agent-native-templates-first-party'."),
  code: z.string().min(1).describe(apiHelp),
});

function resolveScope() {
  const orgId = getRequestOrgId() || null;
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return { orgId, email };
}

function resolveDashboardId(args: { dashboardId?: string; id?: string }) {
  const dashboardId = args.dashboardId || args.id;
  if (!dashboardId) {
    throw new Error("provide `dashboardId` (or legacy `id`).");
  }
  return dashboardId;
}

function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

async function syncToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const configStr = JSON.stringify(config);
  try {
    const exists = await hasCollabState(docId);
    if (exists) {
      await applyText(docId, configStr, "content", "agent");
    } else {
      await seedFromText(docId, configStr);
    }
  } catch {
    // SQL remains the source of truth; live collab sync is best-effort.
  }
}

function sqlValidationScope(
  operations: DashboardMutationOperation[],
): ReadonlySet<string> | "all" | null {
  const panelIds = new Set<string>();
  for (const op of operations) {
    if (op.op === "setDashboard") {
      if (
        Object.keys(op.patch).some((key) =>
          ["filters", "variables", "panels"].includes(key),
        )
      ) {
        return "all";
      }
      continue;
    }
    if (op.op === "insertPanel") {
      if (typeof op.panel.id === "string") panelIds.add(op.panel.id);
      continue;
    }
    if (op.op === "duplicatePanel") {
      panelIds.add(op.newPanelId);
      continue;
    }
    if (op.op === "updatePanelPath") {
      panelIds.add(op.panelId);
      continue;
    }
    if (
      op.op === "updatePanel" &&
      Object.keys(op.patch).some((key) =>
        ["sql", "source", "chartType", "config"].includes(key),
      )
    ) {
      panelIds.add(op.panelId);
    }
  }
  return panelIds.size > 0 ? panelIds : null;
}

async function validateMutationSql(
  config: Record<string, unknown>,
  operations: DashboardMutationOperation[],
): Promise<string | null> {
  const scope = sqlValidationScope(operations);
  if (scope === null) return null;
  return validatePanelSql(config, scope === "all" ? undefined : scope);
}

function movedPanelIdsFrom(operations: DashboardMutationOperation[]): string[] {
  const moved = new Set<string>();
  for (const op of operations) {
    if (op.op !== "movePanels") continue;
    for (const id of op.panelIds) moved.add(id);
  }
  return Array.from(moved);
}

function helpResult() {
  return {
    mutationApiVersion: 1,
    apiTypes: DASHBOARD_MUTATION_API_TYPES,
    examples: DASHBOARD_MUTATION_EXAMPLES,
    summary:
      "Use `code` for constrained dashboard mutation scripts, or `operations` for the equivalent structured ops.",
  };
}

export default defineAction({
  description:
    "Apply general SQL dashboard edits through a small typed mutation API in ONE atomic save. " +
    "Prefer this for dashboard layout and panel edits: move panels by id, edit titles/SQL/width/config, remove panels, duplicate panels, insert panels, or patch dashboard fields. " +
    "For user placement requests like 'second row' or 'next to return rates', use row-aware placement such as `dashboard.insertPanel(...).nextTo(\"retention-over-time\")` or `.atRow(2)`, then verify rendered rows from `get-sql-dashboard.layout.groups`. " +
    "This is code-shaped but not arbitrary code execution: the server parses the allowed dashboard methods, validates the resulting config with the same invariants as update-dashboard, saves once, syncs collab, and returns compact proof. First-party SQL must be explicitly time-bound as described in the API help; server validation rejects unbound first-party SQL. " +
    "The main code argument is a string, so it avoids brittle JSON-pointer indexes and native-array serialization issues. " +
    `Common example: ${DASHBOARD_MUTATION_EXAMPLES[0]}`,
  schema: z.object({
    dashboardId: z
      .string()
      .optional()
      .describe("Dashboard id, e.g. 'agent-native-templates-first-party'."),
    id: z
      .string()
      .optional()
      .describe("Legacy alias for dashboardId. Prefer dashboardId."),
    code: z.string().optional().describe(apiHelp),
    operations: operationsInputSchema.describe(
      "Structured equivalent of the typed script. Native callers should pass an array of mutation ops; shell/legacy callers may pass a JSON string. " +
        "Supported ops: movePanels, removePanels, updatePanel, updatePanelPath, insertPanel, duplicatePanel, setDashboard, setFilterDefault.",
    ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "If true, validate and return the resulting compact proof without saving.",
      ),
    returnConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full resulting dashboard config. Defaults to false to keep tool output compact.",
      ),
    returnTypes: z
      .boolean()
      .optional()
      .describe("If true, include the allowed TypeScript API and examples."),
  }),
  agentInputSchema,
  http: { method: "POST" },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the mutated dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  run: async (args) => {
    const code = nonEmptyCode(args.code);
    const requestedOperations = nonEmptyOperations(args.operations);
    const wantsHelpOnly =
      args.returnTypes === true &&
      !args.dashboardId &&
      !args.id &&
      !code &&
      !requestedOperations;
    if (wantsHelpOnly) return helpResult();

    const dashboardId = resolveDashboardId(args);
    const suppliedModes = [code, requestedOperations].filter(Boolean).length;
    if (suppliedModes === 0) {
      throw new Error("provide `code` or `operations`.");
    }
    if (suppliedModes > 1) {
      throw new Error("provide only one of `code` or `operations`.");
    }

    const scope = resolveScope();
    const ctx = { email: scope.email, orgId: scope.orgId };

    // Recomputes the mutation from whatever dashboard state is passed in.
    // `operations` sourced from `args.operations` are already concrete panel
    // ids, safe to replay verbatim; `args.code` is re-parsed against `existing`
    // every time because selectors like `panelsMatching(...)` resolve against
    // the config at parse time, so a retry must re-resolve them against the
    // fresh state, not reuse ids resolved from a now-stale config.
    function computeMutation(
      existing: Pick<DashboardRecord, "kind" | "config">,
    ) {
      if (existing.kind !== "sql") {
        throw new Error(
          `mutate-dashboard only supports SQL dashboards; "${dashboardId}" is ${existing.kind}.`,
        );
      }
      const nextRoot = cloneConfig(existing.config as Record<string, unknown>);
      const nextOperations = requestedOperations
        ? requestedOperations
        : parseDashboardMutationScript(nextRoot, code!);
      const nextMutation = applyDashboardMutationOperations(
        nextRoot,
        nextOperations,
      );
      const validation = validateDashboardConfig(nextRoot);
      if (validation) throw new Error(validation);
      return { nextRoot, nextOperations, nextMutation };
    }

    // Assigned inside `computeMutation`'s caller (directly for dry-run, inside
    // the retry callback for a real save); always assigned at least once
    // before use below, since `upsertDashboardWithRetry` only resolves after
    // its callback has run.
    let root: Record<string, unknown>;
    let operations!: DashboardMutationOperation[];
    let mutation!: DashboardMutationResult;

    if (args.dryRun === true) {
      const existing = await getDashboard(dashboardId, ctx);
      if (!existing) {
        throw new Error(
          `dashboard "${dashboardId}" not found (or you don't have access).`,
        );
      }
      const computed = computeMutation(existing);
      root = computed.nextRoot;
      operations = computed.nextOperations;
      mutation = computed.nextMutation;
      const sqlError = await validateMutationSql(root, operations);
      if (sqlError) throw new Error(sqlError);
    } else {
      const saved = await upsertDashboardWithRetry(
        dashboardId,
        ctx,
        async (existing) => {
          const computed = computeMutation(existing);
          const sqlError = await validateMutationSql(
            computed.nextRoot,
            computed.nextOperations,
          );
          if (sqlError) throw new Error(sqlError);
          root = computed.nextRoot;
          operations = computed.nextOperations;
          mutation = computed.nextMutation;
          return { kind: "sql" as const, body: computed.nextRoot };
        },
      );
      // Use the persisted config as the source of truth for the response —
      // structurally identical to the winning attempt's `root`, but reflects
      // exactly what was saved.
      root = saved.config as Record<string, unknown>;
      await syncToCollab(dashboardId, root);
    }

    const compact = compactDashboardResult(root, movedPanelIdsFrom(operations));
    const summary =
      `${args.dryRun === true ? "Dry-ran" : "Applied"} ${operations.length} dashboard mutation op(s) for "${dashboardId}". ` +
      `First panels: ${compact.firstPanelIds.join(", ")}.`;

    return {
      id: dashboardId,
      dashboardId,
      name: typeof root.name === "string" ? root.name : dashboardId,
      mutationApiVersion: 1,
      saved: args.dryRun !== true,
      dryRun: args.dryRun === true,
      appliedOps: operations.length,
      ...compact,
      commandLog: mutation.commandLog,
      changedPanelIds: mutation.changedPanelIds,
      insertedPanelIds: mutation.insertedPanelIds,
      removedPanelIds: mutation.removedPanelIds,
      dashboardFieldsChanged: mutation.dashboardFieldsChanged,
      ...(args.returnConfig === true ? { config: root } : {}),
      ...(args.returnTypes === true
        ? {
            apiTypes: DASHBOARD_MUTATION_API_TYPES,
            examples: DASHBOARD_MUTATION_EXAMPLES,
          }
        : {}),
      summary,
      urlPath: `/dashboards/${dashboardId}`,
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      message:
        `${summary} ` +
        (args.returnConfig === true
          ? ""
          : "Full config omitted; call get-sql-dashboard with includeConfig=true only if full SQL/config is needed."),
    };
  },
  link: ({ result }) => {
    const dashboardId =
      result && typeof result === "object"
        ? (result as { dashboardId?: string }).dashboardId
        : undefined;
    if (!dashboardId) return null;
    return {
      url: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      label: "Open dashboard in Analytics",
      view: "adhoc",
    };
  },
});
