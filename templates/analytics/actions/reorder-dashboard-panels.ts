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
  compactDashboardResult,
  movePanelsById,
  type PanelOrderTarget,
} from "./dashboard-panel-order";

function parseJsonArrayString(value: string, fieldName: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err: any) {
    throw new Error(`${fieldName} must be a JSON array: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  return parsed.map((item) => String(item));
}

const panelIdsSchema = z.union([
  z.array(z.string()),
  z.string().transform((value) => parseJsonArrayString(value, "panelIds")),
]);

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

function resolveTarget(args: {
  position?: "top" | "bottom";
  index?: number;
  beforePanelId?: string;
  afterPanelId?: string;
}): PanelOrderTarget {
  const explicitTargets = [
    args.index !== undefined,
    !!args.beforePanelId,
    !!args.afterPanelId,
  ].filter(Boolean).length;
  if (explicitTargets > 1) {
    throw new Error(
      "provide only one of `index`, `beforePanelId`, or `afterPanelId`.",
    );
  }
  if (args.beforePanelId) return { beforePanelId: args.beforePanelId };
  if (args.afterPanelId) return { afterPanelId: args.afterPanelId };
  if (args.index !== undefined) return { index: args.index };
  return { position: args.position ?? "top" };
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

export default defineAction({
  agentTool: false,
  description:
    "Move one or more existing SQL dashboard panels by panel id in ONE atomic save. Use this for requests like 'move these charts to the top', 'put panel A before panel B', or 'send this section to the bottom'. This avoids brittle /panels/<index> JSON-pointer math and keeps omitted panels in their existing relative order. Returns compact proof: panelCount, movedPanelIds, firstPanelIds, and panelOrder.",
  schema: z.object({
    dashboardId: z
      .string()
      .optional()
      .describe("Dashboard id, e.g. 'agent-native-templates-first-party'."),
    id: z
      .string()
      .optional()
      .describe("Legacy alias for dashboardId. Prefer dashboardId."),
    panelIds: panelIdsSchema.describe(
      "Panel ids to move as a group, in the order they should appear at the target. Accepts a native array, or a JSON string for shell/legacy callers.",
    ),
    position: z
      .enum(["top", "bottom"])
      .optional()
      .describe(
        "Move the group to the top or bottom when no explicit index/before/after target is provided. Defaults to top.",
      ),
    index: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Insert the moved group at this zero-based index after removing those panels from their old positions.",
      ),
    beforePanelId: z
      .string()
      .optional()
      .describe(
        "Insert the moved group immediately before this existing panel id.",
      ),
    afterPanelId: z
      .string()
      .optional()
      .describe(
        "Insert the moved group immediately after this existing panel id.",
      ),
    returnConfig: z
      .boolean()
      .optional()
      .describe(
        "If true, include the full dashboard config in the result. Defaults to false to keep tool output compact.",
      ),
  }),
  http: { method: "POST" },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Dashboard preview",
      description: "Open the reordered dashboard in the real Analytics UI.",
      iframeTitle: "Agent-Native Analytics",
      openLabel: "Open dashboard",
      height: 680,
    }),
  },
  run: async (args) => {
    const dashboardId = resolveDashboardId(args);
    const scope = resolveScope();
    const ctx = { email: scope.email, orgId: scope.orgId };
    const existing = await getDashboard(dashboardId, ctx);
    if (!existing) {
      throw new Error(
        `dashboard "${dashboardId}" not found (or you don't have access).`,
      );
    }

    const root = existing.config as Record<string, unknown>;
    const orderResult = movePanelsById(
      root,
      args.panelIds,
      resolveTarget(args),
    );
    await upsertDashboard(dashboardId, existing.kind, root, ctx);
    await syncToCollab(dashboardId, root);

    const compact = compactDashboardResult(root, orderResult.movedPanelIds);
    return {
      id: dashboardId,
      dashboardId,
      name: typeof root.name === "string" ? root.name : dashboardId,
      ...compact,
      appliedOps: 1,
      insertIndex: orderResult.insertIndex,
      skippedDuplicatePanelIds: orderResult.skippedDuplicatePanelIds,
      summary:
        `Moved ${orderResult.movedPanelIds.join(", ")} in dashboard "${dashboardId}". ` +
        `First panels: ${compact.firstPanelIds.join(", ")}.`,
      ...(args.returnConfig === true ? { config: root } : {}),
      urlPath: `/dashboards/${dashboardId}`,
      deepLink: buildDeepLink({
        app: "analytics",
        view: "adhoc",
        params: { dashboardId },
      }),
      message:
        `Dashboard "${dashboardId}" reordered. ` +
        `First panels: ${compact.firstPanelIds.join(", ")}.`,
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
