import { defineAction, embedApp, fail } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { loadAgentDesignSystemContext } from "@agent-native/core/shared";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  extractTemplateFonts,
  redactTemplateDesignData,
  remapTemplateFileIds,
  templateFileDimensions,
} from "../server/lib/design-template-data.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import { BOARD_FILENAME } from "../shared/board-file.js";
import { getDesignTemplatePreset } from "../shared/design-template-presets.js";
import { designTemplateRetryKey } from "../shared/design-template-retry.js";
import { countLockedLayersAcrossFiles } from "../shared/locked-layers.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import getDesignSystem from "./get-design-system.js";

type DesignTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

interface TemplateFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
}

function templateCopyConflict(): never {
  return fail(
    "This copy request cannot be reused. Start a new copy with a new ID.",
    {
      statusCode: 409,
      errorCode: "design_template_copy_conflict",
    },
  );
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function readRetryDesign(
  id: string,
  ownerEmail: string,
  orgId: string | null,
  templateId: string,
  createdTitle: string,
  retryKey: string,
) {
  const access = await resolveAccess("design", id);
  if (!access) return null;
  const design = access.resource as typeof schema.designs.$inferSelect;
  if (
    design.ownerEmail?.toLowerCase() !== ownerEmail.toLowerCase() ||
    design.orgId !== orgId
  ) {
    return templateCopyConflict();
  }

  let data: unknown;
  try {
    data = JSON.parse(design.data);
  } catch {
    // coercion-ok: unreadable retry state cannot prove this is the same copy.
    return templateCopyConflict();
  }
  const dataRecord =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const templateSource = dataRecord?.templateSource;
  if (
    !dataRecord ||
    !templateSource ||
    typeof templateSource !== "object" ||
    Array.isArray(templateSource) ||
    (templateSource as { templateId?: unknown }).templateId !== templateId ||
    design.title !== createdTitle ||
    (templateSource as { retryKey?: unknown }).retryKey !== retryKey
  ) {
    return templateCopyConflict();
  }

  const files = await getDb()
    .select({ id: schema.designFiles.id, content: schema.designFiles.content })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, id));
  const source = templateSource as {
    designSystemOverridden?: unknown;
    retryKey?: unknown;
  };
  const designSystemId = design.designSystemId ?? null;
  return {
    id,
    title: design.title,
    templateId,
    designSystemId,
    designSystem: await loadAgentDesignSystemContext(
      designSystemId,
      getDesignSystem,
      { full: true },
    ),
    designSystemOverridden: source.designSystemOverridden === true,
    fileCount: files.length,
    lockedLayerCount: countLockedLayersAcrossFiles(files),
    templateBaselineFiles: files.map((file) => ({
      id: file.id,
      contentHash: sourceContentHash(file.content),
    })),
    promptPending: "templatePrompt" in dataRecord,
    adaptationPending: "templatePrompt" in dataRecord,
    nextRequiredAction:
      "templatePrompt" in dataRecord
        ? "Call get-design-snapshot, then refine unlocked content with edit-design. Do not call generate-design."
        : null,
    reused: true,
  };
}

export default defineAction({
  description:
    "Create an editable design from a reusable template. The action copies the template files, exact dimensions, defaults, and locked layers. " +
    "When a prompt is supplied, refine the copied files with get-design-snapshot and edit-design; do not replace the template with generate-design. " +
    "Returns linked `designSystem.agentContext` when readable; apply it to refinements.",
  schema: z.object({
    templateId: z.string().min(1).describe("Saved or built-in template ID"),
    title: z.string().trim().min(1).max(120).optional(),
    prompt: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .describe("Optional refinement request to apply after copying"),
    designSystemId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("Override the template design system, or null to unlink"),
    targetDesignId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Fill this existing design instead of creating a new one. It must have no files — a design with content is never overwritten.",
      ),
    newId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
      .describe(
        "Stable ID for an identical retry; omit to create a new independent copy",
      ),
    retryKey: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe("Request fingerprint used to distinguish changed retries"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design from template",
      description: "Open the copied template in the Design editor.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design",
      height: 680,
    }),
  },
  run: async ({
    templateId,
    title,
    prompt,
    designSystemId,
    targetDesignId,
    newId,
    retryKey,
  }) => {
    const preset = getDesignTemplatePreset(templateId);
    const db = getDb();

    let templateTitle: string;
    let templateDescription: string | null;
    let templateCategory: string;
    let templateData: string;
    let templateDesignSystemId: string | null;
    let templateUpdatedAt: string | null;
    let files: TemplateFile[];

    if (preset) {
      const presetFileId = `file:${preset.id}`;
      templateTitle = preset.title;
      templateDescription = preset.description;
      templateCategory = preset.category;
      templateDesignSystemId = null;
      templateUpdatedAt = null;
      templateData = JSON.stringify({
        canvasFrames: {
          [presetFileId]: {
            x: 0,
            y: 0,
            width: preset.width,
            height: preset.height,
          },
        },
      });
      files = [
        {
          id: presetFileId,
          filename: preset.filename,
          fileType: "html",
          content: preset.content,
        },
      ];
    } else {
      const access = await resolveAccess("design-template", templateId);
      if (!access) throw new Error("Template not found");
      const template = access.resource;
      templateTitle = String(template.title ?? "Untitled template");
      templateDescription =
        typeof template.description === "string" ? template.description : null;
      templateCategory = String(template.category ?? "other");
      templateData = typeof template.data === "string" ? template.data : "{}";
      templateDesignSystemId =
        typeof template.designSystemId === "string"
          ? template.designSystemId
          : null;
      templateUpdatedAt =
        typeof template.updatedAt === "string" ? template.updatedAt : null;
      files = await db
        .select({
          id: schema.designTemplateFiles.id,
          filename: schema.designTemplateFiles.filename,
          fileType: schema.designTemplateFiles.fileType,
          content: schema.designTemplateFiles.content,
        })
        .from(schema.designTemplateFiles)
        .where(eq(schema.designTemplateFiles.templateId, templateId));
    }

    if (files.length === 0) throw new Error("Template has no files");

    let linkedDesignSystemId =
      designSystemId === undefined ? templateDesignSystemId : designSystemId;
    if (linkedDesignSystemId) {
      const designSystemAccess = await resolveAccess(
        "design-system",
        linkedDesignSystemId,
      );
      if (!designSystemAccess) {
        if (designSystemId !== undefined) {
          throw new Error("Design system not found");
        }
        linkedDesignSystemId = null;
      }
    }
    const designSystemOverridden =
      designSystemId !== undefined && designSystemId !== templateDesignSystemId;
    const adaptationPending = Boolean(prompt);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Not authenticated");
    const orgId = getRequestOrgId() ?? null;
    const createdTitle = title ?? templateTitle;
    const designId = targetDesignId ?? newId ?? nanoid();
    const expectedRetryKey = designTemplateRetryKey({
      templateId,
      title: createdTitle,
      designSystemId,
      prompt,
    });
    if (newId && !retryKey) {
      throw new Error("retryKey is required when newId is provided");
    }
    if (newId && retryKey !== expectedRetryKey) {
      return templateCopyConflict();
    }
    if (newId && !targetDesignId) {
      const existing = await readRetryDesign(
        designId,
        ownerEmail,
        orgId,
        templateId,
        createdTitle,
        retryKey,
      );
      if (existing) return existing;
    }
    // Filling the design the New Design button already created, rather than
    // stranding it and navigating to a second one. Guarded twice: the caller
    // must be able to edit it, and it must still be empty, so a template can
    // never land on top of existing screens.
    let targetExistingData: Record<string, unknown> = {};
    if (targetDesignId) {
      await assertAccess("design", targetDesignId, "editor");
    }
    const now = new Date().toISOString();
    const fileIdMap = new Map(files.map((file) => [file.id, nanoid()]));
    const data = remapTemplateFileIds(
      redactTemplateDesignData(templateData),
      fileIdMap,
    );
    // The copied screens are edited in place, so the design's own files stop
    // being evidence of what the template looked like after the first
    // refinement. Capturing the small facts here — which template file backs
    // each screen, its exact frame, and the declared fonts — is what lets
    // every later turn restate them without re-reading the template.
    data.templateSource = {
      templateId,
      title: templateTitle,
      category: templateCategory,
      templateUpdatedAt,
      instantiatedAt: now,
      templateDesignSystemId,
      appliedDesignSystemId: linkedDesignSystemId,
      designSystemOverridden,
      ...(retryKey !== undefined ? { retryKey } : {}),
      files: files.map((file) => {
        const designFileId = fileIdMap.get(file.id)!;
        const { width, height } = templateFileDimensions(data, designFileId);
        return {
          designFileId,
          templateFileId: file.id,
          filename: file.filename,
          width,
          height,
        };
      }),
      fonts: extractTemplateFonts(files.map((file) => file.content).join("\n")),
    };
    if (prompt) data.templatePrompt = prompt;

    const persistedFiles = files.map((file) => ({
      ...file,
      id: fileIdMap.get(file.id)!,
      content: annotateScreenHtmlForPersist(file.content, file.fileType),
    }));

    const persist = async (tx: DesignTransaction) => {
      if (targetDesignId) {
        // The editor creates the board row on mount, so a design with nothing
        // drawn in it already has one file. Screens are what count as content.
        const [existingDesign] = await tx
          .select({ data: schema.designs.data })
          .from(schema.designs)
          .where(eq(schema.designs.id, targetDesignId))
          .limit(1);
        if (typeof existingDesign?.data === "string") {
          try {
            const parsed = JSON.parse(existingDesign.data);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              targetExistingData = parsed as Record<string, unknown>;
            }
          } catch {
            // coercion-ok: unreadable prior data is replaced wholesale below,
            // which is the same outcome as the create path.
          }
        }
        const [existing] = await tx
          .select({ id: schema.designFiles.id })
          .from(schema.designFiles)
          .where(
            and(
              eq(schema.designFiles.designId, targetDesignId),
              ne(schema.designFiles.filename, BOARD_FILENAME),
            ),
          )
          .limit(1);
        if (existing) {
          throw new Error(
            "Target design already has files. Templates only fill an empty design.",
          );
        }
        await tx
          .update(schema.designs)
          .set({
            title: title ?? templateTitle,
            description: templateDescription,
            // Merge, never replace: the row already carries editor state the
            // template knows nothing about — `boardFileId` above all, whose
            // loss makes the editor mint a second board on next open.
            data: JSON.stringify({ ...targetExistingData, ...data }),
            designSystemId: linkedDesignSystemId,
            updatedAt: now,
          })
          .where(eq(schema.designs.id, targetDesignId));
      } else {
        await tx.insert(schema.designs).values({
          id: designId,
          title: title ?? templateTitle,
          description: templateDescription,
          data: JSON.stringify(data),
          projectType: "prototype",
          designSystemId: linkedDesignSystemId,
          ownerEmail,
          orgId,
          visibility: orgId ? "org" : "private",
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx.insert(schema.designFiles).values(
        persistedFiles.map((file) => ({
          id: file.id,
          designId,
          filename: file.filename,
          fileType: file.fileType,
          content: file.content,
          createdAt: now,
          updatedAt: now,
        })),
      );
    };

    if (targetDesignId) {
      await withDesignSourceMutationTransaction(targetDesignId, persist);
    } else {
      try {
        await db.transaction(persist);
      } catch (error) {
        if (!newId || !isUniqueViolation(error)) throw error;
        const existing = await readRetryDesign(
          designId,
          ownerEmail,
          orgId,
          templateId,
          createdTitle,
          retryKey,
        );
        if (existing) return existing;
        return templateCopyConflict();
      }
    }

    return {
      id: designId,
      title: createdTitle,
      templateId,
      templateTitle,
      designSystemId: linkedDesignSystemId,
      designSystem: await loadAgentDesignSystemContext(
        linkedDesignSystemId,
        getDesignSystem,
        { full: true },
      ),
      designSystemOverridden,
      fileCount: files.length,
      lockedLayerCount: countLockedLayersAcrossFiles(persistedFiles),
      templateBaselineFiles: persistedFiles.map((file) => ({
        id: file.id,
        contentHash: sourceContentHash(file.content),
      })),
      promptPending: Boolean(prompt),
      adaptationPending,
      nextRequiredAction: adaptationPending
        ? "Call get-design-snapshot, then refine unlocked content with edit-design. Do not call generate-design."
        : null,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const id = (result as { id?: string }).id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "design",
        view: "editor",
        params: { designId: id },
        to: `/design/${encodeURIComponent(id)}`,
      }),
      label: "Open design",
      view: "editor",
    };
  },
});
