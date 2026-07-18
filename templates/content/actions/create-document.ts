import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess, type ShareRole } from "@agent-native/core/sharing";
import {
  recordGenerationCreativeContext,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { provisionContentSpaces } from "./_content-spaces.js";
import {
  appendContentWorkflowEvent,
  contentWorkflowFingerprint,
  wakeContentWorkflowEvent,
} from "./_content-workflow.js";
import { documentsPositionScope, withPositionLock } from "./_position-utils.js";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

const reuseLabelSchema = z
  .object({
    itemId: z.string().min(1).optional(),
    itemVersionId: z.string().min(1).optional(),
    kind: z.string().min(1),
    label: z.string().min(1),
    dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
    elementId: z.string().min(1).optional(),
    influence: z
      .enum(["reused", "adapted", "reference-conditioned", "generated"])
      .optional(),
  })
  .superRefine((label, context) => {
    const influence = label.influence ?? "reference-conditioned";
    if (Boolean(label.itemId) !== Boolean(label.itemVersionId)) {
      context.addIssue({
        code: "custom",
        message: "itemId and itemVersionId must be provided together",
      });
    }
    if (influence !== "generated" && !label.itemId) {
      context.addIssue({
        code: "custom",
        message: "Only generated labels may omit context item ids",
      });
    }
  });

export default defineAction({
  description: "Create a new document.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated document ID (for optimistic UI)"),
    spaceId: z
      .string()
      .optional()
      .describe("Content space for a new top-level document"),
    title: z.string().describe("Document title"),
    content: z.string().optional().describe("Markdown content"),
    description: z
      .string()
      .optional()
      .describe(
        "Stable guidance describing why this page exists and what belongs in it",
      ),
    parentId: z.string().nullish().describe("Parent document ID for nesting"),
    icon: z.string().optional().describe("Emoji icon"),
    contextPackId: z
      .string()
      .optional()
      .describe("Immutable pack returned by pre-generation context search"),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this document generation only without changing the saved preference.",
      ),
    reuseLabels: z
      .array(reuseLabelSchema)
      .optional()
      .default([])
      .describe("Exact context item versions used to draft this document"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Edit document",
      description:
        "Open the generated draft in the real Content editor so the user can revise, format, organize, and publish it.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async (args, ctx) => {
    const hasCreativeContextInput = Boolean(
      args.contextPackId ||
      args.contextModeOverride ||
      args.reuseLabels.length > 0,
    );
    const validatedCreativeContext = hasCreativeContextInput
      ? await validateGenerationCreativeContext({
          contextPackId: args.contextPackId,
          contextModeOverride: args.contextModeOverride,
          reuseLabels: args.reuseLabels,
        })
      : null;
    const creativeContextProvenance = validatedCreativeContext
      ? {
          contextMode: validatedCreativeContext.contextMode,
          contextPackId: validatedCreativeContext.contextPackId,
          reuseLabels: validatedCreativeContext.reuseLabels,
        }
      : null;
    const elementProvenanceFor = (documentId: string) =>
      creativeContextProvenance?.reuseLabels.length
        ? creativeContextProvenance.reuseLabels.map((label) => ({
            elementId: label.elementId ?? documentId,
            influence: label.influence ?? ("reference-conditioned" as const),
            ...(label.itemId ? { itemId: label.itemId } : {}),
            ...(label.itemVersionId
              ? { itemVersionId: label.itemVersionId }
              : {}),
            label: label.label,
          }))
        : [
            {
              elementId: documentId,
              influence: "generated" as const,
              label: "Net-new document",
            },
          ];
    const title = args.title;

    let content = args.content || "";
    const description = args.description?.trim() ?? "";
    // Strip leading H1 that duplicates the title
    if (title && content) {
      const h1Match = content.match(/^#\s+(.+?)(\r?\n|$)/);
      if (
        h1Match &&
        h1Match[1].trim().toLowerCase() === title.trim().toLowerCase()
      ) {
        content = content.slice(h1Match[0].length).trimStart();
      }
    }

    const parentId = args.parentId || null;
    const icon = args.icon || null;
    const currentUserEmail = getRequestUserEmail();
    if (!currentUserEmail) throw new Error("no authenticated user");
    let ownerEmail = currentUserEmail;
    let orgId = getRequestOrgId() ?? null;
    let visibility: "private" | "org" | "public" = "private";
    let hideFromSearch = 0;
    const db = getDb();
    let inheritedRole: "owner" | ShareRole = "owner";
    let inheritedShares: Array<{
      principalType: "user" | "org";
      principalId: string;
      role: ShareRole;
    }> = [];

    if (parentId) {
      const parentAccess = await assertAccess("document", parentId, "editor");
      const parent = parentAccess.resource;
      ownerEmail = parent.ownerEmail as string;
      orgId = (parent.orgId as string | null) ?? null;
      visibility = parent.visibility ?? "private";
      hideFromSearch = parent.hideFromSearch ?? 0;
      inheritedRole = parentAccess.role;
      inheritedShares = await db
        .select({
          principalType: schema.documentShares.principalType,
          principalId: schema.documentShares.principalId,
          role: schema.documentShares.role,
        })
        .from(schema.documentShares)
        .where(eq(schema.documentShares.resourceId, parentId));
    }

    let spaceId: string;
    if (parentId) {
      const [parent] = await db
        .select({ spaceId: schema.documents.spaceId })
        .from(schema.documents)
        .where(eq(schema.documents.id, parentId));
      if (!parent?.spaceId) {
        throw new Error(`Parent document "${parentId}" has no Content space`);
      }
      if (args.spaceId && args.spaceId !== parent.spaceId) {
        throw new Error("Nested documents must use their parent Content space");
      }
      spaceId = parent.spaceId;
    } else {
      const provisioned = await provisionContentSpaces(db, currentUserEmail);
      spaceId = args.spaceId ?? provisioned.personalSpaceId;
      const spaceAccess = await resolveContentSpaceAccess(spaceId, "editor");
      ownerEmail = currentUserEmail;
      orgId = spaceAccess.space.orgId;
      visibility = orgId ? "org" : "private";
    }

    const now = new Date().toISOString();
    const id = args.id || nanoid();
    let workflowEventId = "";

    await withPositionLock(
      documentsPositionScope(ownerEmail, parentId),
      async () => {
        // Get max position among siblings
        const maxPos = await db
          .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
          .from(schema.documents)
          .where(
            parentId
              ? and(
                  eq(schema.documents.ownerEmail, ownerEmail),
                  eq(schema.documents.parentId, parentId),
                )
              : and(
                  eq(schema.documents.ownerEmail, ownerEmail),
                  sql`parent_id IS NULL`,
                ),
          );

        const position = (maxPos[0]?.max ?? -1) + 1;

        await db.transaction(async (tx) => {
          await tx.insert(schema.documents).values({
            id,
            spaceId,
            ownerEmail,
            orgId,
            parentId,
            title,
            content,
            description,
            icon,
            position,
            isFavorite: 0,
            hideFromSearch,
            visibility,
            createdAt: now,
            updatedAt: now,
          });

          if (inheritedShares.length > 0) {
            await tx.insert(schema.documentShares).values(
              inheritedShares.map((share) => ({
                id: nanoid(),
                resourceId: id,
                principalType: share.principalType,
                principalId: share.principalId,
                role: share.role,
                createdBy: currentUserEmail,
                createdAt: now,
              })),
            );
          }
          await ensureDocumentFilesMembership(tx, id, now, {
            userEmail: currentUserEmail,
            orgId: orgId ?? undefined,
          });
          workflowEventId = await appendContentWorkflowEvent(tx, {
            topic: "content.document.created",
            subjectType: "document",
            subjectId: id,
            documentId: id,
            ownerEmail,
            orgId,
            occurredAt: now,
            actionContext: ctx,
            payload: {
              parentId,
              spaceId,
              changedFields: ["title", "content", "description", "icon"],
              contentHash: contentWorkflowFingerprint(content),
            },
          });
        });
      },
    );
    wakeContentWorkflowEvent(workflowEventId);

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, id),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      );

    await writeAppState("refresh-signal", { ts: Date.now() });
    if (creativeContextProvenance) {
      await recordGenerationCreativeContext({
        appId: "content",
        artifactType: "document",
        artifactId: doc.id,
        ...creativeContextProvenance,
        elementProvenance: elementProvenanceFor(doc.id),
      });
    }

    return {
      id: doc.id,
      urlPath: `/page/${doc.id}`,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      description: doc.description,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      accessRole: inheritedRole,
      canEdit: true,
      canManage: inheritedRole === "owner" || inheritedRole === "admin",
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      ...(creativeContextProvenance ?? {}),
    };
  },
  link: ({ result }) => {
    const id = (result as { id?: string } | null)?.id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
