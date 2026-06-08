import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  createPlanContentFromSections,
  normalizePlanContent,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  isLocalPlanRuntime,
  resolvePlanOrgIdForWrite,
  requirePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { assertGuestCreateWithinLimits } from "../server/lib/guest-abuse.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import {
  buildPlanHtml,
  commentInputSchema,
  deriveSectionsFromText,
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
import { planContentSchema } from "../shared/plan-content.js";

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

export default defineAction({
  description:
    "Create an Agent-Native plan for a coding-agent task, or import existing Codex, Claude Code, Markdown, or pasted plan text as the starting point. Use this before implementation to open a durable structured plan with inline document diagrams, annotated code for the key files, options, annotations, and an optional top UI/product visual surface (none, wireframe canvas only, or wireframe canvas plus clickable prototype tabs).",
  schema: z
    .object({
      title: z.string().optional().describe("Short plan title"),
      brief: z
        .string()
        .optional()
        .describe(
          "One short sentence summarizing the plan, shown as the lede under the title. Keep it to a single tight line — the document body carries the detail, not this summary.",
        ),
      goal: z
        .string()
        .optional()
        .describe("Compatibility alias for brief; prefer brief"),
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
          "Legacy standalone HTML document. Prefer content blocks for new plans; use HTML only when importing an existing artifact.",
        ),
      content: planContentSchema
        .optional()
        .describe(
          "Structured editable plan content. Prefer this for rich text, inline diagrams, annotated code for key files, question-form open questions, and any optional top UI/product visual surface. For architecture-only, backend-only, refactor, API, data model, migration, and code plans, omit canvas/prototype; use inline diagram, mermaid, api-endpoint, openapi-spec, data-model, diff, file-tree, json-explorer, code, annotated-code, or compact custom-html blocks near the relevant prose. For a file map, use `code` blocks grouped in a vertical `tabs` block (one tab per key file) rather than a bespoke code-tabs container. Keep API endpoint and OpenAPI reference blocks in the normal single-column document flow; use columns for API material only when the work is explicitly a before/after contract comparison. For architecture/code diagrams, use diagram blocks with data.html/data.css so the diagram can be real semantic HTML and inline SVG: grouped regions, layers, swimlanes, dependency clusters, matrices, and side-by-side before/after or current/target panels. Use renderer-owned diagram classes such as .diagram-panel, .diagram-card, .diagram-node, .diagram-box, .diagram-pill, .diagram-muted, and data-rough plus --wf-* CSS tokens; the renderer maps them to Tailwind theme variables, Excalifont, and rough.js sketch outlines. Do not set fonts or hard-code hex/rgb/hsl colors in diagram HTML/CSS. Use legacy diagram nodes/edges only for tiny previews or true step-by-step flows. Use mermaid only when textual sequence/flowchart grammar is materially clearer. Use canvas only for static UI/product visuals; include both canvas and prototype for multi-step UI/product flows so the renderer shows Wireframes / Prototype tabs. Put any answerable unresolved decisions in a bottom question-form block with single/multi/freeform questions, recommended options, and optional wireframe/diagram previews. Canvas wireframes are HTML mockups: set data.html to a semantic fragment and pick a surface — the renderer owns theme, footprint/aspect, hand-drawn font, and sketch overlay; use --wf-* CSS tokens for any custom color, never hex. Prototype screens use semantic HTML with data-goto attributes for navigation. The renderer owns all visual styling; emit lean content, not pixels.",
        ),
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
    })
    .refine((args) => Boolean(args.brief || args.goal || args.planText), {
      message: "Either brief, goal, or planText is required.",
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
      height: 860,
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
        html: args.html ?? null,
        markdown: args.markdown ?? importedPlanText ?? null,
        content: content ? serializePlanContent(content) : null,
        createdAt: now,
        updatedAt: now,
        approvedAt: args.status === "approved" ? now : null,
        ownerEmail,
        orgId: ownerOrgId,
        visibility: "private",
      });

    await getDb()
      .insert(schema.planSections)
      .values(
        sections.map((section, index) => ({
          id: section.id ?? newId("sec"),
          planId: id,
          type: section.type,
          title: section.title,
          body: section.body,
          html: section.html ?? null,
          order: section.order ?? index,
          createdBy: section.createdBy,
          createdAt: now,
          updatedAt: now,
        })),
      );

    await insertInitialPlanComments({
      planId: id,
      comments: args.comments,
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
