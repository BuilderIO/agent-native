import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { agentTouchDocument } from "@agent-native/core/collab";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
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
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import { propagateDocumentTitle } from "../server/lib/document-title-propagation.js";
import { nextDocumentUpdatedAt } from "../server/lib/document-updated-at.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type { DocumentUpdateResponse } from "../shared/api.js";
import { inspectNfmFidelity } from "../shared/nfm.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import { BUILDER_CMS_BODY_CONTENT_KEY } from "./_builder-cms-source-adapter.js";
import { reconcileInlineDatabasesForDocument } from "./_content-database-lifecycle.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import {
  favoriteDocumentIds,
  setFavoriteMembership,
} from "./_content-favorites.js";
import { provisionContentSpaces } from "./_content-spaces.js";
import {
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import { serializeDocumentSource } from "./_document-source.js";

// Not (yet) part of the shared API surface — kept local to avoid touching
// shared/api.ts, which another workstream owns concurrently. Structural
// shape only; consumers should narrow on `conflict: true` rather than import
// this type across a package boundary.
export interface DocumentUpdateConflictResponse {
  conflict: true;
  id: string;
  /** Current server document as of the failed compare-and-swap. */
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
  icon?: string | null;
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

/**
 * Best-effort quote of the first changed span between two document bodies, used
 * as the `{ kind: "text", quote }` descriptor so the recent-edit highlight lands
 * on (or near) the region the agent actually rewrote rather than the doc top.
 * Returns a short slice of the new content around the first divergence.
 */
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
  // Skip leading whitespace so the quote begins on visible text.
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
    icon: z.string().nullable().optional().describe("New emoji icon"),
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
    // Optional optimistic-concurrency guard for content saves: the
    // `updatedAt` of the document snapshot the caller last loaded/reconciled.
    // When provided alongside `content`, the write is a compare-and-swap on
    // `updatedAt` instead of a blind overwrite — this is how the browser
    // editor's autosave avoids clobbering a document that a concurrent
    // process (e.g. the Notion auto-pull) updated after the editor's last
    // snapshot but before this save landed. External body edits are rejected
    // below and must use edit-document's revision and receipt protocol.
    baseUpdatedAt: z
      .string()
      .optional()
      .describe(
        "updatedAt of the last-loaded document snapshot; enables compare-and-swap for content saves",
      ),
    historySessionId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Browser editor session ID used to group related title and body saves",
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
    // Document bodies and personal favorite preferences are both sensitive.
    // Keep actor/target/outcome attribution without copying mutation payloads
    // into an owner-visible audit row.
    recordInputs: false,
    target: (args, result) => {
      const favoriteOnly = isFavoriteOnlyUpdate(args);
      return {
        type: "document",
        id: args.id,
        // Favorites are a private preference owned by the actor, even when
        // the underlying document belongs to somebody else.
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

    // Only surface AI presence for genuine agent invocations (in-app tool loop,
    // sub-agents/A2A → "tool"; external MCP agents → "mcp"). The browser editor
    // autosaves through this same action as "frontend"; those must NOT light the
    // agent flag.
    const isAgentCaller =
      ctx?.caller === "tool" || ctx?.caller === "mcp" || ctx?.caller === "a2a";

    const favoriteOnly = isFavoriteOnlyUpdate(args);
    const access = favoriteOnly
      ? await resolveContentDocumentAccess(id)
      : await assertAccess("document", id, "editor");
    if (!access) throw new Error(`Document "${id}" not found`);
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;

    const db = getDb();
    const requestUserEmail = getRequestUserEmail();
    if (args.isFavorite !== undefined && !requestUserEmail) {
      throw new Error("no authenticated user");
    }
    if (args.isFavorite !== undefined) {
      await provisionContentSpaces(db, requestUserEmail as string);
    }
    const currentFavorite = requestUserEmail
      ? (await favoriteDocumentIds(db, requestUserEmail, [id])).has(id)
      : parseDocumentFavorite(existing.isFavorite);

    // Strip leading H1 that duplicates the title
    let content = args.content;
    if (content !== undefined) {
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

    // Detect actual changes — a no-op call (e.g. the editor echoing back the
    // same content after a Notion pull) must NOT bump updated_at, otherwise
    // the next sync sees a phantom local change and reports a conflict.
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
      descriptionChanged;

    let softDeletedDatabaseIds: string[] = [];
    let creativeContext:
      | Awaited<ReturnType<typeof documentMutationCreativeContext>>
      | undefined;

    // Content saves optionally carry the `updatedAt` of the snapshot the
    // caller last reconciled. Guard the write with a compare-and-swap in that
    // case so a concurrent update (e.g. the Notion auto-pull applying a newer
    // remote edit) between the caller's snapshot and this save landing isn't
    // silently overwritten. A recovery may carry unchanged content alongside
    // a stale title, so supplying content still guards the whole write.
    // Title/icon/favorite-only requests without content remain unaffected.
    const useContentCas =
      args.content !== undefined && args.baseUpdatedAt !== undefined;

    if (anyChange) {
      let contentCasConflict = false;
      let committedContentChanged = false;
      let committedContentBefore = existing.content;
      await db.transaction(async (tx) => {
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
        const updatedAt = nextDocumentUpdatedAt(historyBefore.updatedAt);
        const updates: Record<string, unknown> = { updatedAt };
        if (lockedTitleChanged) updates.title = args.title;
        if (lockedDescriptionChanged)
          updates.description = args.description?.trim();
        if (lockedContentChanged) {
          updates.content = content;
          updates.bodyRevision = historyBefore.bodyRevision + 1;
        }
        if (lockedIconChanged) updates.icon = args.icon;
        const primaryBlocksFields = lockedContentChanged
          ? await lockPrimaryBlocksFields(
              tx as unknown as ReturnType<typeof getDb>,
              id,
            )
          : [];
        if (useContentCas) {
          const applied = await tx
            .update(schema.documents)
            .set(updates)
            .where(
              and(
                eq(schema.documents.id, id),
                eq(schema.documents.updatedAt, args.baseUpdatedAt as string),
              ),
            )
            .returning({ id: schema.documents.id });
          if (!applied || applied.length === 0) {
            contentCasConflict = true;
            return;
          }
        } else if (lockedDocumentFieldsChanged) {
          await tx
            .update(schema.documents)
            .set(updates)
            .where(eq(schema.documents.id, id));
        }

        committedContentChanged = lockedContentChanged;
        committedContentBefore = historyBefore.content;
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

        if (favoriteChanged) {
          await setFavoriteMembership({
            db: tx,
            userEmail: requestUserEmail as string,
            documentId: id,
            favorite: args.isFavorite as boolean,
            now: updatedAt,
          });
        }

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
      });

      if (contentCasConflict) {
        // Someone else's write landed after the caller's snapshot. Don't
        // apply this save at all (title/icon/favorite included — a partial
        // apply would desync the fields from what the caller believes it
        // just sent) and hand back the current server row instead so the
        // caller can reconcile.
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

      // Make an agent full-content rewrite visible as a live collaborator. This
      // path replaces the whole body (not a find/replace), so it can't route
      // through `searchAndReplace`; it keeps the SQL + reconcile delivery and
      // publishes agent presence + a lingering recent-edit highlight near the
      // first changed span. Best-effort — never fail the save on presence.
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
