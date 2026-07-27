import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertGuestCreateWithinLimits } from "../server/lib/guest-abuse.js";
import {
  isLocalPlanRuntime,
  resolvePlanOrgIdForWrite,
  requirePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  createPlanContentFromSections,
  normalizePlanContent,
  sanitizeStoredPlanHtml,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  buildPlanHtml,
  commentInputSchema,
  deriveSectionsFromText,
  emitPlanCreated,
  insertInitialPlanComments,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planPath,
  planSourceSchema,
  planStatusSchema,
  sectionInputSchema,
  writeEvent,
} from "../server/plans.js";
import {
  agentPlanContentSchema,
  planContentSchema,
} from "../shared/plan-content.js";

function inferImportedPlanTitle(planText: string): string {
  const firstHeading = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/.test(line));
  if (firstHeading) return firstHeading.replace(/^#{1,3}\s+/, "").slice(0, 90);
  const firstLine = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 90) : "Imported visual plan";
}

const CONTENT_DESCRIPTION =
  "Structured editable plan content. Prefer this for rich text, inline diagrams, annotated code, question-form open questions, and optional canvas/prototype UI surfaces. Call the get-plan-blocks tool FIRST for the authoritative block catalog, visual frame guidance, authoring rules, and style tokens — do not author from memory. Key rules: canvas frames use wireframe data.html/html semantic HTML, not legacy kit-tree screen arrays; use diagram blocks with .diagram-* primitives and --wf-* tokens (no hex/rgb/hsl, no custom fonts); for file maps use annotated-code blocks in a vertical tabs block; put unresolved decisions in a bottom question-form block.";

// Named (and un-refined) so `agentInputSchema` below can `.extend()` it with
// a compact `content` field instead of duplicating every other key. The
// `.refine()` (brief/goal/planText requirement) is applied only to the real
// runtime `schema` further down — refine predicates aren't serializable JSON
// Schema anyway, so the advertised copy never needs it.
const createVisualPlanSchema = z.object({
  title: z.string().optional().describe("Short plan title"),
  brief: z
    .string()
    .optional()
    .describe(
      "One short sentence summarizing the plan, shown as the lede under the title. Keep it to a single tight line — the document body carries the detail, not this summary.",
    ),
  goal: z.string().optional().describe("Alias for brief."),
  planText: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Existing Codex, Claude Code, Markdown, or pasted plan text to preserve and turn into a visual review plan.",
    ),
  source: planSourceSchema.optional(),
  repoPath: z.string().optional().describe("Repository path for the run"),
  currentFocus: z.string().optional().describe("Current plan focus"),
  status: planStatusSchema.optional().default("review"),
  html: z
    .string()
    .optional()
    .describe(
      "Legacy: a standalone HTML document. Setting this NULLS structured content — blocks, contentPatches, inline editing, and MDX round-trip all stop working for this plan. Only for preserving a pre-existing HTML artifact; never author new plans this way.",
    ),
  content: planContentSchema.optional().describe(CONTENT_DESCRIPTION),
  markdown: z
    .string()
    .optional()
    .describe("Markdown/text fallback or source plan"),
  sections: z
    .array(sectionInputSchema)
    .optional()
    .default([])
    .describe("Readable plan sections and visual blocks"),
  comments: z
    .array(commentInputSchema)
    .optional()
    .default([])
    .describe("Initial annotations or review prompts"),
});

export default defineAction({
  description:
    "Create a document-first structured plan for any coding task. Call this EXACTLY ONCE per plan — produce the final plan in a single call. Do NOT create a draft and then a second 'clean' version; if you need to revise after creating, call update-visual-plan with the existing planId instead of creating another plan (each create renders its own embed, so a second create leaves a duplicate). For a plan whose centerpiece is wireframed screens/states on a canvas use create-ui-plan; for a recap of an existing diff use create-visual-recap; for a running interactive prototype use create-prototype-plan; for a full-fidelity branded design use create-plan-design. Also accepts imported Codex, Claude Code, Markdown, or pasted plan text via planText. Publish via this tool; never deliver the plan as inline chat text.",
  schema: createVisualPlanSchema.refine(
    (args) => Boolean(args.brief || args.goal || args.planText),
    { message: "Either brief, goal, or planText is required." },
  ),
  // ADVERTISED-ONLY: same top-level shape, but `content` swaps the deep
  // per-block-type union for a compact `type`-enum stand-in. Runtime
  // validation always runs the full schema above — see the `actions` skill.
  agentInputSchema: createVisualPlanSchema.extend({
    content: agentPlanContentSchema.optional().describe(CONTENT_DESCRIPTION),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Visual Plan",
    description:
      "Create a plan where a person can scan structured blocks, inline diagrams, optional UI visuals, annotate, and respond before the agent builds.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan",
      description:
        "Open the Agent-Native Plan review surface for structured blocks, inline diagrams, optional UI wireframes/prototypes, and comments.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Plan",
      height: 900,
    }),
  },
  run: async (args) => {
    const requesterEmail = getRequestUserEmail();
    const requesterName = getRequestUserName();
    const ownerEmail = requirePlanOwnerEmailForWrite(
      requesterEmail,
      "Creating a visual plan",
    );
    const ownerOrgId = resolvePlanOrgIdForWrite(
      requesterEmail,
      getRequestOrgId(),
    );
    await assertGuestCreateWithinLimits(ownerEmail);

    const importedPlanText = args.planText?.trim();
    const id = newId("plan");
    const now = nowIso();
    const brief =
      args.brief ||
      args.goal ||
      (importedPlanText
        ? "Visual companion for an imported coding-agent plan."
        : "");
    const title =
      args.title ||
      (importedPlanText
        ? inferImportedPlanTitle(importedPlanText)
        : "Untitled visual plan");
    const sections =
      args.sections.length > 0
        ? args.sections
        : importedPlanText && !args.content && !args.html
          ? deriveSectionsFromText(importedPlanText)
          : [
              {
                type: "summary" as const,
                title: "What we are planning",
                body: brief,
                order: 0,
                createdBy: "agent" as const,
              },
              {
                type: "diagram" as const,
                title: "Review flow",
                body: "The plan is meant to be scanned, annotated, revised, then used for implementation.",
                order: 1,
                createdBy: "agent" as const,
              },
              {
                type: "implementation" as const,
                title: "Files and symbols to review",
                body: "Add file references here once the agent has inspected the repo, for example `app/routes/example.tsx` - symbols: `ExampleRoute`; update the route behavior and include a short code preview.",
                order: 2,
                createdBy: "agent" as const,
              },
            ];
    const content = args.content
      ? normalizePlanContent(args.content)
      : args.html
        ? null
        : createPlanContentFromSections({
            title,
            brief,
            sections: sections.map((section, index) => ({
              id: section.id ?? `section-${index + 1}`,
              type: section.type,
              title: section.title,
              body: section.body,
              html: section.html,
            })),
          });

    await getDb()
      .insert(schema.plans)
      .values({
        id,
        title,
        brief,
        status: args.status,
        source: args.source ?? (importedPlanText ? "imported" : "manual"),
        repoPath: args.repoPath ?? null,
        currentFocus: args.currentFocus ?? "visual review",
        html: args.html != null ? sanitizeStoredPlanHtml(args.html) : null,
        markdown: args.markdown ?? importedPlanText ?? null,
        content: content ? serializePlanContent(content) : null,
        createdAt: now,
        updatedAt: now,
        approvedAt: args.status === "approved" ? now : null,
        ownerEmail,
        orgId: ownerOrgId,
        visibility: "private",
      });

    // `planSections.id` is a GLOBAL primary key, so a client-supplied id (e.g.
    // "section-1") collides across plans/retries and throws on insert. Always
    // generate a unique server id; keep a logical-id -> row-id map so comment
    // anchors can be remapped instead of failing the foreign key.
    const sectionIdByLogical = new Map<string, string>();
    const sectionRows = sections.map((section, index) => {
      const rowId = newId("sec");
      const logicalId = section.id ?? `section-${index + 1}`;
      sectionIdByLogical.set(logicalId, rowId);
      if (section.id) sectionIdByLogical.set(section.id, rowId);
      return {
        id: rowId,
        planId: id,
        type: section.type,
        title: section.title,
        body: section.body,
        html: section.html ?? null,
        order: section.order ?? index,
        createdBy: section.createdBy,
        createdAt: now,
        updatedAt: now,
      };
    });
    await getDb().insert(schema.planSections).values(sectionRows);

    // Remap each comment's sectionId to its real row id; drop (undefined)
    // anchors that match no section rather than failing the FK and blocking the
    // publish.
    const commentsForInsert = args.comments.map((comment) => {
      if (!comment.sectionId) return comment;
      const mapped = sectionIdByLogical.get(comment.sectionId);
      return { ...comment, sectionId: mapped };
    });

    await insertInitialPlanComments({
      planId: id,
      comments: commentsForInsert,
      requestEmail: requesterEmail,
      requestName: requesterName,
      now,
    });

    await writeEvent({
      planId: id,
      type: importedPlanText ? "plan.imported" : "plan.created",
      message: importedPlanText
        ? "Imported text plan for visual review."
        : "Visual plan created.",
      ...(importedPlanText
        ? {
            payload: {
              source: args.source ?? "imported",
              textLength: importedPlanText.length,
            },
          }
        : {}),
      createdBy: importedPlanText ? "import" : "agent",
    });

    const bundle = await loadPlanBundle(id);
    emitPlanCreated({
      planId: id,
      title: bundle.plan.title,
      kind: bundle.plan.kind,
      status: bundle.plan.status,
      ownerEmail: bundle.access.ownerEmail,
    });
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: id,
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          content: bundle.plan.content,
          url: planPath(id),
        })
      : null;
    return {
      ...bundle,
      planId: id,
      html: buildPlanHtml(bundle),
      path: planPath(id),
      url: planPath(id),
      ...(local?.written ? { localFiles: local } : {}),
      fallbackInstructions:
        "Open the Agent-Native Plan link, scan the editable rich plan blocks and any top UI/product visual tabs, add comments or corrections, then I will call get-plan-feedback before continuing. The live link is private until shared; use the Share panel for reviewer access or export-visual-plan for an HTML/Markdown/JSON receipt to check into source.",
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Plan",
      view: "plan",
    };
  },
});
