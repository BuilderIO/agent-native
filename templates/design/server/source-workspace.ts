import {
  hasCollabState,
  getText,
  applyText,
  seedFromText,
} from "@agent-native/core/collab";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { isBoardFile } from "../shared/board-file.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";
import type { DesignSourceType } from "../shared/source-mode.js";
import {
  languageForSourcePath,
  normalizeInlineSourcePath,
  sourceContentHash,
} from "../shared/source-workspace.js";
import { getDb, schema } from "./db/index.js";
import "./db/index.js"; // ensure registerShareableResource runs

export interface SourceWorkspaceFile {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SourceWorkspaceContext {
  designId: string;
  sourceType: DesignSourceType;
  canEdit: boolean;
  files: SourceWorkspaceFile[];
}

function parseDesignDataSourceType(value: unknown): DesignSourceType {
  if (typeof value !== "string") return "inline";
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const raw = (parsed as Record<string, unknown>).sourceType;
      return normalizeDesignSourceType(raw) ?? "inline";
    }
  } catch {
    // Invalid design data falls back to inline, matching existing actions.
  }
  return "inline";
}

function roleCanEdit(role: unknown): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

export async function resolveSourceWorkspace(
  designId: string,
  options: { includeContent?: boolean } = {},
): Promise<SourceWorkspaceContext> {
  const access = await resolveAccess("design", designId);
  if (!access) throw new Error("Design not found");

  const db = getDb();
  const files = options.includeContent
    ? await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          content: schema.designFiles.content,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId))
    : await db
        .select({
          id: schema.designFiles.id,
          designId: schema.designFiles.designId,
          filename: schema.designFiles.filename,
          fileType: schema.designFiles.fileType,
          createdAt: schema.designFiles.createdAt,
          updatedAt: schema.designFiles.updatedAt,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId));

  return {
    designId,
    sourceType: parseDesignDataSourceType(
      (access.resource as { data?: unknown }).data,
    ),
    canEdit: roleCanEdit(access.role),
    files: files.filter((file) => !isBoardFile(file.filename)),
  };
}

export function findSourceWorkspaceFile(
  files: SourceWorkspaceFile[],
  target: { fileId?: string; path?: string },
): SourceWorkspaceFile {
  const normalizedPath =
    target.path !== undefined ? normalizeInlineSourcePath(target.path) : null;
  const file = target.fileId
    ? files.find((candidate) => candidate.id === target.fileId)
    : files.find((candidate) => candidate.filename === normalizedPath);
  if (!file) {
    throw new Error(
      target.fileId
        ? `Source file id "${target.fileId}" not found.`
        : `Source file "${normalizedPath}" not found.`,
    );
  }
  return file;
}

export async function readLiveSourceFile(file: SourceWorkspaceFile): Promise<{
  content: string;
  versionHash: string;
  language: string;
}> {
  let content = file.content ?? "";
  try {
    if (await hasCollabState(file.id)) {
      const live = await getText(file.id, "content");
      if (typeof live === "string") content = live;
    }
  } catch {
    // Collab reads are best-effort; SQL content is the fallback.
  }
  return {
    content,
    versionHash: sourceContentHash(content),
    language: languageForSourcePath(file.filename),
  };
}

export async function writeInlineSourceFile(args: {
  designId: string;
  file: SourceWorkspaceFile;
  content: string;
  expectedVersionHash?: string;
}): Promise<{ versionHash: string; changed: boolean; updatedAt: string }> {
  await assertAccess("design", args.designId, "editor");
  const db = getDb();
  const [currentFile] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
      createdAt: schema.designFiles.createdAt,
      updatedAt: schema.designFiles.updatedAt,
    })
    .from(schema.designFiles)
    .where(eq(schema.designFiles.id, args.file.id))
    .limit(1);
  if (!currentFile || currentFile.designId !== args.designId) {
    throw new Error("Source file not found.");
  }
  const current = await readLiveSourceFile(currentFile);
  if (
    args.expectedVersionHash &&
    args.expectedVersionHash !== current.versionHash
  ) {
    throw new Error(
      "Source file changed since it was read. Re-read the file and retry.",
    );
  }

  const changed = args.content !== current.content;
  const updatedAt = new Date().toISOString();
  if (!changed) {
    return {
      versionHash: current.versionHash,
      changed: false,
      updatedAt: currentFile.updatedAt ?? updatedAt,
    };
  }

  if (await hasCollabState(args.file.id)) {
    const liveBeforeApply = await getText(args.file.id, "content");
    if (
      args.expectedVersionHash &&
      args.expectedVersionHash !== sourceContentHash(liveBeforeApply)
    ) {
      throw new Error(
        "Source file changed since it was read. Re-read the file and retry.",
      );
    }
    if (liveBeforeApply !== args.content) {
      await applyText(args.file.id, args.content, "content", "agent");
    }
  } else {
    await seedFromText(args.file.id, args.content);
  }

  await db
    .update(schema.designFiles)
    .set({ content: args.content, updatedAt })
    .where(eq(schema.designFiles.id, args.file.id));

  await db
    .update(schema.designs)
    .set({ updatedAt })
    .where(eq(schema.designs.id, args.designId));

  return {
    versionHash: sourceContentHash(args.content),
    changed: true,
    updatedAt,
  };
}
