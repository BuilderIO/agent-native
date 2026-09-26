import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { agentTouchDocument } from "@agent-native/core/collab";
import {
  iconValueSchema,
  parseIconValue,
  serializeIconValue,
  type IconValue,
} from "@agent-native/core/icons";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";
import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance,
  validateGenerationCreativeContext,
} from "@agent-native/creative-context/server";
import type { CreativeContextReuseLabel } from "@agent-native/creative-context/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { commitCanonicalDocumentBodyMutation } from "../server/lib/canonical-document-body-mutation.js";
import {
  documentEditAttribution,
  requireDocumentRequestActor,
} from "../server/lib/document-attribution.js";
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import { propagateDocumentTitle } from "../server/lib/document-title-propagation.js";
import { nextDocumentUpdatedAt } from "../server/lib/document-updated-at.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type { DocumentUpdateResponse } from "../shared/api.js";
import { applyContentPersonalNavigationPatch } from "../shared/content-personal-navigation-patch.js";
import { inspectNfmFidelity } from "../shared/nfm.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import { BUILDER_CMS_BODY_CONTENT_KEY } from "./_builder-cms-source-adapter.js";
import { reconcileInlineDatabasesForDocument } from "./_content-database-lifecycle.js";
import {
  migratePersonalDatabaseViewOverrides,
  personalDatabaseViewSettingKey,
} from "./_content-database-personal-view.js";
import {
  favoriteDocumentIds,
  favoritesSystemIds,
  setFavoriteMembership,
} from "./_content-favorites.js";
import { provisionContentSpaces } from "./_content-spaces.js";
import {
  documentContentHash,
  documentRevisionToken,
  parseDocumentRevisionToken,
} from "./_document-edit-mutation.js";
import {
  assertDocumentMutationAccess,
  resolveDocumentAccessForMutation,
} from "./_document-mutation-access.js";
import { serializeDocumentSource } from "./_document-source.js";
import { settlePreviewDocumentDraft } from "./_preview-document-draft-settlement.js";
import { mutateContentUserSettingTransaction } from "./_user-setting-transaction.js";

export interface DocumentUpdateConflictResponse {
  conflict: true;
  id: string;
  document: DocumentUpdateResponse;
}

const documentAuditOwner = Symbol("documentAuditOwner");

type DocumentAuditScopedResult = {
  [documentAuditOwner]?: string;
};

function scopeDocumentAudit<T extends object>(result: T, ownerEmail: string) {
  Object.defineProperty(result, documentAuditOwner, { value: ownerEmail });
  return result;
}

function isFavoriteOnlyUpdate(args: {
  isFavorite?: boolean;
  title?: string;
  content?: string;
  description?: string;
  icon?: IconValue | string | null;
}) {
  return (
    args.isFavorite !== undefined &&
    args.title === undefined &&
    args.content === undefined &&
    args.description === undefined &&
    args.icon === undefined
  );
}

const reuseLabelSchema = z.object({
  itemId: z.string().min(1).optional(),
  itemVersionId: z.string().min(1).optional(),
  kind: z.string().min(1),
  label: z.string().min(1),
  dataRole: z.literal("untrusted-reference").default("untrusted-reference"),
  elementId: z.string().min(1).optional(),
  influence: z
    .enum(["reused", "adapted", "reference-conditioned", "generated"])
    .optional(),
});

async function documentMutationCreativeContext(input: {
  documentId: string;
  contextPackId?: string;
  contextModeOverride?: "off";
  reuseLabels: CreativeContextReuseLabel[];
  artifactAccessAsserted: boolean;
  skipPreviousRead?: boolean;
}) {
  const previous =
    input.skipPreviousRead || input.contextModeOverride === "off"
      ? null
      : await getGenerationCreativeContext({
          appId: "content",
          artifactType: "document",
          artifactId: input.documentId,
        });
  if (
    !previous &&
    !input.contextPackId &&
    !input.contextModeOverride &&
    !input.reuseLabels.length
  ) {
    return undefined;
  }
  if (
    input.contextPackId !== undefined &&
    previous?.contextPackId &&
    input.contextPackId !== previous.contextPackId
  ) {
    throw new Error(
      "The document update must preserve the document's creative-context pack",
    );
  }
  const requestedLabels: CreativeContextReuseLabel[] = input.reuseLabels.length
    ? input.reuseLabels
    : [
        {
          kind: "document",
          label: "Net-new document update",
          dataRole: "untrusted-reference",
          elementId: input.documentId,
          influence: "generated",
        },
      ];
  const validated = await validateGenerationCreativeContext({
    contextPackId: input.contextPackId ?? previous?.contextPackId,
    contextPackSource:
      input.contextPackId === undefined ? "inherited" : "explicit",
    contextModeOverride: input.contextModeOverride,
    reuseLabels: requestedLabels,
    reuseLabelsSource: input.reuseLabels.length ? "explicit" : "inherited",
  });
  const nextElementProvenance = validated.reuseLabels.map((label) => ({
    elementId: input.documentId,
    influence: label.influence ?? ("reference-conditioned" as const),
    ...(label.itemId ? { itemId: label.itemId } : {}),
    ...(label.itemVersionId ? { itemVersionId: label.itemVersionId } : {}),
    label: label.label,
  }));
  const contextMode =
    validated.contextMode === "off"
      ? "off"
      : (previous?.contextMode ?? validated.contextMode);
  return {
    contextMode,
    contextPackId: validated.contextPackId,
    reuseLabels: validated.reuseLabels,
    elementProvenance:
      contextMode === "off"
        ? nextElementProvenance
        : replaceCreativeContextElementProvenance(
            previous?.elementProvenance ?? [],
            nextElementProvenance,
          ),
  };
}

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
}

function canEditRole(role: string) {
  return role === "owner" || role === "admin" || role === "editor";
}

function canCommentRole(role: string) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "editor" ||
    role === "commenter"
  );
}

async function setFavoriteAndOrder(args: {
  db: ReturnType<typeof getDb>;
  userEmail: string;
  documentId: string;
  favorite: boolean;
  now: string;
}) {
  const favoritesDatabaseId = favoritesSystemIds(args.userEmail).databaseId;
  const settingName = personalDatabaseViewSettingKey(favoritesDatabaseId);
  return mutateContentUserSettingTransaction(
    (callback) => args.db.transaction(callback),
    args.userEmail,
    settingName,
    async (tx, current) => {
      const migrated = migratePersonalDatabaseViewOverrides(
        current,
        favoritesDatabaseId,
        "favorites",
      );
      const activeViewId = migrated?.activeViewId ?? "default";
      const membership = await setFavoriteMembership({
        db: tx as unknown as ReturnType<typeof getDb>,
        userEmail: args.userEmail,
        documentId: args.documentId,
        favorite: args.favorite,
        now: args.now,
      });
      return {
        value: applyContentPersonalNavigationPatch(
          migrated,
          {
            sidebarOrder: {
              operation: args.favorite ? "prepend" : "remove",
              viewId: activeViewId,
              itemId: membership.membershipId,
            },
          },
          [{ id: activeViewId, sorts: [], filters: [], filterMode: "and" }],
        ) as unknown as Record<string, unknown>,
        result: membership,
      };
    },
  );
}

function builderBodyWithoutImageSourceComponentMarkers(
  content: string | null | undefined,
) {
  return (content ?? "")
    .replace(/(?:^|\n)<SourceComponent\b[\s\S]*?\/>[ \t]*(?=\n|$)/g, (marker) =>
      marker.includes('componentName="Image"') ? "\n" : marker,
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function builderBodyWithoutMarkdownImages(content: string | null | undefined) {
  return (content ?? "")
    .replace(
      /(?:^|\n)!\[(?:\\.|[^\]\\])*\]\(\S+?(?:\s+"[^"]*")?\)[ \t]*(?=\n|$)/g,
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedBuilderBodyProse(content: string | null | undefined) {
  return (content ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isEffectivelyEmptyDocumentContent(
  content: string | null | undefined,
) {
  const normalized = (content ?? "").trim();
  return normalized === "" || normalized === "<empty-block/>";
}

export function shouldRejectStaleEmptyBodySave(args: {
  incomingContent: string | null | undefined;
  currentContent: string | null | undefined;
  loadedUpdatedAt: string | null | undefined;
  currentUpdatedAt: string | null | undefined;
  loadedContentWasEmpty?: boolean | null | undefined;
}) {
  if (!args.loadedUpdatedAt || !args.currentUpdatedAt) return false;
  if (!isEffectivelyEmptyDocumentContent(args.incomingContent)) return false;
  if (isEffectivelyEmptyDocumentContent(args.currentContent)) return false;
  if (args.loadedContentWasEmpty === true) return true;
  return (
    new Date(args.currentUpdatedAt).getTime() >
    new Date(args.loadedUpdatedAt).getTime()
  );
}

export function firstChangedQuote(
  previous: string,
  next: string,
  maxLen = 80,
): string {
  if (!next) return "";
  if (previous === next) return next.slice(0, maxLen);
  let start = 0;
  const min = Math.min(previous.length, next.length);
  while (start < min && previous[start] === next[start]) start++;
  while (start < next.length && /\s/.test(next[start])) start++;
  return next.slice(start, start + maxLen).trim() || next.slice(0, maxLen);
}

export function isStaleBuilderImageSourceComponentSave(args: {
  incomingContent: string;
  currentContent: string;
  sourceContent: string | null | undefined;
}) {
  const sourceContent = args.sourceContent ?? "";
  const currentMatchesSource =
    normalizedBuilderBodyProse(args.currentContent) ===
    normalizedBuilderBodyProse(sourceContent);
  if (
    !args.incomingContent.includes('componentName="Image"') ||
    !sourceContent.includes("![") ||
    sourceContent.includes('componentName="Image"') ||
    !currentMatchesSource
  ) {
    return false;
  }
  return (
    normalizedBuilderBodyProse(
      builderBodyWithoutImageSourceComponentMarkers(args.incomingContent),
    ) ===
    normalizedBuilderBodyProse(builderBodyWithoutMarkdownImages(sourceContent))
  );
}

export default defineAction({
  description:
    "Update an existing document's metadata or browser-owned content. Agents must use get-document followed by edit-document with baseRevision and idempotencyKey for body changes.",
  deferLoading: false,
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Update Content Document",
    description:
      "Delegate a sparse metadata update to an existing Content document while preserving omitted fields. For body changes, use get-document followed by edit-document with its revision protocol.",
  },
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New markdown content"),
    description: z
      .string()
      .optional()
      .describe("Stable page guidance; this does not alter page content"),
    icon: z
      .union([z.string(), iconValueSchema])
      .nullable()
      .optional()
      .describe("New emoji, Tabler icon, or uploaded image icon"),
    isFavorite: z.coerce
      .boolean()
      .optional()
      .describe("Favorite status (true/false)"),
    loadedUpdatedAt: z
      .string()
      .optional()
      .describe("Document updatedAt value the client loaded before editing"),
    loadedContentWasEmpty: z
      .boolean()
      .optional()
      .describe("Whether the client-loaded content snapshot was empty"),
    baseUpdatedAt: z
      .string()
      .optional()
      .describe(
        "updatedAt of the last-loaded document snapshot; enables compare-and-swap for content saves",
      ),
    baseRevision: z
      .string()
      .optional()
      .describe(
        "Opaque body revision from get-document; guards browser content saves without treating metadata changes as body conflicts",
      ),
    baseTitle: z
      .string()
      .optional()
      .describe(
        "Exact title from the caller's base snapshot for a title update",
      ),
    historySessionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Browser editor session ID used to group related title and body saves",
      ),
    editorSessionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Stable browser-tab identity for recovery-draft ordering"),
    editorEditGeneration: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Browser-local edit generation acknowledged by this save; paired with editorSessionId",
      ),
    editorSnapshotTitle: z.string().max(10_000).optional(),
    editorSnapshotContent: z.string().max(500_000).optional(),
    preserveLeadingTitleHeading: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Preserve a leading H1 that matches the title when reproducing an exact saved body.",
      ),
    contextPackId: z
      .string()
      .optional()
      .describe("Exact Creative Context pack used for this agent update."),
    contextModeOverride: z
      .literal("off")
      .optional()
      .describe(
        "Disable Creative Context for this agent update only without changing the saved preference.",
      ),
    reuseLabels: z
      .array(reuseLabelSchema)
      .optional()
      .default([])
      .describe("Exact item versions that influenced this agent update."),
  }),
  audit: {
    recordInputs: false,
    target: (args, result) => {
      const favoriteOnly = isFavoriteOnlyUpdate(args);
      return {
        type: "document",
        id: args.id,
        ownerEmail: favoriteOnly
          ? undefined
          : (result as DocumentAuditScopedResult | null)?.[documentAuditOwner],
        visibility: "private",
      };
    },
    summary: (args, result) =>
      (result as DocumentUpdateConflictResponse | null)?.conflict
        ? `Document update conflicted for ${args.id}`
        : `Updated document ${args.id}`,
  },
  run: async (
    args,
    ctx,
  ): Promise<DocumentUpdateResponse | DocumentUpdateConflictResponse> => {
    const id = args.id;
    if (!id) throw new Error("--id is required");
    if (
      (args.editorSessionId === undefined) !==
      (args.editorEditGeneration === undefined)
    ) {
      throw new ActionContractError(
        "editorSessionId and editorEditGeneration must be provided together.",
        { errorCode: "INVALID_EDITOR_EDIT_IDENTITY", statusCode: 400 },
      );
    }
    if (
      (args.editorSnapshotTitle === undefined) !==
      (args.editorSnapshotContent === undefined)
    ) {
      throw new ActionContractError(
        "editorSnapshotTitle and editorSnapshotContent must be provided together.",
        { errorCode: "INVALID_EDITOR_SNAPSHOT", statusCode: 400 },
      );
    }
    if (args.isFavorite !== undefined && !isFavoriteOnlyUpdate(args)) {
      throw new ActionContractError(
        "Favorite changes must be submitted separately from document field changes.",
        {
          errorCode: "FAVORITE_UPDATE_MUST_BE_SEPARATE",
          statusCode: 400,
        },
      );
    }
    if (
      args.title !== undefined &&
      args.content !== undefined &&
      args.baseRevision !== undefined &&
      args.baseTitle === undefined
    ) {
      throw new ActionContractError(
        "Combined title and body saves require baseTitle with baseRevision.",
        { errorCode: "BASE_TITLE_REQUIRED", statusCode: 400 },
      );
    }

    const isExternalCaller =
      ctx?.caller === "tool" ||
      ctx?.caller === "mcp" ||
      ctx?.caller === "webmcp" ||
      ctx?.caller === "a2a";
    if (isExternalCaller && args.content !== undefined) {
      throw new ActionContractError(
        "External document body updates require get-document followed by edit-document with baseRevision and idempotencyKey.",
        {
          errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
          statusCode: 400,
        },
      );
    }

    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";

    const favoriteOnly = isFavoriteOnlyUpdate(args);
    const access = favoriteOnly
      ? await resolveDocumentAccessForMutation(id, "id")
      : await assertDocumentMutationAccess(id, "editor", "id");
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;

    const db = getDb();
    const requestUserEmail = getRequestUserEmail();
    const requestOrgId = getRequestOrgId() ?? "";
    const actor = requireDocumentRequestActor(ctx);
    if (args.isFavorite !== undefined && !requestUserEmail) {
      throw new Error("no authenticated user");
    }
    if (args.isFavorite !== undefined) {
      await provisionContentSpaces(db, requestUserEmail as string);
    }
    const currentFavorite = requestUserEmail
      ? (await favoriteDocumentIds(db, requestUserEmail, [id])).has(id)
      : parseDocumentFavorite(existing.isFavorite);

    let content = args.content;
    if (content !== undefined && !args.preserveLeadingTitleHeading) {
      const titleToCheck = args.title || existing.title;
      if (titleToCheck) {
        const h1Match = content.match(/^#\s+(.+?)(\r?\n|$)/);
        if (
          h1Match &&
          h1Match[1].trim().toLowerCase() === titleToCheck.trim().toLowerCase()
        ) {
          content = content.slice(h1Match[0].length).trimStart();
        }
      }
      if (
        content.includes('componentName="Image"') &&
        existing.content.includes("![")
      ) {
        const [builderBody] = await db
          .select({
            sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
          })
          .from(schema.contentDatabaseSourceRows)
          .innerJoin(
            schema.contentDatabaseSources,
            eq(
              schema.contentDatabaseSources.id,
              schema.contentDatabaseSourceRows.sourceId,
            ),
          )
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.documentId, id),
              eq(schema.contentDatabaseSources.sourceType, "builder-cms"),
            ),
          )
          .limit(1);
        const sourceValues = JSON.parse(
          builderBody?.sourceValuesJson ?? "{}",
        ) as Record<string, unknown>;
        const sourceContent = sourceValues[BUILDER_CMS_BODY_CONTENT_KEY];
        if (
          typeof sourceContent === "string" &&
          isStaleBuilderImageSourceComponentSave({
            incomingContent: content,
            currentContent: existing.content,
            sourceContent,
          })
        ) {
          content = existing.content;
        }
      }
      if (
        shouldRejectStaleEmptyBodySave({
          incomingContent: content,
          currentContent: existing.content,
          loadedUpdatedAt: args.loadedUpdatedAt,
          currentUpdatedAt: existing.updatedAt,
          loadedContentWasEmpty: args.loadedContentWasEmpty,
        })
      ) {
        content = existing.content;
      }
    }

    const titleChanged =
      args.title !== undefined && args.title !== existing.title;
    const contentChanged =
      content !== undefined && content !== existing.content;
    const iconChanged = args.icon !== undefined && args.icon !== existing.icon;
    const favoriteChanged =
      args.isFavorite !== undefined && args.isFavorite !== currentFavorite;
    const descriptionChanged =
      args.description !== undefined &&
      args.description.trim() !== existing.description;
    const anyChange =
      titleChanged ||
      contentChanged ||
      iconChanged ||
      favoriteChanged ||
      descriptionChanged ||
      args.isFavorite === false;

    let softDeletedDatabaseIds: string[] = [];
    let creativeContext:
      | Awaited<ReturnType<typeof documentMutationCreativeContext>>
      | undefined;

    const useBodyRevisionCas =
      args.content !== undefined && args.baseRevision !== undefined;
    const useDocumentCas =
      args.content !== undefined &&
      args.baseRevision === undefined &&
      args.baseUpdatedAt !== undefined;

    const settlesPreviewDraft =
      ctx?.caller === "frontend" &&
      !!requestUserEmail &&
      !!args.editorSessionId &&
      args.editorEditGeneration !== undefined &&
      (args.title !== undefined || args.content !== undefined);

    if (anyChange || settlesPreviewDraft) {
      let contentCasConflict = false;
      let committedContentChanged = false;
      let committedContentBefore = existing.content;
      let committedEditorSnapshot: { title: string; content: string } | null =
        null;
      const mutate = async (tx: any) => {
        await tx
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .for("update");
        const [historyBefore] = await tx
          .select({
            title: schema.documents.title,
            content: schema.documents.content,
            bodyRevision: schema.documents.bodyRevision,
            description: schema.documents.description,
            icon: schema.documents.icon,
            updatedAt: schema.documents.updatedAt,
          })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .limit(1);
        const lockedTitleChanged =
          args.title !== undefined && args.title !== historyBefore.title;
        const lockedContentChanged =
          content !== undefined && content !== historyBefore.content;
        const lockedDescriptionChanged =
          args.description !== undefined &&
          args.description.trim() !== historyBefore.description;
        const lockedIconChanged =
          args.icon !== undefined && args.icon !== historyBefore.icon;
        const lockedDocumentFieldsChanged =
          lockedTitleChanged ||
          lockedContentChanged ||
          lockedDescriptionChanged ||
          lockedIconChanged;
        const parsedBaseRevision = args.baseRevision
          ? parseDocumentRevisionToken(args.baseRevision)
          : null;
        if (args.baseRevision && !parsedBaseRevision) {
          throw new ActionContractError(
            "baseRevision is not a valid document revision token.",
            { errorCode: "INVALID_BASE_REVISION", statusCode: 400 },
          );
        }
        if (
          lockedContentChanged &&
          args.baseRevision &&
          args.baseRevision !==
            documentRevisionToken(
              historyBefore.bodyRevision,
              historyBefore.content,
            )
        ) {
          contentCasConflict = true;
          return;
        }
        if (
          lockedTitleChanged &&
          args.baseTitle !== undefined &&
          historyBefore.title !== args.baseTitle
        ) {
          contentCasConflict = true;
          return;
        }
        const updatedAt = nextDocumentUpdatedAt(historyBefore.updatedAt);
        const updates: Record<string, unknown> = { updatedAt };
        if (lockedTitleChanged) updates.title = args.title;
        if (lockedDescriptionChanged)
          updates.description = args.description?.trim();
        if (lockedContentChanged) {
          updates.content = content;
          updates.bodyRevision = historyBefore.bodyRevision + 1;
        }
        if (lockedIconChanged)
          updates.icon =
            args.icon === null
              ? null
              : serializeIconValue(parseIconValue(args.icon));
        if (lockedTitleChanged || lockedContentChanged) {
          Object.assign(updates, documentEditAttribution(actor));
        }
        const primaryBlocksFields = lockedContentChanged
          ? await lockPrimaryBlocksFields(
              tx as unknown as ReturnType<typeof getDb>,
              id,
            )
          : [];
        const applied = await commitCanonicalDocumentBodyMutation({
          write: async () => {
            if (
              (useBodyRevisionCas && lockedContentChanged) ||
              useDocumentCas
            ) {
              const rows = await tx
                .update(schema.documents)
                .set(updates)
                .where(
                  and(
                    eq(schema.documents.id, id),
                    ...(parsedBaseRevision
                      ? [
                          eq(
                            schema.documents.bodyRevision,
                            parsedBaseRevision.revision,
                          ),
                        ]
                      : [
                          eq(
                            schema.documents.updatedAt,
                            args.baseUpdatedAt as string,
                          ),
                        ]),
                  ),
                )
                .returning({ id: schema.documents.id });
              return rows.length > 0;
            }
            if (lockedDocumentFieldsChanged) {
              await tx
                .update(schema.documents)
                .set(updates)
                .where(eq(schema.documents.id, id));
            }
            return true;
          },
          afterWrite: async () => {
            if (lockedContentChanged && content !== undefined) {
              for (const field of primaryBlocksFields) {
                await persistBlocksFieldIdentity({
                  db: tx as unknown as ReturnType<typeof getDb>,
                  ownerEmail: field.ownerEmail,
                  documentId: id,
                  propertyId: field.propertyId,
                  previousMarkdown: historyBefore.content,
                  markdown: content,
                  now: updatedAt,
                });
              }
            }
          },
        });
        if (!applied) {
          contentCasConflict = true;
          return;
        }
        committedContentChanged = lockedContentChanged;
        committedContentBefore = historyBefore.content;

        if (lockedTitleChanged && args.title !== undefined) {
          await propagateDocumentTitle({
            db: tx as unknown as ReturnType<typeof getDb>,
            documentId: id,
            title: args.title,
            updatedAt,
          });
        }
        if (lockedTitleChanged || lockedContentChanged) {
          const [after] = await tx
            .select({
              title: schema.documents.title,
              content: schema.documents.content,
            })
            .from(schema.documents)
            .where(eq(schema.documents.id, id))
            .limit(1);
          committedEditorSnapshot = after;
          await recordDocumentHistoryTransition({
            db: tx as unknown as ReturnType<typeof getDb>,
            ownerEmail,
            documentId: id,
            before: historyBefore,
            after,
            cause: {
              ctx,
              historySessionId: args.historySessionId,
              operation: "update-document",
            },
            now: updatedAt,
          });
        }
        if (settlesPreviewDraft && committedEditorSnapshot === null) {
          const [snapshot] = await tx
            .select({
              title: schema.documents.title,
              content: schema.documents.content,
            })
            .from(schema.documents)
            .where(eq(schema.documents.id, id))
            .limit(1);
          committedEditorSnapshot = snapshot ?? null;
        }
        if (
          settlesPreviewDraft &&
          args.editorSnapshotTitle !== undefined &&
          args.editorSnapshotContent !== undefined &&
          committedEditorSnapshot?.title === args.editorSnapshotTitle &&
          committedEditorSnapshot.content === args.editorSnapshotContent
        ) {
          await settlePreviewDocumentDraft({
            db: tx,
            ownerEmail: requestUserEmail as string,
            orgId: requestOrgId,
            documentId: id,
            editorSessionId: args.editorSessionId as string,
            editGeneration: args.editorEditGeneration as number,
            now: updatedAt,
          });
        }
      };
      if (
        (favoriteChanged || args.isFavorite === false) &&
        !settlesPreviewDraft
      ) {
        await setFavoriteAndOrder({
          db,
          userEmail: requestUserEmail as string,
          documentId: id,
          favorite: args.isFavorite as boolean,
          now: nextDocumentUpdatedAt(existing.updatedAt),
        });
      } else {
        await db.transaction(mutate);
      }

      if (contentCasConflict) {
        const [current] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id));
        return scopeDocumentAudit(
          {
            conflict: true,
            id,
            document: {
              id: current.id,
              urlPath: `/page/${current.id}`,
              parentId: current.parentId,
              title: current.title,
              content: current.content,
              description: current.description,
              icon: current.icon,
              position: current.position,
              isFavorite: currentFavorite,
              hideFromSearch: parseDocumentHideFromSearch(
                current.hideFromSearch,
              ),
              visibility: current.visibility,
              accessRole: access.role,
              canComment: canCommentRole(access.role),
              canEdit: canEditRole(access.role),
              canManage: canManageRole(access.role),
              createdAt: current.createdAt,
              updatedAt: current.updatedAt,
              revision: documentRevisionToken(
                current.bodyRevision,
                current.content,
              ),
              bodyRevision: current.bodyRevision,
              contentHash: documentContentHash(current.content),
              source: serializeDocumentSource(current),
              softDeletedDatabaseIds: [],
            },
          } satisfies DocumentUpdateConflictResponse,
          ownerEmail,
        );
      }

      if (committedContentChanged) {
        softDeletedDatabaseIds = await reconcileInlineDatabasesForDocument(
          id,
          content ?? "",
        );
      }

      if (isAgentCaller && committedContentChanged) {
        try {
          agentTouchDocument(id, {
            edit: {
              descriptor: {
                kind: "text",
                quote: firstChangedQuote(committedContentBefore, content ?? ""),
              },
              label: (args.title ?? existing.title) || undefined,
            },
          });
        } catch (error) {
          console.error(
            "update-document: agent presence publish failed",
            error,
          );
        }
      }
      if (isAgentCaller) {
        creativeContext = await documentMutationCreativeContext({
          documentId: id,
          contextPackId: args.contextPackId,
          contextModeOverride: args.contextModeOverride,
          reuseLabels: args.reuseLabels,
          artifactAccessAsserted: true,
        });
        if (creativeContext) {
          await recordGenerationCreativeContext({
            appId: "content",
            artifactType: "document",
            artifactId: id,
            ...creativeContext,
          });
        }
      }
    }

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    const finalFavorite = requestUserEmail
      ? (await favoriteDocumentIds(db, requestUserEmail, [id])).has(id)
      : parseDocumentFavorite(doc.isFavorite);

    await writeAppState("refresh-signal", { ts: Date.now() });

    if (isAgentCaller && doc.content !== existing.content) {
      track(
        "ai_refine_used",
        {
          app_name: "content",
          template_name: "content",
          output_id: id,
          output_type: "document",
          edit_count: 1,
          refine_type: "full_update",
        },
        ctx,
      );
    }

    return scopeDocumentAudit(
      {
        id: doc.id,
        urlPath: `/page/${doc.id}`,
        parentId: doc.parentId,
        title: doc.title,
        content: doc.content,
        description: doc.description,
        icon: doc.icon,
        position: doc.position,
        isFavorite: finalFavorite,
        hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
        visibility: doc.visibility,
        accessRole: access.role,
        canComment: canCommentRole(access.role),
        canEdit: canEditRole(access.role),
        canManage: canManageRole(access.role),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        revision: documentRevisionToken(doc.bodyRevision, doc.content),
        bodyRevision: doc.bodyRevision,
        contentHash: documentContentHash(doc.content),
        contentFidelity: inspectNfmFidelity(doc.content),
        source: serializeDocumentSource(doc),
        softDeletedDatabaseIds,
        ...(creativeContext
          ? {
              contextMode: creativeContext.contextMode,
              contextPackId: creativeContext.contextPackId,
              reuseLabels: creativeContext.reuseLabels,
            }
          : {}),
      } satisfies DocumentUpdateResponse,
      ownerEmail,
    );
  },
});
