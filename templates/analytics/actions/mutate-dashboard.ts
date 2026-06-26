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

import { getDashboard, upsertDashboard } from "../server/lib/dashboards-store";
import {
  applyDashboardMutationOperations,
  DASHBOARD_MUTATION_API_TYPES,
  DASHBOARD_MUTATION_EXAMPLES,
  parseDashboardMutationScript,
  type DashboardMutationOperation,
} from "./dashboard-mutation-api";
import { compactDashboardResult } from "./dashboard-panel-order";
import { validateDashboardConfig, validatePanelSql } from "./update-dashboard";

const mutationTargetSchema = {
  position: z.enum(["top", "bottom"]).optional(),
  index: z.number().int().nonnegative().optional(),
  beforePanelId: z.string().optional(),
  afterPanelId: z.string().optional(),
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
    z.string().transform((value) => parseJsonArrayString(value, "operations")),
  ])
  .optional();

const apiHelp =
  "Constrained TypeScript-like dashboard mutation script. The server parses only calls on `dashboard`; it does not execute arbitrary JavaScript. " +
  "No variables, imports, loops, functions, templates, network, filesystem, or DB access. Arguments must be JSON-compatible literals, so quote object keys. " +
  "Subjects: dashboard.set, dashboard.panel, dashboard.panels, dashboard.panelsMatching, dashboard.section, dashboard.insertPanel. " +
  "Selection methods: moveToTop, moveToBottom, moveBefore, moveAfter, moveToIndex, remove, set, setTitle, setSql, setWidth, setConfig, setConfigPath, duplicate. " +
  `Examples: ${DASHBOARD_MUTATION_EXAMPLES.slice(0, 3).join(" ")}`;

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

function mutationCanChangePanelSql(op: DashboardMutationOperation): boolean {
  if (op.op === "insertPanel" || op.op === "duplicatePanel") return true;
  if (op.op === "setDashboard") {
    return Object.keys(op.patch).some((key) =>
      ["filters", "variables"].includes(key),
    );
  }
  if (op.op !== "updatePanel") return false;
  return Object.keys(op.patch).some((key) =>
    ["sql", "source", "chartType"].includes(key),
  );
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
    "This is code-shaped but not arbitrary code execution: the server parses the allowed dashboard methods, validates the resulting config with the same invariants as update-dashboard, saves once, syncs collab, and returns compact proof. " +
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
        "Supported ops: movePanels, removePanels, updatePanel, updatePanelPath, insertPanel, duplicatePanel, setDashboard.",
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
    const wantsHelpOnly =
      args.returnTypes === true &&
      !args.dashboardId &&
      !args.id &&
      !args.code &&
      !args.operations;
    if (wantsHelpOnly) return helpResult();

    const dashboardId = resolveDashboardId(args);
    const suppliedModes = [args.code, args.operations].filter(
      (value) => value !== undefined,
    ).length;
    if (suppliedModes === 0) {
      throw new Error("provide `code` or `operations`.");
    }
    if (suppliedModes > 1) {
      throw new Error("provide only one of `code` or `operations`.");
    }

    const scope = resolveScope();
    const ctx = { email: scope.email, orgId: scope.orgId };
    const existing = await getDashboard(dashboardId, ctx);
    if (!existing) {
      throw new Error(
        `dashboard "${dashboardId}" not found (or you don't have access).`,
      );
    }
    if (existing.kind !== "sql") {
      throw new Error(
        `mutate-dashboard only supports SQL dashboards; "${dashboardId}" is ${existing.kind}.`,
      );
    }

    const root = cloneConfig(existing.config as Record<string, unknown>);
    const operations = args.operations
      ? (args.operations as DashboardMutationOperation[])
      : parseDashboardMutationScript(root, args.code!);
    const mutation = applyDashboardMutationOperations(root, operations);

    const validation = validateDashboardConfig(root);
    if (validation) throw new Error(validation);
    if (operations.some(mutationCanChangePanelSql)) {
      const sqlError = await validatePanelSql(root);
      if (sqlError) throw new Error(sqlError);
    }

    if (args.dryRun !== true) {
      await upsertDashboard(dashboardId, existing.kind, root, ctx);
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
