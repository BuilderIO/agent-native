import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { loadPlanBundle, planDeepLink } from "../server/plans.js";

/**
 * Pull an EXISTING visual plan or recap into the chat, rendering its blocks
 * inline. Distinct from `get-visual-plan` (which the agent calls frequently for
 * read/inspection and which would be noisy to render inline on every read):
 * this action is the intentional "show me that one" surface, so it carries the
 * `plan.visual-answer` inline renderer and returns only the focused content the
 * renderer needs. Access is enforced by `loadPlanBundle` (resolveAccess →
 * ForbiddenError for private/missing plans), so it can't leak other users'
 * plans.
 */
export default defineAction({
  description:
    "Surface an existing visual plan or recap INLINE in the chat by id, rendering its diagram/wireframe/api-spec/data-model/text blocks in the conversation. Use when the user wants to see or pull up a specific existing plan or recap (e.g. a recap returned by search-pr-recaps). For generating a new visual answer to a question, use visual-answer instead.",
  schema: z.object({
    id: z.string().min(1).describe("Plan or recap ID to surface inline."),
  }),
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Show Visual Plan",
    description: "Render an existing visual plan or recap inline in chat.",
  },
  chatUI: {
    renderer: "plan.visual-answer",
    title: "Visual Plan",
    description:
      "Renders the plan or recap's blocks inline in the conversation.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.id);
    const plan = bundle.plan;
    return {
      planId: plan.id,
      url: planDeepLink(plan.id, plan.kind),
      plan: {
        id: plan.id,
        kind: plan.kind,
        title: plan.title,
        brief: plan.brief,
        content: plan.content,
      },
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string; kind?: string } } | null)
      ?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id, plan.kind === "recap" ? "recap" : "plan"),
      label: plan.kind === "recap" ? "Open Recap" : "Open Plan",
      view: "plan",
    };
  },
});
