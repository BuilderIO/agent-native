import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
  planMdxFileSchema,
} from "../server/plan-mdx.js";
import { serializePlanContent } from "../server/plan-content.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planPath,
  planSourceSchema,
  planStatusSchema,
  writeEvent,
} from "../server/plans.js";

export default defineAction({
  description:
    "Create or replace an Agent-Native Plan from source-control friendly MDX files. The MDX folder is the authoring/export surface; the runtime model remains normalized structured JSON.",
  schema: z.object({
    planId: z
      .string()
      .optional()
      .describe("Existing plan ID to replace. Omit to create a new plan."),
    title: z.string().optional().describe("Plan title override."),
    brief: z.string().optional().describe("Plan brief override."),
    source: planSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the plan."),
    currentFocus: z
      .string()
      .optional()
      .describe("Current plan focus for the review surface."),
    status: planStatusSchema.optional().default("review"),
    mdx: planMdxFileSchema.describe(
      "Plan source files. plan.mdx holds frontmatter plus markdown/document blocks; canvas.mdx holds optional DesignBoard/Section/Artboard/Screen/Annotation/Connector components.",
    ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Import Visual Plan Source",
    description:
      "Create or replace a visual plan from MDX source files while preserving the normalized runtime model.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan",
      description: "Open an imported Agent-Native Plans review surface.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    const content = await parsePlanMdxFolder(args.mdx);
    const title = args.title ?? content.title ?? "Imported visual plan";
    const brief = args.brief ?? content.brief ?? "Imported from MDX source.";
    const now = nowIso();
    const db = getDb();

    if (args.planId) {
      await assertPlanEditor(args.planId);
      await db
        .update(schema.plans)
        .set({
          title,
          brief,
          source: args.source,
          repoPath: args.repoPath ?? null,
          currentFocus: args.currentFocus ?? "source review",
          status: args.status,
          markdown: args.mdx["plan.mdx"],
          content: serializePlanContent(content),
          updatedAt: now,
          approvedAt: args.status === "approved" ? now : null,
        })
        .where(eq(schema.plans.id, args.planId));

      await writeEvent({
        planId: args.planId,
        type: "plan.source.imported",
        message: "Visual plan MDX source imported.",
        createdBy: "agent",
      });

      const bundle = await loadPlanBundle(args.planId);
      return {
        ...bundle,
        planId: bundle.plan.id,
        html: buildPlanHtml(bundle),
        mdx: await exportPlanContentToMdxFolder({
          content: bundle.plan.content,
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          planId: bundle.plan.id,
          url: planPath(bundle.plan.id),
        }),
        path: planPath(bundle.plan.id),
        url: planPath(bundle.plan.id),
      };
    }

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error(
        "Importing a visual plan requires an authenticated user.",
      );
    }

    const id = newId("plan");
    await db.insert(schema.plans).values({
      id,
      title,
      brief,
      status: args.status,
      source: args.source,
      repoPath: args.repoPath ?? null,
      currentFocus: args.currentFocus ?? "source review",
      html: null,
      markdown: args.mdx["plan.mdx"],
      content: serializePlanContent(content),
      createdAt: now,
      updatedAt: now,
      approvedAt: args.status === "approved" ? now : null,
      ownerEmail,
      orgId: getRequestOrgId(),
      visibility: "private",
    });

    await writeEvent({
      planId: id,
      type: "plan.source.imported",
      message: "Visual plan MDX source imported.",
      createdBy: "agent",
    });

    const bundle = await loadPlanBundle(id);
    return {
      ...bundle,
      planId: id,
      html: buildPlanHtml(bundle),
      mdx: await exportPlanContentToMdxFolder({
        content: bundle.plan.content,
        title: bundle.plan.title,
        brief: bundle.plan.brief,
        planId: bundle.plan.id,
        url: planPath(bundle.plan.id),
      }),
      path: planPath(id),
      url: planPath(id),
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
