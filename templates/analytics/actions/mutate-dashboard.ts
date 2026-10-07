import { defineAction, embedApp } from "@agent-native/core";
import { fail, type WriteReceipt } from "@agent-native/core/action";
import {
  buildDeepLink,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import {
  DASHBOARD_COLLAB_SYNC_TIMEOUT_MS,
  queueDashboardCollabSync,
} from "../server/lib/dashboard-collab-sync";
import {
  annotateSummary,
  describePanelOutcome,
  verdictFields,
  verifyPanelWrite,
  type PanelVerification,
  type PanelWriteVerdict,
} from "../server/lib/dashboard-panel-verification";
import {
  getDashboard,
  upsertDashboardWithRetry,
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
  "Compact script form of `operations`: JSON-literal calls on `dashboard` only (quote object keys; no variables, loops, or imports). Use it for short layout or config edits; the dashboard-management skill lists the methods. " +
  `Examples: ${DASHBOARD_MUTATION_EXAMPLES[0]} ${DASHBOARD_MUTATION_EXAMPLES[2]}`;

const dryRunHelp = "Validate and verify without saving.";
const allowEmptyResultHelp =
  "Set true only when the user expects an edited panel to have no rows right now; the save then reports verified:false. It never overrides missing columns or query errors.";

const agentInputSchema = z.object({
  dashboardId: z.string().min(1).describe("Dashboard id."),
  operations: z
    .array(mutationOperationSchema)
    .max(MAX_DASHBOARD_MUTATION_OPERATIONS)
    .optional()
    .describe("Edits applied atomically in one save, by panel id."),
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

class NoEffectiveChange extends Error {}

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

/**
 * What the save proved, for the loop's final-answer guard. Failing checks come
 * first so the receipt's check cap never drops the reason.
 */
function writeReceipt(
  dashboardId: string,
  appliedOps: number,
  verdict: PanelWriteVerdict | null,
): WriteReceipt {
  const saved = `Saved ${appliedOps} op(s) to "${dashboardId}"`;
  const panels = verdict?.verification?.panels ?? [];
  if (!verdict || verdict.verified === null || panels.length === 0) {
    return {
      changed: true,
      verified: true,
      summary: `${saved}; no panel render was affected.`,
    };
  }
  const checks = panels
    .map((panel) => ({
      id: panel.panelId,
      ok: panel.status === "ok" && panel.staticIssues.length === 0,
      detail: describePanelOutcome(panel),
    }))
    .sort((a, b) => Number(a.ok) - Number(b.ok));
  const failing = checks.filter((check) => !check.ok);
  const titleOf = new Map(panels.map((panel) => [panel.panelId, panel.title]));
  return {
    changed: true,
    verified: verdict.verified,
    summary:
      failing.length === 0
        ? `${saved}; ${panels.length} panel(s) verified rendering: ${panels
            .slice(0, 3)
            .map((panel) => `"${panel.title}"`)
            .join(", ")}.`
        : `${saved} but NOT verified: ${failing
            .slice(0, 2)
            .map((check) => `"${titleOf.get(check.id)}" ${check.detail}`)
            .join("; ")}.`,
    checks,
  };
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
    "Edit a SQL dashboard in ONE atomic save: move, insert, duplicate, remove, and edit panels by id (title, SQL, width, config), patch dashboard fields, or set filter defaults. Pass typed `operations`; `code` is a compact script form of the same edits. " +
    "Place a panel in a visible row with nextToPanelId or rowNumber. First-party panel SQL must bind to a dashboard time filter (config.timeScope). Use `compose-dashboard` for catalog metrics and keep large SQL out of `code`. Read the existing panels with `get-sql-dashboard` first and match their chart types, widths, and config. The dashboard-management skill owns placement, time-scope, and config rules. " +
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
      "Edits applied atomically in one save, by panel id. Native callers pass an array; shell/legacy callers may pass a JSON string.",
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
      if (!nextMutation.changed) {
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

    function noEffectiveChange(mutation: DashboardMutationResult): never {
      fail(
        `No effective change: dashboard "${dashboardId}" already has exactly this config, so nothing was written` +
          (mutation.noopOps.length > 0
            ? ` (ops that changed nothing: ${mutation.noopOps.join(", ")})`
            : "") +
          ". If the viewer still sees the old result, their view is not this saved config (filters, saved view, or a stale tab): call the inspect-dashboard-panel action for the panel to see what it renders.",
        { errorCode: "no_effective_change", statusCode: 409 },
      );
    }

    let root!: Record<string, unknown>;
    let operations!: DashboardMutationOperation[];
    let mutation!: DashboardMutationResult;
    let verdict: PanelWriteVerdict | null = null;
    let noop = false;

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
      noop = computed.noop;
      if (!noop) {
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
      try {
        const saved = await upsertDashboardWithRetry(
          dashboardId,
          ctx,
          async (existing) => {
            const computed = computeMutation(existing);
            root = computed.nextRoot;
            operations = computed.nextOperations;
            mutation = computed.nextMutation;
            if (computed.noop) throw new NoEffectiveChange();
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
            return { kind: "sql" as const, body: computed.nextRoot };
          },
        );
        root = saved.config as Record<string, unknown>;
        queueDashboardCollabSync(dashboardId, root, "agent");
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
      } catch (err) {
        if (!(err instanceof NoEffectiveChange)) throw err;
        if (agentCaller) noEffectiveChange(mutation);
        noop = true;
      }
    }

    const compact = compactDashboardResult(root, movedPanelIdsFrom(operations));
    const summary = annotateSummary(
      (noop
        ? `No change for "${dashboardId}": the saved dashboard already has this exact config; nothing was written. `
        : `${args.dryRun === true ? "Dry-ran" : "Applied"} ${operations.length} dashboard mutation op(s) for "${dashboardId}". ` +
          (mutation.noopOps.length > 0
            ? `Ops that changed nothing: ${mutation.noopOps.join(", ")}. `
            : "")) + `First panels: ${compact.firstPanelIds.join(", ")}.`,
      verdict,
      { saved: args.dryRun !== true },
    );

    return {
      id: dashboardId,
      dashboardId,
      name: typeof root.name === "string" ? root.name : dashboardId,
      mutationApiVersion: 1,
      saved: args.dryRun !== true && !noop,
      changed: !noop,
      noop,
      dryRun: args.dryRun === true,
      appliedOps: operations.length,
      ...compact,
      commandLog: mutation.commandLog,
      noopOps: mutation.noopOps,
      changedPanelIds: mutation.changedPanelIds,
      insertedPanelIds: mutation.insertedPanelIds,
      removedPanelIds: mutation.removedPanelIds,
      dashboardFieldsChanged: mutation.dashboardFieldsChanged,
      ...verdictFields(verdict),
      ...(agentCaller && args.dryRun !== true && !noop
        ? { _receipt: writeReceipt(dashboardId, operations.length, verdict) }
        : {}),
      ...(args.dryRun === true || noop
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
