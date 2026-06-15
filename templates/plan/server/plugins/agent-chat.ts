import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { registerEvent } from "@agent-native/core/event-bus";
import { z } from "zod";
import actionsRegistry from "../../.generated/actions-registry.js";
import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";

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

/**
 * Curated connector catalog for hosted multi-tenant deployments.
 *
 * Active when AGENT_NATIVE_CONNECTOR_CATALOG=1 is set (hosted plan.agent-native.com).
 * External coding agents (Claude Code, Codex, Cursor, etc.) connecting via MCP
 * see only these tools plus the builtin cross-app tools (list_apps, open_app,
 * ask_app, create_embed_session). Tools outside this list are not callable.
 *
 * Callers who need the full surface (db-exec, seed-*, extension tools, etc.)
 * can opt up with `agent-native connect --full-catalog`.
 *
 * EXCLUDED intentionally:
 *   - seed-kitchen-sink, seed-vertical-tabs  (destructive demo scripts)
 *   - get-local-plan-folder                  (filesystem path, not useful remotely)
 *   - context-manifest-get/pin/evict/restore/report  (context-xray internals)
 *   - visualize-plan                         (internal alias, superseded)
 */
export const PLAN_CONNECTOR_CATALOG = [
  // Plan CRUD
  "create-visual-plan",
  "create-ui-plan",
  "create-prototype-plan",
  "create-plan-design",
  "create-visual-questions",
  "create-visual-recap",
  "get-visual-plan",
  "list-visual-plans",
  "update-visual-plan",
  "get-plan-blocks",
  "get-plan-feedback",
  "consume-plan-feedback",
  "reply-to-plan-comment",
  "resolve-plan-comment",
  "delete-plan-comment",
  // Plan versioning
  "list-plan-versions",
  "get-plan-version",
  "restore-plan-version",
  // Plan source / export
  "read-visual-plan-source",
  "export-visual-plan",
  "import-visual-plan-source",
  "patch-visual-plan-source",
  // Plan publish & convert
  "publish-visual-plan",
  "convert-visual-plan-to-prototype",
  // Record recap
  "record-recap-usage",
  // Sharing
  "set-resource-visibility",
  "share-resource",
  "unshare-resource",
  "list-resource-shares",
  // Media
  "upload-image",
  // Navigation & screen
  "navigate",
  "view-screen",
  // Automations (users configure plan event notifications from external agents)
  "manage-automations",
  // Tool discovery
  "tool-search",
];

export default createAgentChatPlugin({
  appId: "plan",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  anonymousOwner: resolvePlanAnonymousOwner,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  connectorCatalog: PLAN_CONNECTOR_CATALOG,
});
