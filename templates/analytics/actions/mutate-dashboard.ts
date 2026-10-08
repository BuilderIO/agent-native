import { defineAction, embedApp } from "@agent-native/core";
import { fail } from "@agent-native/core/action";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  dashboardNoopReceipt,
  dashboardWriteReceipt,
  requireEditableDashboard,
} from "../server/lib/dashboard-agent-write";
import {
  DASHBOARD_COLLAB_SYNC_TIMEOUT_MS,
  queueDashboardCollabSync,
} from "../server/lib/dashboard-collab-sync";
import {
  annotateSummary,
  verdictFields,
  verifyPanelWrite,
  type PanelVerification,
  type PanelWriteVerdict,
} from "../server/lib/dashboard-panel-verification";
import {
  getDashboard,
  upsertDashboardWithRetryOutcome,
  type DashboardRecord,
} from "../server/lib/dashboards-store";
import {
  PANEL_CHART_TYPES,
  validatePanelContract,
} from "../shared/panel-render-contract";
import {
  applyDashboardMutationOperations,
  DASHBOARD_MUTATION_API_TYPES,
  DASHBOARD_MUTATION_EXAMPLES,
  MAX_DASHBOARD_MUTATION_CODE_LENGTH,
  MAX_DASHBOARD_MUTATION_OPERATIONS,
  parseDashboardMutationScript,
  sameJsonValue,
  type DashboardMutationOperation,
  type DashboardMutationResult,
} from "./dashboard-mutation-api";
import { compactDashboardResult } from "./dashboard-panel-order";
import {
  assertValidDashboardConfig,
  isAgentCaller,
  validatePanelSql,
} from "./update-dashboard";

/**
 * Zod emits a typeless `additionalProperties: {}` for `record(string, unknown)`
 * and `.passthrough()`, and the action schema sanitizer expands every typeless
 * position into a 400-character JSON-value union in the tool schema. The
 * explicit `true` is the same constraint in a few characters.
 */
const freeFormObject = () =>
  z.record(z.string(), z.unknown()).meta({ additionalProperties: true });

const mutationTargetSchema = {
  position: z.enum(["top", "bottom"]).optional(),
  index: z.number().int().nonnegative().optional(),
  beforePanelId: z.string().optional(),
  afterPanelId: z.string().optional(),
  nextToPanelId: z.string().optional(),
  rowNumber: z.number().int().positive().optional(),
  rowPosition: z.enum(["start", "end"]).optional(),
};

const insertPanelSchema = z
  .object({
    id: z.string().refine((id) => id.trim().length > 0, {
      message: "panel.id must be a non-empty string",
    }),
    title: z
      .string()
      .refine((title) => title.trim().length > 0, {
        message: "panel.title must be a non-empty string",
      })
      .optional(),
    chartType: z.enum(PANEL_CHART_TYPES).optional(),
    width: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe(
        "Integer 1-6, not a string. The saved panel needs a width from here or a later op in this batch.",
      ),
    source: z
      .enum([
        "bigquery",
        "ga4",
        "amplitude",
        "first-party",
        "demo",
        "prometheus",
        "program",
      ])
      .optional(),
    sql: z.string().optional(),
    columns: z.number().int().min(1).max(6).optional(),
    tab: z.string().optional(),
    config: freeFormObject().optional(),
  })
  .passthrough()
  .meta({ additionalProperties: true });

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
    patch: freeFormObject(),
  }),
  z.object({
    op: z.literal("updatePanelPath"),
    panelId: z.string(),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("insertPanel"),
    panel: insertPanelSchema,
    ...mutationTargetSchema,
  }),
  z.object({
    op: z.literal("duplicatePanel"),
    panelId: z.string(),
    newPanelId: z.string(),
    patch: freeFormObject().optional(),
    ...mutationTargetSchema,
  }),
  z.object({
    op: z.literal("setDashboard"),
    patch: freeFormObject(),
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
  if (parsed.length > MAX_DASHBOARD_MUTATION_OPERATIONS) {
    throw new Error(
      `${fieldName} has ${parsed.length} operations; keep it at or below ${MAX_DASHBOARD_MUTATION_OPERATIONS}`,
    );
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
    z.array(mutationOperationSchema).max(MAX_DASHBOARD_MUTATION_OPERATIONS),
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
  "Compact script form of `operations`: JSON-literal calls on `dashboard` only (quote object keys; no variables, loops, or imports). Use it for short layout or config edits; call with only `returnTypes: true` to list every method. " +
  `Examples: ${[0, 2, 3, 4, 7].map((index) => DASHBOARD_MUTATION_EXAMPLES[index]).join(" ")}`;

const operationsHelp =
  "Edits applied atomically in one save, by panel id. " +
  'Examples: {"op":"updatePanel","panelId":"top-referrers","patch":{"title":"Top Referrers by Domain","width":2,"config":{"yFormatter":"percent"}}} {"op":"movePanels","panelIds":["dau","wau"],"position":"top"} {"op":"setFilterDefault","filterId":"emailFilter","value":"exclude_builder"}';

const dryRunHelp = "Validate and verify without saving.";
const allowEmptyResultHelp =
  "Set true only when the user expects an edited panel to have no rows right now; the save then reports verified:false. It never overrides missing columns or query errors.";

const agentInputSchema = z.object({
  dashboardId: z.string().min(1).describe("Dashboard id."),
  operations: z
    .array(mutationOperationSchema)
    .max(MAX_DASHBOARD_MUTATION_OPERATIONS)
    .optional()
    .describe(operationsHelp),
  code: z
    .string()
    .max(MAX_DASHBOARD_MUTATION_CODE_LENGTH)
    .optional()
    .describe(apiHelp),
  dryRun: z.boolean().optional().describe(dryRunHelp),
  allowEmptyResult: z.boolean().optional().describe(allowEmptyResultHelp),
  returnConfig: z
    .boolean()
    .optional()
    .describe("Include the full resulting config only when needed."),
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

function panelEntries(root: Record<string, unknown>) {
  const panels = Array.isArray(root.panels) ? root.panels : [];
  return panels.flatMap((panel) => {
    if (!panel || typeof panel !== "object" || Array.isArray(panel)) {
      return [];
    }
    const value = panel as Record<string, unknown>;
    return typeof value.id === "string" && value.id
      ? [{ id: value.id, value }]
      : [];
  });
}

function hasPropertyValueChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  key: string,
): boolean {
  const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
  const afterHas = Object.prototype.hasOwnProperty.call(after, key);
  return beforeHas !== afterHas || !sameJsonValue(before[key], after[key]);
}

function filterDefaultChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: string,
): boolean {
  const prefix = "filters.";
  const suffix = ".default";
  if (!field.startsWith(prefix) || !field.endsWith(suffix)) return false;
  const filterId = field.slice(prefix.length, -suffix.length);
  const findFilter = (root: Record<string, unknown>) =>
    Array.isArray(root.filters)
      ? (root.filters as Array<Record<string, unknown>>).find(
          (filter) => filter?.id === filterId,
        )
      : undefined;
  const beforeFilter = findFilter(before);
  const afterFilter = findFilter(after);
  if (!beforeFilter || !afterFilter)
    return Boolean(beforeFilter || afterFilter);
  return hasPropertyValueChanged(beforeFilter, afterFilter, "default");
}

function reconcileMutationMetadata(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  mutation: DashboardMutationResult,
): DashboardMutationResult {
  const beforePanels = panelEntries(before);
  const afterPanels = panelEntries(after);
  const beforeById = new Map(beforePanels.map((entry) => [entry.id, entry]));
  const afterById = new Map(afterPanels.map((entry) => [entry.id, entry]));
  const beforeOrder = beforePanels
    .map((entry) => entry.id)
    .filter((id) => afterById.has(id));
  const afterOrder = afterPanels
    .map((entry) => entry.id)
    .filter((id) => beforeById.has(id));
  const beforeRank = new Map(beforeOrder.map((id, index) => [id, index]));
  const afterRank = new Map(afterOrder.map((id, index) => [id, index]));
  const reordered = (id: string) => beforeRank.get(id) !== afterRank.get(id);
  const movedPanelIds = mutation.movedPanelIds.filter(reordered);
  if (mutation.dashboardFieldsChanged.includes("panels")) {
    for (const id of afterOrder) {
      if (reordered(id) && !movedPanelIds.includes(id)) movedPanelIds.push(id);
    }
  }
  const insertedPanelIds = afterPanels
    .filter((entry) => !beforeById.has(entry.id))
    .map((entry) => entry.id);
  const removedPanelIds = beforePanels
    .filter((entry) => !afterById.has(entry.id))
    .map((entry) => entry.id);
  const changedPanelIds = new Set<string>();
  const changedPanel = (id: string) => {
    const beforePanel = beforeById.get(id);
    const afterPanel = afterById.get(id);
    if (!beforePanel && !afterPanel) return false;
    return (
      !beforePanel ||
      !afterPanel ||
      !sameJsonValue(beforePanel.value, afterPanel.value) ||
      movedPanelIds.includes(id)
    );
  };
  for (const id of mutation.changedPanelIds) {
    if (changedPanel(id)) changedPanelIds.add(id);
  }
  for (const entry of afterPanels) {
    if (changedPanel(entry.id)) changedPanelIds.add(entry.id);
  }
  for (const entry of beforePanels) {
    if (changedPanel(entry.id)) changedPanelIds.add(entry.id);
  }

  const dashboardFieldsChanged = new Set<string>();
  for (const field of mutation.dashboardFieldsChanged) {
    const changed = field.startsWith("filters.")
      ? filterDefaultChanged(before, after, field)
      : hasPropertyValueChanged(before, after, field);
    if (changed) dashboardFieldsChanged.add(field);
  }
  const rootKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of rootKeys) {
    if (key === "panels" || key === "filters") continue;
    if (hasPropertyValueChanged(before, after, key)) {
      dashboardFieldsChanged.add(key);
    }
  }

  return {
    ...mutation,
    changedPanelIds: Array.from(changedPanelIds),
    movedPanelIds,
    removedPanelIds,
    insertedPanelIds,
    dashboardFieldsChanged: Array.from(dashboardFieldsChanged),
  };
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
  signal?: AbortSignal,
): Promise<string | null> {
  const scope = sqlValidationScope(operations);
  if (scope === null) return null;
  return validatePanelSql(config, scope === "all" ? undefined : scope, {
    signal,
  });
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
    "Edit a SQL dashboard in ONE atomic save: move, insert, duplicate, remove, and edit panels by id (title, SQL, width, config), patch dashboard fields, or set filter defaults. Pass typed `operations`; `code` is a compact script form of the same edits. " +
    "Place a panel in a visible row with nextToPanelId or rowNumber. First-party panel SQL must bind to a dashboard time filter (config.timeScope). For catalog metrics load `compose-dashboard` with `tool-search`, and keep large SQL out of `code`. Read the existing panels with `get-sql-dashboard` first and match their chart types, widths, and config. Small edits of existing panels need no skill; the dashboard-management skill owns new-panel placement, time-scope, and config rules. " +
    "Before saving, agent calls run every changed panel the way the dashboard page does; a panel that would show 'No data', drop configured columns, or fail is refused with the reason and nothing is written. " +
    "The result's `verified` flag and per-panel `verification` (or `unverified` reasons) are the proof the edit renders: report only what they show, and on `verified:false`, an error, or a user report that nothing changed, call `inspect-dashboard-panel` before saying anything about the chart.",
  schema: z.object({
    dashboardId: z.string().optional().describe("Dashboard id."),
    id: z
      .string()
      .optional()
      .describe("Legacy alias for dashboardId. Prefer dashboardId."),
    code: z
      .string()
      .max(MAX_DASHBOARD_MUTATION_CODE_LENGTH)
      .optional()
      .describe(apiHelp),
    operations: operationsInputSchema.describe(
      `${operationsHelp} Native callers pass an array; shell/legacy callers may pass a JSON string.`,
    ),
    dryRun: z.boolean().optional().describe(dryRunHelp),
    allowEmptyResult: z.boolean().optional().describe(allowEmptyResultHelp),
    returnConfig: z
      .boolean()
      .optional()
      .describe("Include the full resulting config only when needed."),
    returnTypes: z
      .boolean()
      .optional()
      .describe("With no dashboardId, return the `code` API and examples."),
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
  // SQL validation (<=10s) plus panel verification (<=18s) plus store I/O.
  timeoutMs: 45_000,
  run: async (args, actionContext) => {
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
    const agentCaller = isAgentCaller(actionContext?.caller);
    const verificationMemo = new Map<string, PanelVerification>();

    function verifyMutation(
      base: Record<string, unknown>,
      next: Record<string, unknown>,
    ): Promise<PanelWriteVerdict | null> {
      if (!agentCaller) return Promise.resolve(null);
      return verifyPanelWrite({
        base,
        next,
        signal: actionContext?.signal,
        allowEmptyResult: args.allowEmptyResult,
        memo: verificationMemo,
        dashboardId,
      });
    }

    function computeMutation(
      existing: Pick<DashboardRecord, "kind" | "config">,
    ) {
      if (existing.kind !== "sql") {
        throw new Error(
          `mutate-dashboard only supports SQL dashboards; "${dashboardId}" is ${existing.kind}.`,
        );
      }
      const base = existing.config as Record<string, unknown>;
      const nextRoot = cloneConfig(base);
      const nextOperations = requestedOperations
        ? requestedOperations
        : parseDashboardMutationScript(nextRoot, code!);
      const nextMutation = applyDashboardMutationOperations(
        nextRoot,
        nextOperations,
      );
      // Only skips validation and verification; whether anything was written
      // is the store's answer.
      if (sameJsonValue(base, nextRoot)) {
        return { nextRoot, nextOperations, nextMutation, noop: true };
      }
      assertValidDashboardConfig(nextRoot, { baseline: base });
      if (agentCaller) {
        const issues = validatePanelContract(
          base,
          nextRoot,
          new Set(nextMutation.changedPanelIds),
        );
        if (issues.length > 0) {
          fail(issues.map((issue) => issue.message).join("\n"), {
            errorCode: "invalid_panel_config",
            details: { issues },
          });
        }
      }
      return { nextRoot, nextOperations, nextMutation, noop: false };
    }

    let root!: Record<string, unknown>;
    let originalRoot: Record<string, unknown> | undefined;
    let operations!: DashboardMutationOperation[];
    let mutation!: DashboardMutationResult;
    let verdict: PanelWriteVerdict | null = null;
    let didWrite = false;
    let savedUpdatedAt: string | undefined;

    if (args.dryRun === true) {
      const existing = await requireEditableDashboard(
        dashboardId,
        ctx,
        await getDashboard(dashboardId, ctx),
      );
      originalRoot = cloneConfig(existing.config as Record<string, unknown>);
      const computed = computeMutation(existing);
      root = computed.nextRoot;
      operations = computed.nextOperations;
      mutation = computed.nextMutation;
      if (!computed.noop) {
        const sqlError = await validateMutationSql(
          root,
          operations,
          actionContext?.signal,
        );
        if (sqlError) throw new Error(sqlError);
        verdict = await verifyMutation(
          existing.config as Record<string, unknown>,
          root,
        );
      }
    } else {
      const persisted = await upsertDashboardWithRetryOutcome(
        dashboardId,
        ctx,
        async (existing) => {
          await requireEditableDashboard(dashboardId, ctx, existing);
          originalRoot = cloneConfig(
            existing.config as Record<string, unknown>,
          );
          const computed = computeMutation(existing);
          root = computed.nextRoot;
          operations = computed.nextOperations;
          mutation = computed.nextMutation;
          verdict = null;
          // An unchanged config still goes to the store, which alone decides
          // whether anything was written; it just skips the checks.
          if (!computed.noop) {
            const sqlError = await validateMutationSql(
              computed.nextRoot,
              computed.nextOperations,
              actionContext?.signal,
            );
            if (sqlError) throw new Error(sqlError);
            verdict = await verifyMutation(
              existing.config as Record<string, unknown>,
              computed.nextRoot,
            );
          }
          return { kind: "sql" as const, body: computed.nextRoot };
        },
      );
      root = persisted.dashboard.config as Record<string, unknown>;
      savedUpdatedAt = persisted.dashboard.updatedAt;
      didWrite = persisted.didWrite;
    }

    if (!originalRoot) {
      // guard:allow-bare-error — invariant: every successful mutation path captures its source config.
      throw new Error("Could not compare the dashboard mutation result.");
    }
    const changed =
      args.dryRun === true ? !sameJsonValue(originalRoot, root) : didWrite;
    const finalMutation = changed
      ? reconcileMutationMetadata(originalRoot, root, mutation)
      : {
          ...mutation,
          changedPanelIds: [],
          movedPanelIds: [],
          removedPanelIds: [],
          insertedPanelIds: [],
          dashboardFieldsChanged: [],
        };
    if (args.dryRun !== true && changed) {
      if (!savedUpdatedAt) {
        // guard:allow-bare-error — invariant: every persisted dashboard save returns updatedAt.
        throw new Error("Could not sync the persisted dashboard version.");
      }
      void queueDashboardCollabSync(
        dashboardId,
        savedUpdatedAt,
        () => getDashboard(dashboardId, ctx),
        "agent",
      );
      track(
        "dashboard_saved",
        {
          app_name: "analytics",
          template_name: "analytics",
          output_id: dashboardId,
          output_type: "dashboard",
          dashboard_id: dashboardId,
          panel_count: Array.isArray(root.panels) ? root.panels.length : 0,
        },
        actionContext,
      );
    }

    const compact = compactDashboardResult(root, finalMutation.movedPanelIds);
    const summary = annotateSummary(
      changed
        ? `${args.dryRun === true ? "Dry-ran" : "Applied"} ${operations.length} dashboard mutation op(s) for "${dashboardId}". ` +
            `First panels: ${compact.firstPanelIds.join(", ")}.`
        : `${args.dryRun === true ? "Dry-run found no changes" : "No dashboard changes were needed"} for "${dashboardId}"; the requested state already matches.` +
            (agentCaller && args.dryRun !== true
              ? " If the viewer still sees the old result, call inspect-dashboard-panel to see what the panel renders."
              : ""),
      verdict,
      { saved: args.dryRun !== true && changed },
    );

    return {
      id: dashboardId,
      dashboardId,
      name: typeof root.name === "string" ? root.name : dashboardId,
      mutationApiVersion: 1,
      saved: args.dryRun !== true && changed,
      changed,
      dryRun: args.dryRun === true,
      appliedOps: operations.length,
      ...compact,
      commandLog: mutation.commandLog,
      changedPanelIds: finalMutation.changedPanelIds,
      insertedPanelIds: finalMutation.insertedPanelIds,
      removedPanelIds: finalMutation.removedPanelIds,
      dashboardFieldsChanged: finalMutation.dashboardFieldsChanged,
      ...verdictFields(verdict),
      ...(agentCaller && args.dryRun !== true
        ? {
            _receipt: changed
              ? dashboardWriteReceipt(
                  dashboardId,
                  `Saved ${operations.length} op(s) to "${dashboardId}"`,
                  verdict,
                )
              : dashboardNoopReceipt(dashboardId),
          }
        : {}),
      ...(args.dryRun === true || !changed
        ? { collabSync: { status: "skipped" as const } }
        : {
            collabSync: {
              status: "queued" as const,
              timeoutMs: DASHBOARD_COLLAB_SYNC_TIMEOUT_MS,
            },
          }),
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
          : "Full config omitted; call get-sql-dashboard with panelIds for a panel's SQL and config (includeConfig=true only to review the whole dashboard)."),
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
