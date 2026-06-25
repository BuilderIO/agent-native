import { defineAction, embedApp } from "@agent-native/core";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  assertAccess,
  currentAccess,
  ForbiddenError,
} from "@agent-native/core/sharing";
import setResourceVisibilityAction from "@agent-native/core/sharing/actions/set-resource-visibility";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  requirePlanOwnerEmailForWrite,
  resolvePlanAccessContext,
  resolvePlanOrgIdForWrite,
} from "../server/lib/local-identity.js";
import { planMdxFileSchema } from "../server/plan-mdx.js";
import {
  planDeepLink,
  planSourceSchema,
  planStatusSchema,
} from "../server/plans.js";
import importVisualPlanSourceAction from "./import-visual-plan-source.js";

const sourceUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), {
    message: "sourceUrl must be an http or https URL",
  })
  .optional();

function visualAnswerFocus(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  if (!compact) return "visual answer";
  return `visual answer: ${compact.slice(0, 120)}`;
}

type VisualAnswerVisibility = "private" | "org" | "public";

async function resolveVisualAnswerOrgIdForVisibility(
  visibility: VisualAnswerVisibility,
): Promise<string | undefined> {
  if (visibility !== "org") return undefined;

  const requesterEmail = getRequestUserEmail();
  const requestOrgId = resolvePlanOrgIdForWrite(
    requesterEmail,
    getRequestOrgId(),
  );
  if (requestOrgId) return requestOrgId;

  const ownerEmail = requirePlanOwnerEmailForWrite(
    requesterEmail,
    "Creating a visual answer",
  );
  const ownerOrgId = await resolveOrgIdForEmail(ownerEmail);
  if (ownerOrgId) return ownerOrgId;

  throw new ForbiddenError(
    "Creating an org-visible visual answer requires an active organization. Connect Plan from an organization or publish with private visibility.",
  );
}

async function runWithVisualAnswerOrgContext<T>(
  visibility: VisualAnswerVisibility,
  fn: () => Promise<T>,
): Promise<T> {
  const orgId = await resolveVisualAnswerOrgIdForVisibility(visibility);
  if (!orgId || orgId === getRequestOrgId()) return fn();
  const requestContext = getRequestContext() ?? {};
  return runWithRequestContext(
    {
      ...requestContext,
      userEmail: requestContext.userEmail ?? getRequestUserEmail(),
      orgId,
    },
    fn,
  ) as Promise<T>;
}

async function findExistingVisualAnswer(
  planId: string | undefined,
): Promise<string | undefined> {
  if (!planId) return undefined;
  const accessWhere = accessFilter(
    schema.plans,
    schema.planShares,
    resolvePlanAccessContext(currentAccess()),
  );
  const [row] = await getDb()
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(
      and(
        accessWhere,
        eq(schema.plans.id, planId),
        isNull(schema.plans.deletedAt),
      ),
    )
    .orderBy(desc(schema.plans.updatedAt))
    .limit(1);
  return row?.id;
}

export default defineAction({
  description:
    "Publish a visual answer to a code/product question as a structured visual plan. Use this after inspecting live code through the local bridge, the current coding-agent workspace, or GitHub. Good for questions like 'what is the API spec for this?', 'what does this UI look like?', or 'what is the schema model for x?'. Call get-plan-blocks first and use diagrams, wireframes, openapi-spec/api-endpoint, data-model, file-tree, tabs, annotated-code, or custom registered blocks as appropriate.",
  schema: z.object({
    question: z
      .string()
      .trim()
      .min(1)
      .describe("The user's code/product question being answered visually."),
    planId: z
      .string()
      .optional()
      .describe("Existing visual answer plan ID to replace or refresh."),
    title: z.string().optional().describe("Visual answer title override."),
    brief: z
      .string()
      .optional()
      .describe("One-line answer summary shown under the title."),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .default("org")
      .describe(
        "Visibility for the published answer. Defaults to org. Use private for owner-only answers.",
      ),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z
      .string()
      .optional()
      .describe("Repository path or owner/repo the answer is based on."),
    sourceUrl: sourceUrlSchema.describe(
      "Optional GitHub/source URL for the code, PR, issue, or file that backs this answer.",
    ),
    sourceType: z
      .enum([
        "code",
        "pull-request",
        "commit",
        "branch",
        "diff",
        "issue",
        "page",
      ])
      .optional()
      .default("code")
      .describe("Structured source type for knowledge search."),
    currentFocus: z
      .string()
      .optional()
      .describe("Current focus for the review surface."),
    status: planStatusSchema.optional().default("review"),
    mdx: planMdxFileSchema.describe(
      "Visual answer source files. Call get-plan-blocks FIRST for the current block catalog and schemas. Derive claims from inspected code only. For multi-state UI/product flows, include canvas.mdx with DesignBoard artboards and Screen HTML wireframes; each canvas Screen must use html/data.html, not nested legacy kit-tree children like FrameScreen/Card/Row/Btn. Use openapi-spec/api-endpoint blocks for API contracts, data-model for schema shape, wireframe for single inline UI answers, diagram for architecture/data-flow mechanics, and annotated-code/file-tree/tabs for code evidence.",
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Visual Answer",
    description:
      "Publish a bridge/GitHub-backed answer to a code question as a visual plan.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Answer",
      description: "Open the Agent-Native Plan visual answer surface.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Visual Answer",
      height: 860,
    }),
  },
  // Render the answer's diagram/wireframe/api-spec/data-model blocks INLINE in
  // Agent-Native chat (registry-driven, so custom registered blocks render too),
  // distinct from the MCP App iframe used by external hosts.
  chatUI: {
    renderer: "plan.visual-answer",
    title: "Visual Answer",
    description:
      "Renders the published visual answer's blocks inline in the conversation.",
  },
  run: async (args) => {
    const visibility = args.visibility ?? "org";
    return runWithVisualAnswerOrgContext(visibility, async () => {
      const existingPlanId = await findExistingVisualAnswer(args.planId);
      const result = await importVisualPlanSourceAction.run({
        planId: existingPlanId,
        title: args.title,
        brief: args.brief,
        kind: "plan",
        source: args.source,
        repoPath: args.repoPath,
        currentFocus: args.currentFocus ?? visualAnswerFocus(args.question),
        status: args.status,
        mdx: args.mdx,
      });
      const planId = (result as { planId?: string } | null)?.planId;
      if (planId) {
        await assertAccess(
          "plan",
          planId,
          "editor",
          resolvePlanAccessContext(currentAccess()),
        );
        await getDb()
          .update(schema.plans)
          .set({
            ...(args.sourceUrl !== undefined
              ? { sourceUrl: args.sourceUrl ?? null }
              : {}),
            sourceType: args.sourceType ?? "code",
          })
          .where(eq(schema.plans.id, planId));
        await setResourceVisibilityAction.run({
          resourceType: "plan",
          resourceId: planId,
          visibility,
        });
      }
      // Return a focused payload: enough for the inline chat renderer
      // (`plan.content` = normalized blocks) and the deep link, without echoing
      // the heavy import bundle (html, comments, access) back into agent context.
      const bundlePlan = (
        result as {
          plan?: {
            id?: string;
            kind?: string;
            title?: string;
            brief?: string;
            content?: unknown;
          };
        } | null
      )?.plan;
      const answerPlanId = bundlePlan?.id ?? planId;
      return {
        planId: answerPlanId,
        question: args.question,
        url: answerPlanId ? planDeepLink(answerPlanId, "plan") : undefined,
        plan: bundlePlan
          ? {
              id: bundlePlan.id,
              kind: bundlePlan.kind,
              title: bundlePlan.title,
              brief: bundlePlan.brief,
              content: bundlePlan.content,
            }
          : undefined,
      };
    });
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id, "plan"),
      label: "Open Visual Answer",
      view: "plan",
    };
  },
});
