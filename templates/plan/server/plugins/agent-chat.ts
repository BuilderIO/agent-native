import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { registerEvent } from "@agent-native/core/event-bus";
import { z } from "zod";
import actionsRegistry from "../../.generated/actions-registry.js";
import { PLAN_CONNECTOR_CATALOG } from "../lib/plan-connector-catalog.js";
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

const planAgentChatOptions = {
  appId: "plan",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  anonymousOwner: resolvePlanAnonymousOwner,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  connectorCatalog: PLAN_CONNECTOR_CATALOG,
  disableMcp: true,
};

export default createAgentChatPlugin(planAgentChatOptions);
