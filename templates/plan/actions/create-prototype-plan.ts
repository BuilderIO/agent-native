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
  createPrototypePlanContent,
  normalizePlanContent,
  serializePlanContent,
} from "../server/plan-content.js";
import {
  buildPlanHtml,
  commentInputSchema,
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
import { planContentSchema } from "../shared/plan-content.js";

const prototypeSurfaceSchema = z.enum([
  "desktop",
  "mobile",
  "popover",
  "panel",
  "browser",
]);

const prototypeScreenSchema = z.object({
  id: z.string().optional().describe("Stable screen id"),
  title: z.string().min(1).describe("Prototype screen title"),
  summary: z
    .string()
    .optional()
    .describe("What the reviewer should inspect on this screen"),
  surface: prototypeSurfaceSchema.optional().default("browser"),
  html: z
    .string()
    .optional()
    .describe(
      'Bounded semantic HTML fragment for a real interactive prototype. Use safe Alpine-like directives (x-data, x-model, x-for, x-text, x-show, :class, @click, @keydown.enter) for local behavior; use data-goto="screen-id" only for true screen/route changes. Never include html/body/script/style tags.',
    ),
  state: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1),
        value: z.string(),
      }),
    )
    .optional()
    .describe(
      "Optional export metadata for this screen. Prefer showing live state inside the prototype HTML itself.",
    ),
});

const prototypeTransitionSchema = z.object({
  id: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  trigger: z.string().optional(),
});

export default defineAction({
  description:
    "Create a plan whose primary review surface is a running interactive prototype. For a document-first plan use create-visual-plan; for a UI-first wireframe canvas use create-ui-plan; for a recap of an existing diff use create-visual-recap; for full-fidelity branded design use create-plan-design. Prototype screen HTML uses safe Alpine-like directives for local state and data-goto for screen navigation only. Publish via this tool; never deliver the plan as inline chat text.",
  schema: z
    .object({
      title: z.string().optional().describe("Short visual plan title"),
      brief: z
        .string()
        .optional()
        .describe(
          "The question the prototype answers, in one short line. Shown as the lede under the title — keep it tight, not a paragraph.",
        ),
      goal: z.string().optional().describe("Alias for brief."),
      source: planSourceSchema.optional().default("manual"),
      repoPath: z.string().optional().describe("Repository path for the run"),
      currentFocus: z
        .string()
        .optional()
        .describe("Current prototype review focus"),
      status: planStatusSchema.optional().default("review"),
      content: planContentSchema
        .optional()
        .describe(
          "Full structured content when the caller has already authored a prototype. Prefer screens/transitions unless replacing the whole document.",
        ),
      screens: z
        .array(prototypeScreenSchema)
        .optional()
        .default([])
        .describe(
          "Prototype screens. Default to one functional screen when local UI behavior is enough; use 2-4 screens only for true routes/steps. Screen HTML should include working local controls, inputs, toggles, lists, filters, or lightweight flows where relevant.",
        ),
      transitions: z
        .array(prototypeTransitionSchema)
        .optional()
        .default([])
        .describe(
          "Expected screen/route transitions. The viewer also honors data-goto attributes in screen HTML, but ordinary UI state should stay inside the functional prototype.",
        ),
      implementationNotes: z
        .string()
        .optional()
        .describe("Concise notes for the implementation map section"),
      markdown: z
        .string()
        .optional()
        .describe("Markdown/text fallback or source visual plan"),
      sections: z
        .array(sectionInputSchema)
        .optional()
        .default([])
        .describe("Optional legacy plan sections"),
      comments: z
        .array(commentInputSchema)
        .optional()
        .default([])
        .describe("Initial annotations or review prompts"),
    })
    .refine((args) => Boolean(args.brief || args.goal), {
      message: "Either brief or goal is required.",
    }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Prototype Plan",
    description:
      "Create a plan whose primary review surface is a functional prototype.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Visual Plan",
      description:
        "Open the Agent-Native Plan prototype review surface for functional states, comments, static mocks, and implementation notes.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Visual Plan",
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

    const id = newId("plan");
    const now = nowIso();
    const brief = args.brief || args.goal || "";
    const title = args.title || "Untitled visual plan";
    const sections =
      args.sections.length > 0
        ? args.sections
        : [
            {
              type: "summary" as const,
              title: "Prototype question",
              body: brief,
              order: 0,
              createdBy: "agent" as const,
            },
            {
              type: "prototype" as const,
              title: "Clickable prototype",
              body: "The live prototype viewer sits above the document. It is declarative, commentable, and safe: local controls use the built-in prototype directives, and true screen transitions use data-goto attributes instead of scripts.",
              order: 1,
              createdBy: "agent" as const,
            },
            {
              type: "implementation" as const,
              title: "Implementation map",
              body:
                args.implementationNotes ||
                "Add file references, symbols, and short code previews once the prototype direction is approved.",
              order: 2,
              createdBy: "agent" as const,
            },
          ];
    const content = (() => {
      try {
        return args.content
          ? normalizePlanContent(args.content)
          : createPrototypePlanContent({
              title,
              brief,
              source: args.source,
              repoPath: args.repoPath,
              screens: args.screens,
              transitions: args.transitions,
              implementationNotes: args.implementationNotes,
            });
      } catch (error) {
        // Malformed prototype input (e.g. a transition whose target screen id
        // doesn't exist) surfaces as a ZodError here — return a 4xx client error
        // instead of an opaque 500.
        throw Object.assign(
          new Error(
            `Invalid prototype content (check that every transition targets an existing screen id): ${(error as Error)?.message ?? "validation failed"}`,
          ),
          { statusCode: 400 },
        );
      }
    })();

    await getDb()
      .insert(schema.plans)
      .values({
        id,
        title,
        brief,
        status: args.status,
        source: args.source,
        repoPath: args.repoPath ?? null,
        currentFocus: args.currentFocus ?? "prototype review",
        html: null,
        markdown: args.markdown ?? null,
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
      type: "plan.prototype_created",
      message: "Prototype-first visual plan created.",
      payload: {
        screenCount: content?.prototype?.screens.length ?? 0,
        transitionCount: content?.prototype?.transitions?.length ?? 0,
      },
      createdBy: "agent",
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
        "Open the Agent-Native Visual Plan link, click through the prototype states, add comments directly on the live prototype or static mocks, then I will call get-plan-feedback before continuing. Use the prototype popout for a focused browser review.",
    };
  },
  link: ({ result }) => {
    const plan = (result as { plan?: { id?: string } } | null)?.plan;
    if (!plan?.id) return null;
    return {
      url: planDeepLink(plan.id),
      label: "Open Visual Plan",
      view: "plan",
    };
  },
});
