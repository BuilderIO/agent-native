import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { duplicateDesignRecord } from "../server/lib/duplicate-design-record.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";
import { getStarterTemplate } from "../shared/starter-templates.js";

/** Editor deep link so external agents can surface "Open design". */
function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

export default defineAction({
  description:
    "Create a new empty design project shell. This is not a renderable " +
    "artifact by itself. For non-trivial new prompts, call " +
    "show-design-questions next and wait for the user's answers; only call " +
    "generate-design directly when the direction is already unambiguous.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe(
        "Optional pre-generated UI ID. Agents should omit this and use the ID returned by the successful action.",
      ),
    title: z.string().describe("Design project title"),
    description: z
      .string()
      .optional()
      .describe("Short description of the design project"),
    projectType: z
      .enum(["prototype", "other"])
      .optional()
      .default("prototype")
      .describe("Type of design project"),
    designSystemId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Design system ID to link, or null for no design system"),
    templateId: z
      .string()
      .optional()
      .describe(
        "Optional starter:* id or saved template design id to instantiate from.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design project",
      description: "Open the new design project in the real Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({
    id: providedId,
    title,
    description,
    projectType,
    designSystemId,
    templateId,
  }) => {
    const db = getDb();
    const id = providedId ?? nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();
    const starter = getStarterTemplate(templateId);
    const templateAccess =
      templateId && !starter
        ? await assertAccess("design", templateId, "viewer")
        : null;
    const templateSource = templateAccess?.resource ?? null;

    const defaultDesignSystemId = async () => {
      const [row] = await db
        .select({ id: schema.designSystems.id })
        .from(schema.designSystems)
        .where(
          and(
            accessFilter(schema.designSystems, schema.designSystemShares),
            eq(schema.designSystems.isDefault, true),
          ),
        )
        .orderBy(desc(schema.designSystems.updatedAt));
      return row?.id ?? null;
    };

    const templateDesignSystemId = templateSource?.designSystemId
      ? (await resolveAccess("design-system", templateSource.designSystemId))
        ? templateSource.designSystemId
        : null
      : null;
    const resolvedDesignSystemId =
      designSystemId !== undefined
        ? designSystemId || null
        : (templateDesignSystemId ?? (await defaultDesignSystemId()));
    const designSystemMismatch = Boolean(
      templateSource?.designSystemId &&
      resolvedDesignSystemId &&
      resolvedDesignSystemId !== templateSource.designSystemId,
    );
    const templateTitle = starter
      ? starter.titleKey
      : templateSource
        ? templateSource.title
        : null;

    if (resolvedDesignSystemId) {
      await assertAccess("design-system", resolvedDesignSystemId, "viewer");
    }

    const templateProvenance =
      templateId && templateTitle
        ? { templateId, templateTitle, appliedAt: now }
        : undefined;

    if (templateSource) {
      const result = await duplicateDesignRecord({
        db,
        source: templateSource,
        newId: id,
        title,
        description: description ?? null,
        projectType: projectType ?? "prototype",
        designSystemId: resolvedDesignSystemId,
        ownerEmail,
        orgId,
        visibility: orgId ? "org" : "private",
        isTemplate: false,
        templateMeta: null,
        dataPatch: templateProvenance ? { templateProvenance } : undefined,
        now,
      });

      return {
        id,
        title: result.title,
        projectType,
        renderable: result.fileCount > 0,
        templateApplied: {
          fileCount: result.fileCount,
          designSystemMismatch,
        },
      };
    }

    const seedScreens = starter?.seedScreens ?? [];
    const seedScreenRecords = seedScreens.map((screen) => ({
      id: nanoid(),
      screen,
    }));
    const data =
      seedScreens.length > 0 || templateProvenance
        ? JSON.stringify({
            ...(templateProvenance ? { templateProvenance } : {}),
            ...(seedScreens.length > 0
              ? {
                  canvasFrames: Object.fromEntries(
                    seedScreenRecords.map(({ id: fileId, screen }) => [
                      fileId,
                      screen.canvasFrame,
                    ]),
                  ),
                }
              : {}),
          })
        : "{}";

    const designValues: typeof schema.designs.$inferInsert = {
      id,
      title,
      description: description ?? null,
      projectType: projectType ?? "prototype",
      designSystemId: resolvedDesignSystemId,
      data,
      ownerEmail,
      orgId,
      visibility: orgId ? "org" : "private",
      isTemplate: false,
      templateMeta: null,
      createdAt: now,
      updatedAt: now,
    };
    const fileValues = seedScreenRecords.map(({ id: fileId, screen }) => ({
      id: fileId,
      designId: id,
      filename: screen.filename,
      content: annotateScreenHtmlForPersist(screen.html, "html"),
      fileType: "html",
      createdAt: now,
      updatedAt: now,
    }));

    if (fileValues.length > 0) {
      await db.transaction(async (tx) => {
        await tx.insert(schema.designs).values(designValues);
        await tx.insert(schema.designFiles).values(fileValues);
      });
    } else {
      await db.insert(schema.designs).values(designValues);
    }

    return {
      id,
      title,
      projectType,
      renderable: seedScreens.length > 0,
      ...(templateId
        ? {
            templateApplied: {
              fileCount: seedScreens.length,
              designSystemMismatch: false,
            },
          }
        : {}),
      nextRequiredAction:
        seedScreens.length > 0
          ? undefined
          : "show-design-questions for non-trivial new prompts, then generate-design or present-design-variants after the user answers",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { id?: string }).id;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});
