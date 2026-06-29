import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { ROLE_RANK, resolveAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isBuilderMdxSourcePath,
  isContentSourcePath,
  parseContentSourceFile,
  type ParsedContentSourceFile,
} from "../shared/content-source.js";

const MAX_SOURCE_FILES = 500;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

function boolToInt(value: boolean | undefined) {
  return value ? 1 : 0;
}

function sourceRootPath(filePath: string) {
  return filePath.split("/").filter(Boolean)[0] ?? null;
}

function localSourceFields(filePath: string, now: string) {
  return {
    sourceMode: "local-files",
    sourceKind: "file",
    sourcePath: filePath,
    sourceRootPath: sourceRootPath(filePath),
    sourceUpdatedAt: now,
  };
}

function canEditRole(role: string) {
  return ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK.editor;
}

function normalizedFileEntries(files: Record<string, string>) {
  return Object.entries(files)
    .filter(([filePath]) => isContentSourcePath(filePath))
    .sort(([a], [b]) => a.localeCompare(b));
}

async function maybeSnapshotExistingDocument(input: {
  documentId: string;
  ownerEmail: string;
  title: string;
  content: string;
}) {
  const db = getDb();
  const [latestVersion] = await db
    .select({ createdAt: schema.documentVersions.createdAt })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.documentId, input.documentId),
        eq(schema.documentVersions.ownerEmail, input.ownerEmail),
      ),
    )
    .orderBy(desc(schema.documentVersions.createdAt))
    .limit(1);

  const shouldSnapshot =
    !latestVersion ||
    Date.now() - new Date(latestVersion.createdAt).getTime() >
      SNAPSHOT_INTERVAL_MS;
  if (!shouldSnapshot) return;

  await db.insert(schema.documentVersions).values({
    id: nanoid(),
    ownerEmail: input.ownerEmail,
    documentId: input.documentId,
    title: input.title,
    content: input.content,
    createdAt: new Date().toISOString(),
  });
}

function hasParentCycle(
  id: string,
  desiredParentById: Map<string, string | null>,
) {
  const seen = new Set([id]);
  let parentId = desiredParentById.get(id) ?? null;
  while (parentId) {
    if (seen.has(parentId)) return true;
    seen.add(parentId);
    parentId = desiredParentById.get(parentId) ?? null;
  }
  return false;
}

async function assertParentIsNotDescendant(input: {
  ownerEmail: string;
  id: string;
  parentId: string | null;
}) {
  if (!input.parentId) return;
  const db = getDb();
  const queue = [input.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, input.ownerEmail),
          eq(schema.documents.parentId, currentId),
        ),
      );

    for (const child of children) {
      if (child.id === input.parentId) {
        throw new Error("Skipped parent update: cycle.");
      }
      queue.push(child.id);
    }
  }
}

export default defineAction({
  description:
    "Import Markdown/MDX source files into Content documents. Files with frontmatter ids update existing editable documents; files without ids create new private documents.",
  schema: z.object({
    files: z
      .record(z.string(), z.string().max(MAX_SOURCE_FILE_BYTES))
      .refine((files) => Object.keys(files).length <= MAX_SOURCE_FILES, {
        message: `Import is limited to ${MAX_SOURCE_FILES} files.`,
      })
      .describe("Map of relative file path to UTF-8 markdown/MDX contents."),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe("Preview creates/updates without writing changes."),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Import Content Source",
    description:
      "Import local Markdown/MDX source files into editable Content documents.",
  },
  run: async ({ files, dryRun }) => {
    const builderPaths = Object.keys(files).filter((filePath) =>
      isBuilderMdxSourcePath(filePath),
    );
    if (builderPaths.length > 0) {
      throw new Error(
        `Builder .builder.mdx files must use the Builder doc actions so raw sidecars and hashes are preserved: ${builderPaths.join(
          ", ",
        )}.`,
      );
    }

    const entries = normalizedFileEntries(files);
    if (entries.length === 0) {
      throw new Error("No .md or .mdx files were provided.");
    }

    const currentUserEmail = getRequestUserEmail();
    if (!currentUserEmail) throw new Error("no authenticated user");
    const currentOrgId = getRequestOrgId() ?? null;
    const db = getDb();
    const now = new Date().toISOString();
    const parsed: ParsedContentSourceFile[] = entries.map(
      ([filePath, source]) => parseContentSourceFile(filePath, source),
    );
    const importPaths = [...new Set(parsed.map((file) => file.path))];
    const existingLocalDocs =
      importPaths.length > 0
        ? await db
            .select()
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.ownerEmail, currentUserEmail),
                currentOrgId
                  ? eq(schema.documents.orgId, currentOrgId)
                  : isNull(schema.documents.orgId),
                eq(schema.documents.sourceMode, "local-files"),
                inArray(schema.documents.sourcePath, importPaths),
              ),
            )
        : [];
    const existingLocalDocByPath = new Map(
      existingLocalDocs
        .filter((document) => document.sourcePath)
        .map((document) => [document.sourcePath!, document]),
    );

    const seenIds = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const file of parsed) {
      if (!file.id) continue;
      if (seenIds.has(file.id)) duplicateIds.add(file.id);
      seenIds.add(file.id);
    }

    const created: Array<{ id: string; path: string; title: string }> = [];
    const updated: Array<{ id: string; path: string; title: string }> = [];
    const unchanged: Array<{ id: string; path: string; title: string }> = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const errors: Array<{ path: string; reason: string }> = [];
    const idByPath = new Map<string, string>();
    const pathById = new Map<string, string>();
    const ownerById = new Map<string, string>();
    const desiredParentById = new Map<string, string | null>();
    const desiredPositionById = new Map<string, number>();
    const currentParentById = new Map<string, string | null>();
    const currentPositionById = new Map<string, number>();

    for (let index = 0; index < parsed.length; index += 1) {
      const file = parsed[index];
      if (file.errors && file.errors.length > 0) {
        errors.push({
          path: file.path,
          reason: file.errors.join(" "),
        });
        continue;
      }
      if (file.id && duplicateIds.has(file.id)) {
        errors.push({
          path: file.path,
          reason: `Duplicate source id "${file.id}".`,
        });
        continue;
      }

      const sourceMatchedDocument = file.id
        ? null
        : (existingLocalDocByPath.get(file.path) ?? null);
      const id = file.id ?? sourceMatchedDocument?.id ?? nanoid();
      idByPath.set(file.path, id);
      pathById.set(id, file.path);

      const access = file.id ? await resolveAccess("document", file.id) : null;
      const existing = access?.resource ?? sourceMatchedDocument;
      const existingRole =
        access?.role ?? (sourceMatchedDocument ? "owner" : null);
      if (existing && existingRole && !canEditRole(existingRole)) {
        skipped.push({
          path: file.path,
          reason: `Requires editor access to update document "${file.id}".`,
        });
        continue;
      }

      if (existing) {
        ownerById.set(id, existing.ownerEmail as string);
        currentParentById.set(id, existing.parentId ?? null);
        currentPositionById.set(id, existing.position ?? 0);
        if (file.parentId !== undefined) {
          desiredParentById.set(id, file.parentId);
        }
        if (file.position !== undefined) {
          desiredPositionById.set(id, file.position);
        }
        const titleChanged = file.title !== existing.title;
        const contentChanged = file.content !== existing.content;
        const iconChanged =
          file.icon !== undefined && file.icon !== existing.icon;
        const favoriteChanged =
          file.isFavorite !== undefined &&
          boolToInt(file.isFavorite) !== (existing.isFavorite ?? 0);
        const discoverabilityChanged =
          file.hideFromSearch !== undefined &&
          boolToInt(file.hideFromSearch) !== (existing.hideFromSearch ?? 0);
        const sourceUpdates = localSourceFields(file.path, now);
        const sourceChanged =
          existing.sourceMode !== sourceUpdates.sourceMode ||
          existing.sourceKind !== sourceUpdates.sourceKind ||
          existing.sourcePath !== sourceUpdates.sourcePath ||
          existing.sourceRootPath !== sourceUpdates.sourceRootPath;
        const anyChange =
          titleChanged ||
          contentChanged ||
          iconChanged ||
          favoriteChanged ||
          discoverabilityChanged ||
          sourceChanged;

        if (!anyChange) {
          unchanged.push({ id, path: file.path, title: existing.title });
          continue;
        }

        if (!dryRun) {
          if (titleChanged || contentChanged) {
            await maybeSnapshotExistingDocument({
              documentId: id,
              ownerEmail: existing.ownerEmail as string,
              title: existing.title,
              content: existing.content,
            });
          }

          const updates: Record<string, unknown> = { updatedAt: now };
          if (titleChanged) updates.title = file.title;
          if (contentChanged) updates.content = file.content;
          if (iconChanged) updates.icon = file.icon ?? null;
          if (favoriteChanged) updates.isFavorite = boolToInt(file.isFavorite);
          if (discoverabilityChanged) {
            updates.hideFromSearch = boolToInt(file.hideFromSearch);
          }
          Object.assign(updates, sourceUpdates);

          await db
            .update(schema.documents)
            .set(updates)
            .where(eq(schema.documents.id, id));
        }

        updated.push({ id, path: file.path, title: file.title });
        continue;
      }

      if (!dryRun) {
        try {
          await db.insert(schema.documents).values({
            id,
            ownerEmail: currentUserEmail,
            orgId: currentOrgId,
            parentId: null,
            title: file.title,
            content: file.content,
            icon: file.icon ?? null,
            position: file.position ?? index,
            isFavorite: boolToInt(file.isFavorite),
            hideFromSearch: boolToInt(file.hideFromSearch),
            ...localSourceFields(file.path, now),
            visibility: "private",
            createdAt: now,
            updatedAt: now,
          });
        } catch (err) {
          errors.push({
            path: file.path,
            reason:
              err instanceof Error
                ? err.message
                : `Could not create document "${id}".`,
          });
          desiredParentById.delete(id);
          desiredPositionById.delete(id);
          pathById.delete(id);
          continue;
        }
      }
      currentParentById.set(id, null);
      currentPositionById.set(id, file.position ?? index);
      desiredParentById.set(id, file.parentId ?? null);
      desiredPositionById.set(id, file.position ?? index);
      ownerById.set(id, currentUserEmail);
      created.push({ id, path: file.path, title: file.title });
    }

    if (!dryRun) {
      const layoutIds = new Set([
        ...desiredParentById.keys(),
        ...desiredPositionById.keys(),
      ]);
      for (const id of layoutIds) {
        const parentId = desiredParentById.has(id)
          ? (desiredParentById.get(id) ?? null)
          : (currentParentById.get(id) ?? null);
        if (hasParentCycle(id, desiredParentById)) {
          skipped.push({
            path: pathById.get(id) ?? id,
            reason: "Skipped parent update: cycle.",
          });
          continue;
        }

        const ownerEmail = ownerById.get(id);
        if (!ownerEmail) continue;

        let safeParentId: string | null = null;
        if (parentId) {
          const parentAccess = await resolveAccess("document", parentId);
          if (
            parentAccess &&
            (parentAccess.resource.ownerEmail as string) === ownerEmail
          ) {
            try {
              await assertParentIsNotDescendant({ ownerEmail, id, parentId });
              safeParentId = parentId;
            } catch (err) {
              skipped.push({
                path: pathById.get(id) ?? id,
                reason:
                  err instanceof Error
                    ? err.message
                    : "Skipped parent update: cycle.",
              });
              continue;
            }
          } else {
            skipped.push({
              path: pathById.get(id) ?? id,
              reason: `Skipped parent "${parentId}" because it is not editable in the same owner scope.`,
            });
          }
        }

        const nextPosition =
          desiredPositionById.get(id) ?? currentPositionById.get(id) ?? 0;
        if (
          safeParentId === (currentParentById.get(id) ?? null) &&
          nextPosition === (currentPositionById.get(id) ?? 0)
        ) {
          continue;
        }

        await db
          .update(schema.documents)
          .set({
            parentId: safeParentId,
            position: nextPosition,
            updatedAt: now,
          })
          .where(eq(schema.documents.id, id));
      }

      await writeAppState("refresh-signal", { ts: Date.now() });
    }

    return {
      dryRun,
      filesSeen: entries.length,
      created,
      updated,
      unchanged,
      skipped,
      errors,
      idByPath: Object.fromEntries(idByPath),
    };
  },
});
