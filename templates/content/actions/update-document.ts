import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { agentTouchDocument } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import type { DocumentUpdateResponse } from "../shared/api.js";
import { BUILDER_CMS_BODY_CONTENT_KEY } from "./_builder-cms-source-adapter.js";
import { reconcileInlineDatabasesForDocument } from "./_content-database-lifecycle.js";
import { serializeDocumentSource } from "./_document-source.js";
import {
  isLocalDocumentId,
  isContentLocalFileMode,
  updateLocalFileDocument,
} from "./_local-file-documents.js";

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

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function canManageRole(role: string) {
  return role === "owner" || role === "admin";
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
    icon: z.string().nullable().optional().describe("New emoji icon"),
    isFavorite: z.coerce
      .boolean()
      .optional()
      .describe("Favorite status (true/false)"),
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
  }),
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

    if ((await isContentLocalFileMode()) && isLocalDocumentId(id)) {
      const doc = await updateLocalFileDocument(id, args);
      await writeAppState("refresh-signal", { ts: Date.now() });
      return {
        ...doc,
        urlPath: `/page/${doc.id}`,
        softDeletedDatabaseIds: [],
      };
    }

    const access = await assertAccess("document", id, "editor");
    const existing = access.resource;
    const ownerEmail = existing.ownerEmail as string;

    const db = getDb();

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
      args.isFavorite !== undefined &&
      (args.isFavorite ? 1 : 0) !== (existing.isFavorite ?? 0);
    const anyChange =
      titleChanged || contentChanged || iconChanged || favoriteChanged;

    // Snapshot the current state before applying content/title changes.
    // Versions are scoped to the document owner, not the caller — an editor
    // share collaborator shouldn't create a phantom version row under their
    // own email.
    if (titleChanged || contentChanged) {
      const [latestVersion] = await db
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
        !latestVersion ||
        Date.now() - new Date(latestVersion.createdAt).getTime() >
          SNAPSHOT_INTERVAL_MS;

      if (shouldSnapshot) {
        await db.insert(schema.documentVersions).values({
          id: nanoid(),
          ownerEmail,
          documentId: id,
          title: existing.title,
          content: existing.content,
          createdAt: new Date().toISOString(),
        });
      }
    }

    let softDeletedDatabaseIds: string[] = [];

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
      if (contentChanged) updates.content = content;
      if (iconChanged) updates.icon = args.icon;
      if (favoriteChanged) updates.isFavorite = args.isFavorite ? 1 : 0;

      if (useContentCas) {
        const applied = await db
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
          // Someone else's write landed after the caller's snapshot. Don't
          // apply this save at all (title/icon/favorite included — a partial
          // apply would desync the fields from what the caller believes it
          // just sent) and hand back the current server row instead so the
          // caller can reconcile.
          const [current] = await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, id));
          return {
            conflict: true,
            id,
            document: {
              id: current.id,
              urlPath: `/page/${current.id}`,
              parentId: current.parentId,
              title: current.title,
              content: current.content,
              icon: current.icon,
              position: current.position,
              isFavorite: parseDocumentFavorite(current.isFavorite),
              hideFromSearch: parseDocumentHideFromSearch(
                current.hideFromSearch,
              ),
              visibility: current.visibility,
              accessRole: access.role,
              canEdit: true,
              canManage: canManageRole(access.role),
              createdAt: current.createdAt,
              updatedAt: current.updatedAt,
              source: serializeDocumentSource(current),
              softDeletedDatabaseIds: [],
            },
          };
        }
      } else {
        await db
          .update(schema.documents)
          .set(updates)
          .where(eq(schema.documents.id, id));
      }

      if (titleChanged && args.title !== undefined) {
        await db
          .update(schema.contentDatabases)
          .set({ title: args.title, updatedAt: updates.updatedAt as string })
          .where(eq(schema.contentDatabases.documentId, id));
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
    }

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: doc.id,
      urlPath: `/page/${doc.id}`,
      parentId: doc.parentId,
      title: doc.title,
      content: doc.content,
      icon: doc.icon,
      position: doc.position,
      isFavorite: parseDocumentFavorite(doc.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(doc.hideFromSearch),
      visibility: doc.visibility,
      accessRole: access.role,
      canEdit: true,
      canManage: canManageRole(access.role),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      source: serializeDocumentSource(doc),
      softDeletedDatabaseIds,
    };
  },
});
