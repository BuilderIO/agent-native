import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  createPlanContentFromSections,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  buildPlanHtml,
  deriveSectionsFromText,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planPath,
  planSourceSchema,
  writeEvent,
} from "../server/plans.js";

function inferTitle(planText: string): string {
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
    "Convert an existing Codex, Claude Code, Markdown, or pasted text plan into an Agent-Native visual plan with editable rich blocks, sketch diagrams/wireframes, implementation maps, code previews, and annotation space.",
  schema: z.object({
    title: z.string().optional().describe("Short title for the visual plan"),
    brief: z
      .string()
      .optional()
      .describe("Brief of the existing plan; defaults to the imported text"),
    goal: z.string().optional().describe("Compatibility alias for brief"),
    planText: z
      .string()
      .min(1)
      .describe("Existing Codex, Claude Code, Markdown, or pasted plan text"),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the run"),
    currentFocus: z.string().optional().default("visual review"),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Visualize Plan",
    description:
      "Import a text plan and open a richer HTML companion for visuals and feedback.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Plan",
      description:
        "Open the Agent-Native Plans HTML companion for an imported Codex or Claude Code plan.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Visualizing a plan requires an authenticated user.");
    }
    const id = newId("plan");
    const now = nowIso();
    const title = args.title || inferTitle(args.planText);
    const brief =
      args.brief ||
      args.goal ||
      `Visual companion for an imported coding-agent plan.`;
    const sections = deriveSectionsFromText(args.planText);
    const content = createPlanContentFromSections({
      title,
      brief,
      sections: sections.map((section, index) => ({
        id: `section-${index + 1}`,
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
        status: "review",
        source: args.source,
        repoPath: args.repoPath ?? null,
        currentFocus: args.currentFocus ?? "visual review",
        html: null,
        markdown: args.planText,
        content: serializePlanContent(content),
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
        ownerEmail,
        orgId: getRequestOrgId(),
        visibility: "private",
      });

    await getDb()
      .insert(schema.planSections)
      .values(
        sections.map((section) => ({
          id: newId("sec"),
          planId: id,
          type: section.type,
          title: section.title,
          body: section.body,
          html: section.html ?? null,
          order: section.order,
          createdBy: section.createdBy,
          createdAt: now,
          updatedAt: now,
        })),
      );

    await writeEvent({
      planId: id,
      type: "plan.imported",
      message: "Imported text plan for visual review.",
      payload: {
        source: args.source,
        textLength: args.planText.length,
      },
      createdBy: "import",
    });

    const bundle = await loadPlanBundle(id);
    return {
      ...bundle,
      planId: id,
      html: buildPlanHtml(bundle),
      path: planPath(id),
      url: planPath(id),
      fallbackInstructions:
        "Open the Agent-Native Plans companion, react to the editable visual sections, add comments or corrections, then I will call get-plan-feedback before continuing. The live link is private until shared; use the Share panel for reviewer access or export-visual-plan for an HTML/Markdown/JSON receipt to check into source.",
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
