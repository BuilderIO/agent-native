import { defineAction } from "@agent-native/core";
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
import { and, eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type { DocumentUpdateResponse } from "../shared/api.js";
import { BUILDER_CMS_BODY_CONTENT_KEY } from "./_builder-cms-source-adapter.js";
import { reconcileInlineDatabasesForDocument } from "./_content-database-lifecycle.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import {
  favoriteDocumentIds,
  setFavoriteMembership,
} from "./_content-favorites.js";
import { provisionContentSpaces } from "./_content-spaces.js";
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

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
    "Update an existing document's title, content, icon, or favorite status.",
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
    // snapshot but before this save landed. Agent/CLI callers that omit it
    // keep today's last-write-wins behavior unchanged.
    baseUpdatedAt: z
      .string()
      .optional()
      .describe(
        "updatedAt of the last-loaded document snapshot; enables compare-and-swap for content saves",
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
    const clearsNonEmptyContent =
      contentChanged &&
      content !== undefined &&
      isEffectivelyEmptyDocumentContent(content) &&
      !isEffectivelyEmptyDocumentContent(existing.content);
    const iconChanged = args.icon !== undefined && args.icon !== existing.icon;
    const favoriteChanged =
      args.isFavorite !== undefined && args.isFavorite !== currentFavorite;
    const descriptionChanged =
      args.description !== undefined &&
      args.description.trim() !== existing.description;
    const documentFieldsChanged =
      titleChanged || contentChanged || iconChanged || descriptionChanged;
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
    // silently overwritten. Title/icon/favorite-only saves are unaffected —
    // only a save that's actually changing content is CAS-guarded.
    const useContentCas = contentChanged && args.baseUpdatedAt !== undefined;

    if (anyChange) {
      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (titleChanged) updates.title = args.title;
      if (args.description !== undefined)
        updates.description = args.description.trim();
      if (contentChanged) updates.content = content;
      if (iconChanged) updates.icon = args.icon;
      let contentCasConflict = false;
      await db.transaction(async (tx) => {
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
        } else if (documentFieldsChanged) {
          await tx
            .update(schema.documents)
            .set(updates)
            .where(eq(schema.documents.id, id));
        }

        if (titleChanged || contentChanged) {
          const [latestVersion] = await tx
            .select({ createdAt: schema.documentVersions.createdAt })
            .from(schema.documentVersions)
            .where(
              and(
                eq(schema.documentVersions.documentId, id),
                eq(schema.documentVersions.ownerEmail, ownerEmail),
              ),
            )
            .orderBy(desc(schema.documentVersions.createdAt))
            .limit(1);
          const shouldSnapshot =
            clearsNonEmptyContent ||
            !latestVersion ||
            Date.now() - new Date(latestVersion.createdAt).getTime() >
              SNAPSHOT_INTERVAL_MS;

          if (shouldSnapshot) {
            await tx.insert(schema.documentVersions).values({
              id: nanoid(),
              ownerEmail,
              documentId: id,
              title: existing.title,
              content: existing.content,
              createdAt: new Date().toISOString(),
            });
          }
        }

        if (favoriteChanged) {
          await setFavoriteMembership({
            db: tx,
            userEmail: requestUserEmail as string,
            documentId: id,
            favorite: args.isFavorite as boolean,
            now: updates.updatedAt as string,
          });
        }

        if (titleChanged && args.title !== undefined) {
          const [database] = await tx
            .select({
              id: schema.contentDatabases.id,
              spaceId: schema.contentDatabases.spaceId,
              systemRole: schema.contentDatabases.systemRole,
            })
            .from(schema.contentDatabases)
            .where(eq(schema.contentDatabases.documentId, id));
          if (database) {
            const title =
              database.systemRole === "files"
                ? args.title.trim() || "Untitled"
                : args.title;
            await tx
              .update(schema.contentDatabases)
              .set({ title, updatedAt: updates.updatedAt as string })
              .where(eq(schema.contentDatabases.id, database.id));
            if (database.systemRole === "files" && database.spaceId) {
              await tx
                .update(schema.documents)
                .set({ title, updatedAt: updates.updatedAt as string })
                .where(eq(schema.documents.id, id));
              await tx
                .update(schema.contentSpaces)
                .set({ name: title, updatedAt: updates.updatedAt as string })
                .where(eq(schema.contentSpaces.id, database.spaceId));
              const catalogReferences = await tx
                .select({
                  documentId: schema.contentSpaceCatalogItems.documentId,
                })
                .from(schema.contentSpaceCatalogItems)
                .where(
                  eq(schema.contentSpaceCatalogItems.spaceId, database.spaceId),
                );
              if (catalogReferences.length > 0) {
                await tx
                  .update(schema.documents)
                  .set({ title, updatedAt: updates.updatedAt as string })
                  .where(
                    inArray(
                      schema.documents.id,
                      catalogReferences.map(
                        (reference) => reference.documentId,
                      ),
                    ),
                  );
              }
            }
          }
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
              canEdit: canEditRole(access.role),
              canManage: canManageRole(access.role),
              createdAt: current.createdAt,
              updatedAt: current.updatedAt,
              source: serializeDocumentSource(current),
              softDeletedDatabaseIds: [],
            },
          } satisfies DocumentUpdateConflictResponse,
          ownerEmail,
        );
      }

      if (contentChanged) {
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
      if (isAgentCaller && contentChanged) {
        try {
          agentTouchDocument(id, {
            edit: {
              descriptor: {
                kind: "text",
                quote: firstChangedQuote(existing.content ?? "", content ?? ""),
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
        canEdit: canEditRole(access.role),
        canManage: canManageRole(access.role),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
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
