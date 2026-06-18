import { defineAction, embedApp } from "@agent-native/core";
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
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import importVisualPlanSourceAction from "./import-visual-plan-source.js";
import { planMdxFileSchema } from "../server/plan-mdx.js";
import {
  planDeepLink,
  planSourceSchema,
  planStatusSchema,
} from "../server/plans.js";
import { getDb, schema } from "../server/db/index.js";
import {
  requirePlanOwnerEmailForWrite,
  resolvePlanAccessContext,
  resolvePlanOrgIdForWrite,
} from "../server/lib/local-identity.js";

const sourceUrlSchema = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), {
    message: "sourceUrl must be an http or https URL",
  })
  .optional();

const sourceTypeSchema = z
  .enum(["pull-request", "commit", "branch", "diff", "issue", "page", "code"])
  .optional();

const sourcePrStateSchema = z.enum(["open", "closed", "merged", "unknown"]);

type RecapSourceMetadata = {
  sourceType?: string;
  sourceRepo?: string;
  sourcePrNumber?: number;
  sourcePrState?: "open" | "closed" | "merged" | "unknown";
  sourcePrMergedAt?: string;
};

type RecapVisibility = "private" | "org" | "public";

function inferGithubPullRequestSource(
  sourceUrl: string | undefined,
): RecapSourceMetadata {
  if (!sourceUrl) return {};
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "github.com") return {};
    const [, owner, repo, kind, number] = url.pathname.split("/");
    if (!owner || !repo || kind !== "pull" || !number) return {};
    const prNumber = Number(number);
    if (!Number.isInteger(prNumber) || prNumber <= 0) return {};
    return {
      sourceType: "pull-request",
      sourceRepo: `${owner}/${repo}`,
      sourcePrNumber: prNumber,
    };
  } catch {
    return {};
  }
}

function normalizeRecapSourceMetadata(args: {
  sourceUrl?: string;
  sourceType?: string;
  sourceRepo?: string;
  sourcePrNumber?: number;
  sourcePrState?: "open" | "closed" | "merged" | "unknown";
  sourcePrMergedAt?: string;
}): RecapSourceMetadata {
  const inferred = inferGithubPullRequestSource(args.sourceUrl);
  const sourcePrMergedAt = args.sourcePrMergedAt?.trim();
  const sourcePrState =
    args.sourcePrState ?? (sourcePrMergedAt ? "merged" : undefined);
  return {
    sourceType: args.sourceType ?? inferred.sourceType,
    sourceRepo: args.sourceRepo ?? inferred.sourceRepo,
    sourcePrNumber: args.sourcePrNumber ?? inferred.sourcePrNumber,
    sourcePrState,
    sourcePrMergedAt: sourcePrMergedAt || undefined,
  };
}

async function findExistingRecapForIdempotencyKey(
  idempotencyKey: string | undefined,
): Promise<string | undefined> {
  if (!idempotencyKey) return undefined;

  const requesterEmail = getRequestUserEmail();
  const ownerEmail = requirePlanOwnerEmailForWrite(
    requesterEmail,
    "Creating a visual recap",
  );
  const ownerOrgId = resolvePlanOrgIdForWrite(
    requesterEmail,
    getRequestOrgId(),
  );
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
        eq(schema.plans.kind, "recap"),
        eq(schema.plans.recapIdempotencyKey, idempotencyKey),
        eq(schema.plans.ownerEmail, ownerEmail),
        ownerOrgId
          ? eq(schema.plans.orgId, ownerOrgId)
          : isNull(schema.plans.orgId),
      ),
    )
    .orderBy(desc(schema.plans.updatedAt))
    .limit(1);

  return row?.id;
}

async function resolveRecapOrgIdForVisibility(
  visibility: RecapVisibility,
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
    "Creating a visual recap",
  );
  const ownerOrgId = await resolveOrgIdForEmail(ownerEmail);
  if (ownerOrgId) return ownerOrgId;

  throw new ForbiddenError(
    "Creating an org-visible visual recap requires an active organization. Connect Plan from an organization or publish with private visibility.",
  );
}

async function runWithRecapOrgContext<T>(
  visibility: RecapVisibility,
  fn: () => Promise<T>,
): Promise<T> {
  const orgId = await resolveRecapOrgIdForVisibility(visibility);
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

export default defineAction({
  description:
    "Create a visual code-review recap from an existing PR, commit, branch, or git diff. For a forward plan before implementation use create-visual-plan; for a UI-first plan use create-ui-plan; for a running prototype use create-prototype-plan. Derive all content from the real diff — never invent schema, API, file, or contract facts. Publish via this tool; never deliver the recap as inline chat text.",
  schema: z.object({
    planId: z
      .string()
      .optional()
      .describe("Existing recap plan ID to replace on a subsequent push."),
    title: z.string().optional().describe("Recap title override."),
    brief: z
      .string()
      .optional()
      .describe(
        "Optional one-line recap summary shown under the title. Keep it to a single short sentence.",
      ),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .default("org")
      .describe(
        "Visibility for the published recap. Defaults to 'org' (login-gated to the publishing org) so the recap is never accidentally public. Pass 'private' to keep it owner-only.",
      ),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the recap."),
    sourceUrl: sourceUrlSchema.describe(
      "URL of the pull request, issue, or commit that this recap covers. Must be an http(s) URL. When set, the hosted recap page shows a 'View PR' link back to the source.",
    ),
    sourceType: sourceTypeSchema.describe(
      "Structured source type for recap search. Use 'pull-request' for PR visual recaps.",
    ),
    sourceRepo: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Repository full name for PR recaps, e.g. owner/repo."),
    sourcePrNumber: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Pull request number when sourceType is pull-request."),
    sourcePrState: sourcePrStateSchema
      .optional()
      .describe(
        "Pull request state. Use 'merged' once GitHub reports the PR was merged.",
      ),
    sourcePrMergedAt: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("ISO timestamp for when the source pull request was merged."),
    idempotencyKey: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Stable client-generated key for retrying the same recap publish without creating duplicate recap rows.",
      ),
    currentFocus: z
      .string()
      .optional()
      .default("visual recap review")
      .describe("Current focus for the review surface."),
    status: planStatusSchema.optional().default("review"),
    mdx: planMdxFileSchema.describe(
      "Recap source files. Call the get-plan-blocks tool FIRST for the authoritative block catalog, authoring rules, and style tokens — do not author from memory. Key rules: derive all blocks from the real diff only; use diff blocks with line-anchored annotations on key hunks; for UI changes include realistic, non-empty WireframeBlock before/after in a Columns block (labels: Before / After) with visible product text/controls; use .diagram-* primitives and --wf-* tokens in diagrams (no hex/rgb/hsl, no custom fonts); keep API endpoint blocks in single-column flow unless it is an explicit before/after contract comparison.",
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Visual Recap",
    description:
      "Create a visual code-review recap from a real PR, branch, commit, or git diff.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Recap",
      description:
        "Open the Agent-Native Plan review surface for a visual code-review recap.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Recap",
      height: 860,
    }),
  },
  run: async (args) => {
    const visibility = args.visibility ?? "org";
    return runWithRecapOrgContext(visibility, async () => {
      const { idempotencyKey, ...importArgs } = args;
      const sourceMetadata = normalizeRecapSourceMetadata(args);
      const existingPlanId = args.planId
        ? undefined
        : await findExistingRecapForIdempotencyKey(idempotencyKey);
      const importRecap = (planId: string | undefined) =>
        importVisualPlanSourceAction.run({
          ...importArgs,
          planId,
          kind: "recap",
          ...(idempotencyKey ? { recapIdempotencyKey: idempotencyKey } : {}),
          source: args.source ?? "imported",
          currentFocus: args.currentFocus ?? "visual recap review",
          status: args.status ?? "review",
        });
      let result;
      try {
        result = await importRecap(args.planId ?? existingPlanId);
      } catch (error) {
        if (args.planId || existingPlanId || !idempotencyKey) throw error;
        const replayPlanId =
          await findExistingRecapForIdempotencyKey(idempotencyKey);
        if (!replayPlanId) throw error;
        result = await importRecap(replayPlanId);
      }
      // Apply requested visibility server-side so the recap is never left private
      // (the import action always creates with visibility='private'). Route this
      // through the shared visibility action instead of updating the row directly:
      // when visibility is "org", that action also binds the current org onto
      // older/unscoped plans so org-scoped recap links are actually readable.
      const planId = (result as { planId?: string } | null)?.planId;
      if (planId) {
        await assertAccess(
          "plan",
          planId,
          "editor",
          resolvePlanAccessContext(currentAccess()),
        );
        const planPatch = {
          ...(args.sourceUrl !== undefined
            ? { sourceUrl: args.sourceUrl ?? null }
            : {}),
          ...(sourceMetadata.sourceType !== undefined
            ? { sourceType: sourceMetadata.sourceType }
            : {}),
          ...(sourceMetadata.sourceRepo !== undefined
            ? { sourceRepo: sourceMetadata.sourceRepo }
            : {}),
          ...(sourceMetadata.sourcePrNumber !== undefined
            ? { sourcePrNumber: sourceMetadata.sourcePrNumber }
            : {}),
          ...(sourceMetadata.sourcePrState !== undefined
            ? { sourcePrState: sourceMetadata.sourcePrState }
            : {}),
          ...(sourceMetadata.sourcePrMergedAt !== undefined
            ? { sourcePrMergedAt: sourceMetadata.sourcePrMergedAt }
            : {}),
          ...(idempotencyKey ? { recapIdempotencyKey: idempotencyKey } : {}),
        };
        if (Object.keys(planPatch).length > 0) {
          const db = getDb();
          await db
            .update(schema.plans)
            .set(planPatch)
            .where(eq(schema.plans.id, planId));
        }
        await setResourceVisibilityAction.run({
          resourceType: "plan",
          resourceId: planId,
          visibility,
        });
      }
      return result;
    });
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id, "recap"),
      label: "Open Recap",
      view: "plan",
    };
  },
});
