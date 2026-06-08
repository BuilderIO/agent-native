import { defineAction, embedApp } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  createPrototypeFromPlanContent,
  serializePlanContent,
} from "../server/plan-content.js";
import { isLocalPlanRuntime } from "../server/lib/local-identity.js";
import { writePlanLocalFiles } from "../server/lib/local-plan-files.js";
import { createPlanVersionSnapshot } from "../server/lib/plan-versions.js";
import {
  assertPlanEditor,
  buildPlanHtml,
  loadPlanBundle,
  newId,
  nowIso,
  planDeepLink,
  planPath,
} from "../server/plans.js";

export default defineAction({
  description:
    "Convert an existing Agent-Native visual plan into a prototype plan by deriving a clickable prototype from the plan's HTML canvas wireframes. The prototype viewer appears above the document while the original canvas/static mocks remain available for reference unless removeCanvas is true.",
  schema: z.object({
    planId: z.string().describe("Visual plan ID to convert"),
    title: z
      .string()
      .optional()
      .describe("Optional prototype title; defaults to the plan/canvas title"),
    brief: z
      .string()
      .optional()
      .describe("Optional prototype brief; defaults to the plan brief"),
    removeCanvas: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Remove the old canvas after deriving the prototype. Defaults to false so static mocks stay available.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Convert To Prototype Plan",
    description:
      "Turn an existing visual plan's canvas mockups into a clickable prototype review surface.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Prototype Plan",
      description:
        "Open the converted Agent-Native Plan prototype review surface.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Prototype Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    await assertPlanEditor(args.planId);
    const bundle = await loadPlanBundle(args.planId);
    if (!bundle.plan.content) {
      throw Object.assign(
        new Error(
          "Only structured visual plans can be converted to prototype plans.",
        ),
        { statusCode: 400 },
      );
    }
    const prototype = createPrototypeFromPlanContent(bundle.plan.content, {
      title: args.title,
      brief: args.brief,
    });
    if (!prototype) {
      throw Object.assign(
        new Error(
          "No HTML canvas wireframes were found to convert. Add HTML wireframe frames first, or create a prototype plan directly with create-prototype-plan.",
        ),
        { statusCode: 400 },
      );
    }
    const now = nowIso();
    const content = {
      ...bundle.plan.content,
      prototype,
      ...(args.removeCanvas ? {} : { canvas: bundle.plan.content.canvas }),
    };
    if (args.removeCanvas) delete content.canvas;
    await createPlanVersionSnapshot(args.planId, {
      force: true,
      label: "Before prototype conversion",
      createdBy: "agent",
    });

    // guard:allow-unscoped -- assertPlanEditor(args.planId) above gates this write.
    await getDb()
      .update(schema.plans)
      .set({
        title: args.title ?? bundle.plan.title,
        brief: args.brief ?? bundle.plan.brief,
        currentFocus: "prototype review",
        content: serializePlanContent(content),
        markdown: bundle.plan.markdown,
        updatedAt: now,
      })
      .where(eq(schema.plans.id, args.planId));

    await getDb()
      .insert(schema.planEvents)
      .values({
        id: newId("evt"),
        planId: args.planId,
        type: "plan.prototype_converted",
        message: "Visual plan converted to a prototype plan.",
        payload: JSON.stringify({
          screenCount: prototype.screens.length,
          transitionCount: prototype.transitions?.length ?? 0,
          removeCanvas: args.removeCanvas,
        }),
        createdBy: "agent",
        createdAt: now,
      });

    const nextBundle = await loadPlanBundle(args.planId);
    const local = isLocalPlanRuntime()
      ? await writePlanLocalFiles({
          planId: nextBundle.plan.id,
          title: nextBundle.plan.title,
          brief: nextBundle.plan.brief,
          content: nextBundle.plan.content,
          url: planPath(nextBundle.plan.id),
        })
      : null;
    return {
      ...nextBundle,
      planId: nextBundle.plan.id,
      html: buildPlanHtml(nextBundle),
      path: planPath(nextBundle.plan.id),
      url: planPath(nextBundle.plan.id),
      ...(local?.written ? { localFiles: local } : {}),
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Prototype Plan",
      view: "plan",
    };
  },
});
