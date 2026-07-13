import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { annotateScreenHtmlForPersist } from "../../shared/screen-annotation.js";
import { getDb, schema } from "../db/index.js";

type DbLike = ReturnType<typeof getDb>;
type DesignRow = typeof schema.designs.$inferSelect;
type DesignInsert = typeof schema.designs.$inferInsert;
type DesignFileInsert = typeof schema.designFiles.$inferInsert;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function copyDataWithRemappedCanvasFrames({
  sourceData,
  idMap,
  dataPatch,
}: {
  sourceData: unknown;
  idMap: Map<string, string>;
  dataPatch?: Record<string, unknown>;
}): string {
  const raw = typeof sourceData === "string" ? sourceData : "{}";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return JSON.stringify(dataPatch ?? {});
    }
    const next: Record<string, unknown> = { ...parsed };
    if (isRecord(parsed.canvasFrames)) {
      const remapped: Record<string, unknown> = {};
      for (const [oldId, geometry] of Object.entries(parsed.canvasFrames)) {
        const newFileId = idMap.get(oldId);
        remapped[newFileId ?? oldId] = geometry;
      }
      next.canvasFrames = remapped;
    }
    return JSON.stringify({ ...next, ...(dataPatch ?? {}) });
  } catch {
    return dataPatch ? JSON.stringify(dataPatch) : raw;
  }
}

export async function duplicateDesignRecord({
  db = getDb(),
  source,
  newId = nanoid(),
  title,
  description = source.description,
  projectType = source.projectType,
  designSystemId = source.designSystemId ?? null,
  ownerEmail,
  orgId,
  visibility,
  now = new Date().toISOString(),
  isTemplate = false,
  templateMeta,
  dataPatch,
}: {
  db?: DbLike;
  source: DesignRow;
  newId?: string;
  title: string;
  description?: string | null;
  projectType?: string;
  designSystemId?: string | null;
  ownerEmail: string;
  orgId?: string | null;
  visibility?: "private" | "org" | "public";
  now?: string;
  isTemplate?: boolean;
  templateMeta?: Record<string, unknown> | null;
  dataPatch?: Record<string, unknown>;
}): Promise<{ id: string; title: string; fileCount: number }> {
  const files = await db
    .select()
    .from(schema.designFiles)
    .where(eq(schema.designFiles.designId, source.id));

  const idMap = new Map<string, string>(
    files.map((file) => [file.id, nanoid()]),
  );

  const data = copyDataWithRemappedCanvasFrames({
    sourceData: source.data,
    idMap,
    dataPatch,
  });

  const designValues: DesignInsert = {
    id: newId,
    title,
    description,
    projectType,
    designSystemId,
    data,
    dataOperationRevisions: "{}",
    isTemplate,
    templateMeta: templateMeta ? JSON.stringify(templateMeta) : null,
    ownerEmail,
    orgId: orgId ?? null,
    visibility: visibility ?? (orgId ? "org" : "private"),
    createdAt: now,
    updatedAt: now,
  };
  // Copy all associated files using the pre-generated IDs. `content` is
  // copied verbatim, including any `data-agent-native-node-id` attributes
  // already stamped on the source screen — those ids are NOT regenerated
  // here.
  //
  // This is a deliberate simplification, not an oversight: node ids are
  // scoped to a single file's DOM, never looked up globally. Every
  // consumer resolves ids against one screen's parsed HTML or one iframe's
  // contentDocument, and each design's screens render in their own isolated
  // iframe — so a duplicated screen sharing ids with its source design is
  // harmless. Regenerating ids here would also have to rewrite embedded CSS
  // selectors that target nodes by id. Reconsider only if a future feature
  // introduces cross-design lookups keyed on node id alone.
  //
  // Still fill in any MISSING ids for older generated/imported screens.
  const fileValues: DesignFileInsert[] = files.map((file) => ({
    id: idMap.get(file.id)!,
    designId: newId,
    filename: file.filename,
    fileType: file.fileType,
    content: annotateScreenHtmlForPersist(file.content, file.fileType),
    contentOperationSource: null,
    contentOperationRevision: null,
    contentOperationResultHash: null,
    createdAt: now,
    updatedAt: now,
  }));

  await db.transaction(async (tx) => {
    await tx.insert(schema.designs).values(designValues);
    if (fileValues.length > 0) {
      await tx.insert(schema.designFiles).values(fileValues);
    }
  });

  return { id: newId, title, fileCount: files.length };
}
