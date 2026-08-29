import { registerEvent } from "@agent-native/core/event-bus";
import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { z } from "zod";

import actionsRegistry from "../../.generated/actions-registry.js";
import { PLAN_CONNECTOR_CATALOG } from "../lib/plan-connector-catalog.js";
import { PLAN_FRAMEWORK_TOOLS } from "../lib/plan-framework-tools.js";
import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";
import { assertPlanEditor } from "../plans.js";

const PLAN_BACKGROUND_RUN_SOFT_TIMEOUT_MS = 13 * 60_000;

const PLAN_EDIT_TOOLS = new Set([
  "convert-visual-plan-to-prototype",
  "patch-visual-plan-source",
  "restore-plan-version",
  "update-visual-plan",
]);

function hasPlanEdit(run: { events: readonly unknown[] }): boolean {
  return run.events.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const event = (entry as { event?: unknown }).event;
    if (!event || typeof event !== "object") return false;
    const record = event as Record<string, unknown>;
    return (
      record.type === "tool_done" &&
      record.completedSideEffect === true &&
      record.isError !== true &&
      typeof record.tool === "string" &&
      PLAN_EDIT_TOOLS.has(record.tool)
    );
  });
}

async function autosavePlanAfterAgentTurn(
  scope: { type: string; id: string },
  run: { events: readonly unknown[] },
): Promise<void> {
  if (scope.type !== "plan" || !hasPlanEdit(run)) return;
  await assertPlanEditor(scope.id);
  const { createPlanVersionSnapshot } = await import("../lib/plan-versions.js");
  await createPlanVersionSnapshot(scope.id, {
    force: true,
    label: "Chat autosave",
    createdBy: "agent",
  });
}

// ---------------------------------------------------------------------------
// Register plan event-bus events
// ---------------------------------------------------------------------------

registerEvent({
  name: "plan.created",
  description: "A new visual plan or recap was created.",
  payloadSchema: z.object({
    planId: z.string(),
    title: z.string(),
    kind: z.enum(["plan", "recap"]),
    status: z.string(),
    path: z.string(),
    createdBy: z.string().optional(),
  }),
  example: {
    planId: "plan-abc123",
    title: "Refactor auth flow",
    kind: "plan",
    status: "review",
    path: "/plans/plan-abc123",
    createdBy: "agent",
  },
});

registerEvent({
  name: "plan.commented",
  description: "A human or agent added one or more comments to a visual plan.",
  payloadSchema: z.object({
    planId: z.string(),
    title: z.string(),
    kind: z.enum(["plan", "recap"]),
    commentIds: z.array(z.string()),
    commentCount: z.number(),
    resolutionTarget: z.enum(["agent", "human"]).nullable(),
    excerpt: z.string(),
    author: z.string().nullable(),
    path: z.string(),
  }),
  example: {
    planId: "plan-abc123",
    title: "Refactor auth flow",
    kind: "plan",
    commentIds: ["cmt_1"],
    commentCount: 1,
    resolutionTarget: "agent",
    excerpt: "Please clarify the token refresh logic here.",
    author: "user@example.com",
    path: "/plans/plan-abc123",
  },
});

registerEvent({
  name: "plan.published",
  description:
    "A local plan was published (or re-published) to a hosted shareable instance.",
  payloadSchema: z.object({
    planId: z.string(),
    title: z.string(),
    kind: z.enum(["plan", "recap"]),
    hostedPlanId: z.string(),
    url: z.string(),
    requestedVisibility: z.string(),
  }),
  example: {
    planId: "plan-abc123",
    title: "Refactor auth flow",
    kind: "plan",
    hostedPlanId: "plan-xyz789",
    url: "https://example.agent-native.app/plans/plan-xyz789",
    requestedVisibility: "private",
  },
});

registerEvent({
  name: "plan.status.changed",
  description: "A visual plan's status was changed (e.g. review → approved).",
  payloadSchema: z.object({
    planId: z.string(),
    title: z.string(),
    kind: z.enum(["plan", "recap"]),
    oldStatus: z.string().nullable(),
    newStatus: z.string(),
    changedBy: z.string().nullable(),
    path: z.string(),
  }),
  example: {
    planId: "plan-abc123",
    title: "Refactor auth flow",
    kind: "plan",
    oldStatus: "review",
    newStatus: "approved",
    changedBy: "user@example.com",
    path: "/plans/plan-abc123",
  },
});

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "visual-answer",
  "search-pr-recaps",
  "get-visual-plan",
  "list-visual-plans",
  "create-visual-plan",
  "update-visual-plan",
  "create-visual-recap",
  "report-visual-plan",
  "get-plan-blocks",
  "list-plan-components",
  "navigate",
];

const planAgentChatOptions = {
  appId: "plan",
  onAgentTurnComplete: autosavePlanAfterAgentTurn,
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  anonymousOwner: resolvePlanAnonymousOwner,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  frameworkTools: PLAN_FRAMEWORK_TOOLS,
  mcp: {
    // Plan mounts MCP from a dedicated early plugin (`00-mcp.ts`) so its
    // external connector does not wait on chat plugin initialization.
    enabled: false,
    connectorCatalog: PLAN_CONNECTOR_CATALOG,
  },
  durableBackgroundRuns: true,
  runSoftTimeoutMs: PLAN_BACKGROUND_RUN_SOFT_TIMEOUT_MS,
};

export default createAgentChatPlugin(planAgentChatOptions);
