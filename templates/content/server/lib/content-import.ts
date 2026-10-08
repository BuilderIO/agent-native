import { createHash, randomUUID } from "node:crypto";

import {
  ActionContractError,
  type ActionRunContext,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import {
  deleteUploadedFile,
  type FileUploadResult,
  getActiveFileUploadProviderForRequest,
  uploadFile,
} from "@agent-native/core/file-upload";
import {
  deletePrivateBlob,
  isPrivateBlobConfiguredForRequest,
  putPrivateBlob,
} from "@agent-native/core/private-blob";
import { captureError } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";

import { resolveContentSpaceTarget } from "../../actions/_content-space-target.js";
import { isUniqueConstraintError } from "../../actions/_database-row-mutation.js";
import createDocument, {
  withinDocumentCreation,
} from "../../actions/create-document.js";
import type {
  ImportContentArgs,
  ImportContentFileInput,
  ImportContentPageResult,
  ImportContentResult,
} from "../../shared/import/api.js";
import {
  assetKey,
  finalizePlannedPage,
  importFileFormat,
  importFileKind,
  type ImportSkippedFile,
  MAX_IMPORT_MARKDOWN_BYTES,
  MAX_IMPORT_PAGE_CHARACTERS,
  normalizeImportPath,
  planMarkdownPages,
  type PlannedImportPage,
} from "../../shared/import/plan.js";
import {
  IMPORT_CONTENT_OPERATION,
  type ImportAssetRequest,
  type ImportedPage,
  type ImportedPageReport,
  type ImportPageStatus,
} from "../../shared/import/types.js";
import { docToNfm, nfmToDoc } from "../../shared/nfm.js";
import { getDb, schema } from "../db/index.js";
import { requireDocumentRequestActor } from "./document-attribution.js";
import { recordDocumentHistoryTransition } from "./document-history.js";

interface IntakeMarkdown {
  path: string;
  name: string;
  text: string;
}

interface IntakeImage {
  path: string;
  name: string;
  url: string | null;
}

export async function runContentImport(
  args: ImportContentArgs,
  ctx: ActionRunContext | undefined,
): Promise<ImportContentResult> {
  const actor = requireDocumentRequestActor(ctx);
  const db = getDb();
  const destination = await resolveImportDestination(db, actor, args);
  const { markdown, images, skipped } = intakeFiles(args.files);

  const planned: PlannedImportPage[] = [];
  for (const page of planMarkdownPages({
    markdown,
    imagePaths: new Set(images.keys()),
  })) {
    if (page.preview.content.length > MAX_IMPORT_PAGE_CHARACTERS) {
      skipped.push({
        name: markdown.find((file) => file.path === page.path)!.name,
        reason: "too-large",
        format: importFileFormat(page.path),
      });
      continue;
    }
    planned.push(page);
  }

  const usedImagePaths = new Set(
    planned.flatMap((page) =>
      page.uploads.flatMap((request) =>
        request.kind === "file" ? [request.path] : [],
      ),
    ),
  );
  for (const image of images.values()) {
    if (!usedImagePaths.has(image.path)) {
      skipped.push({
        name: image.name,
        reason: "unused-image",
        format: importFileFormat(image.path),
      });
    }
  }
  const uploads = [...usedImagePaths].map((path) => images.get(path)!.name);
  const needsServerUpload = planned.some((page) =>
    page.uploads.some((request) => request.kind === "data-url"),
  );
  const storageReady =
    (await isPrivateBlobConfiguredForRequest()) &&
    (!needsServerUpload ||
      Boolean(await getActiveFileUploadProviderForRequest()));

  if (args.dryRun) {
    return importResult({
      importId: importIdFor(actor, args.idempotencyKey),
      dryRun: true,
      destination,
      storageReady,
      pages: planned.map((page) => pageResult(page.path, page.preview, null)),
      skipped,
      uploads,
    });
  }

  if (planned.length === 0) {
    fail(nothingToImportMessage(skipped), {
      errorCode: "IMPORT_NOTHING_TO_IMPORT",
      statusCode: 400,
    });
  }
  if (!storageReady) storageUnavailable();
  for (const path of usedImagePaths) {
    if (!images.get(path)!.url) {
      fail(
        `Upload ${images.get(path)!.name} and pass its url before applying the import.`,
        { errorCode: "IMPORT_IMAGE_NOT_UPLOADED", statusCode: 400 },
      );
    }
  }

  const importId = importIdFor(actor, args.idempotencyKey);
  const requestSha256 = importRequestFingerprint(destination, markdown, images);
  const previous = await db
    .select({
      documentId: schema.documentImports.documentId,
      requestSha256: schema.documentImports.requestSha256,
      reportJson: schema.documentImports.reportJson,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documentImports)
    .leftJoin(
      schema.documents,
      eq(schema.documents.id, schema.documentImports.documentId),
    )
    .where(eq(schema.documentImports.importId, importId));
  // Checked again under the import's lock before each page is created; this
  // covers a retry whose pages all exist, which creates none.
  assertImportOpen(previous, requestSha256);
  const previousById = new Map(previous.map((row) => [row.documentId, row]));
  const pageIds = new Map(
    planned.map((page) => [page.path, importPageId(importId, page.path)]),
  );

  const dataUrlUploads = new Map<string, FileUploadResult>();
  const usedUploads = new Set<string>();
  const pages: ImportContentPageResult[] = [];
  try {
    for (const page of planned) {
      const id = pageIds.get(page.path)!;
      const earlier = previousById.get(id);
      if (earlier) {
        pages.push(
          pageResult(
            page.path,
            {
              ...page.preview,
              report: JSON.parse(earlier.reportJson) as ImportedPageReport,
            },
            id,
          ),
        );
        continue;
      }

      const embedded = page.uploads.flatMap((request) =>
        request.kind === "data-url" ? [request] : [],
      );
      for (const request of embedded) {
        const key = assetKey(request);
        if (!dataUrlUploads.has(key)) {
          dataUrlUploads.set(key, await uploadDataUrl(request, actor));
        }
      }
      const stored = finalizePlannedPage(page, {
        assetUrl: (request) =>
          request.kind === "file"
            ? (images.get(request.path)?.url ?? null)
            : (dataUrlUploads.get(assetKey(request))?.url ?? null),
        pageHref: (path) => {
          const target = pageIds.get(path);
          return target ? `/page/${target}` : null;
        },
      });
      const { report, created } = await createImportedPage({
        db,
        ctx,
        actor,
        id,
        importId,
        requestSha256,
        destination,
        source: markdown.find((file) => file.path === page.path)!,
        page: stored,
      });
      if (created) {
        for (const request of embedded) usedUploads.add(assetKey(request));
      }
      pages.push(pageResult(page.path, { ...stored, report }, id));
    }
  } catch (error) {
    throw await incompleteImportError(error, {
      db,
      importId,
      requestSha256,
      plannedPages: planned.length,
      confirmedIds: pages.flatMap((page) => (page.id ? [page.id] : [])),
    });
  } finally {
    await deleteUnusedUploads(dataUrlUploads, usedUploads);
  }

  return importResult({
    importId,
    dryRun: false,
    destination,
    storageReady,
    pages,
    skipped,
    uploads,
  });
}

/**
 * Pages are written one at a time, so a failure can stop an import partway.
 * The caller gets the import id and the pages already recorded, so it can
 * retry with the same key to finish or undo what landed. Only a contract
 * error's own message is passed on: any other error can carry driver text,
 * including page bodies, which must not reach the caller or app state.
 */
async function incompleteImportError(
  error: unknown,
  input: {
    db: ReturnType<typeof getDb>;
    importId: string;
    requestSha256: string;
    plannedPages: number;
    /** Pages this attempt created or found, for when the lookup fails too. */
    confirmedIds: string[];
  },
): Promise<unknown> {
  // The key refused this request, so importing again with it can't finish.
  if (
    isActionContractError(error) &&
    (error.errorCode === "IDEMPOTENCY_KEY_REUSED" ||
      error.errorCode === "IMPORT_PAGE_TRASHED")
  ) {
    return error;
  }
  let documentIds = input.confirmedIds;
  let documentIdsComplete = false;
  try {
    const recorded = await input.db
      .select({ documentId: schema.documentImports.documentId })
      .from(schema.documentImports)
      .where(
        and(
          eq(schema.documentImports.importId, input.importId),
          eq(schema.documentImports.requestSha256, input.requestSha256),
        ),
      );
    documentIds = recorded.map((row) => row.documentId);
    documentIdsComplete = true;
  } catch (lookupError) {
    captureError(lookupError, {
      tags: { source: "content-import" },
      extra: { importId: input.importId },
    });
  }
  if (documentIdsComplete && documentIds.length === 0) return error;

  const contract = isActionContractError(error);
  if (!contract) {
    captureError(error, {
      tags: { source: "content-import" },
      extra: { importId: input.importId },
    });
  }
  const landed = documentIdsComplete
    ? `Imported ${documentIds.length} of ${input.plannedPages} pages, then stopped`
    : `Confirmed ${documentIds.length} of ${input.plannedPages} pages, then stopped before the rest could be checked`;
  const reason = contract
    ? error.message
    : "The server hit an unexpected error.";
  return new ActionContractError(
    `${landed}: ${reason} Import again with the same idempotencyKey to finish, or undo-content-import to move the imported pages to Trash.`,
    {
      errorCode: "IMPORT_INCOMPLETE",
      statusCode: contract ? error.statusCode : 500,
      details: {
        importId: input.importId,
        documentIds,
        documentIdsComplete,
        cause: contract ? error.errorCode : "unexpected",
      },
    },
  );
}

async function resolveImportDestination(
  db: ReturnType<typeof getDb>,
  actor: string,
  args: ImportContentArgs,
): Promise<ImportContentResult["destination"]> {
  if (args.parentId) {
    if (args.spaceId || args.spaceName) {
      fail(
        "Imported pages inherit their parent page's workspace; omit spaceId and spaceName.",
        { errorCode: "IMPORT_DESTINATION_CONFLICT", statusCode: 400 },
      );
    }
    const access = await assertAccess("document", args.parentId, "editor");
    const parent = access.resource as { spaceId?: string; title?: string };
    if (!parent.spaceId) {
      throw new Error(
        `Parent document "${args.parentId}" has no Content space`,
      );
    }
    return {
      parentId: args.parentId,
      spaceId: parent.spaceId,
      title: parent.title ?? null,
    };
  }
  const target = await resolveContentSpaceTarget({
    db,
    userEmail: actor,
    spaceId: args.spaceId,
    spaceName: args.spaceName,
    provision: !args.dryRun,
  });
  return { parentId: null, spaceId: target.spaceId, title: null };
}

function intakeFiles(files: ImportContentFileInput[]) {
  const markdown: IntakeMarkdown[] = [];
  const images = new Map<string, IntakeImage>();
  const skipped: ImportSkippedFile[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const path = normalizeImportPath(file.name);
    const format = importFileFormat(file.name);
    if (!path) {
      skipped.push({ name: file.name, reason: "invalid-name", format });
      continue;
    }
    if (seen.has(path)) {
      skipped.push({ name: file.name, reason: "duplicate-name", format });
      continue;
    }
    seen.add(path);

    const kind = importFileKind(path);
    if (kind === "unsupported") {
      skipped.push({ name: file.name, reason: "unsupported-format", format });
      continue;
    }
    if (kind === "image") {
      images.set(path, {
        path,
        name: file.name,
        url: file.url ? importImageUrl(file) : null,
      });
      continue;
    }
    if (typeof file.text !== "string") {
      fail(`Pass the text of ${file.name} to import it.`, {
        errorCode: "IMPORT_FILE_TEXT_MISSING",
        statusCode: 400,
      });
    }
    if (file.text.includes("\u0000")) {
      skipped.push({ name: file.name, reason: "not-text", format });
      continue;
    }
    if (Buffer.byteLength(file.text, "utf8") > MAX_IMPORT_MARKDOWN_BYTES) {
      skipped.push({ name: file.name, reason: "too-large", format });
      continue;
    }
    markdown.push({ path, name: file.name, text: file.text });
  }
  return { markdown, images, skipped };
}

function importImageUrl(file: ImportContentFileInput): string {
  const url = file.url!.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (parsed?.protocol === "https:" || parsed?.protocol === "http:") {
    return parsed.toString();
  }
  fail(`The url for ${file.name} must be an http(s) or root-relative URL.`, {
    errorCode: "IMPORT_IMAGE_URL_INVALID",
    statusCode: 400,
  });
}

async function uploadDataUrl(
  request: Extract<ImportAssetRequest, { kind: "data-url" }>,
  ownerEmail: string,
): Promise<FileUploadResult> {
  const comma = request.dataUrl.indexOf(",");
  const header = request.dataUrl.slice(0, comma);
  const payload = request.dataUrl.slice(comma + 1);
  const data = /;base64$/i.test(header)
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  const extension = request.mediaType.split("/")[1]?.split("+")[0] ?? "img";
  const uploaded = await uploadFile({
    data,
    filename: `imported-image.${extension}`,
    mimeType: request.mediaType,
    ownerEmail,
  });
  if (!uploaded?.url) storageUnavailable();
  return uploaded;
}

/**
 * Embedded images this attempt uploaded for a page it didn't create, because
 * the page failed or another attempt with the key created it first. Nothing
 * points at them, so they go; a failed delete is logged, never thrown over the
 * import's own result.
 */
async function deleteUnusedUploads(
  uploads: ReadonlyMap<string, FileUploadResult>,
  used: ReadonlySet<string>,
): Promise<void> {
  for (const [key, upload] of uploads) {
    if (used.has(key)) continue;
    try {
      const deleted = await deleteUploadedFile(upload.provider, {
        url: upload.url,
        id: upload.id,
      });
      if (!deleted) {
        console.error(
          `[content] Unused imported image ${upload.url} was not deleted: the provider kept it`,
        );
      }
    } catch (error) {
      console.error(
        `[content] Unused imported image ${upload.url} was not deleted:`,
        error,
      );
    }
  }
}

/**
 * Creates one imported page. Its History entry and provenance row are written
 * inside the transaction that inserts the page, so a page never exists
 * without the record Undo and retries look it up by. Returns the report that
 * was recorded, which is another attempt's when that attempt created the page
 * first (`created: false`).
 */
async function createImportedPage(input: {
  db: ReturnType<typeof getDb>;
  ctx: ActionRunContext | undefined;
  actor: string;
  id: string;
  importId: string;
  requestSha256: string;
  destination: ImportContentResult["destination"];
  source: IntakeMarkdown;
  page: ImportedPage;
}): Promise<{ report: ImportedPageReport; created: boolean }> {
  const { db, ctx, actor, id, page, source } = input;
  const sourceSha256 = sha256(source.text);
  const original = await putPrivateBlob({
    data: Buffer.from(source.text, "utf8"),
    filename: source.path.split("/").pop(),
    mimeType: "text/markdown",
    ownerEmail: actor,
    // Unique per attempt, so a concurrent retry cannot overwrite the original
    // the winning attempt records.
    key: `content-imports/${input.importId}/${id}/${randomUUID()}.md`,
    metadata: {
      appId: "content",
      resourceType: "document-import",
      resourceId: id,
      importId: input.importId,
    },
  });
  if (!original) storageUnavailable();
  const originalBlob = JSON.stringify(original);

  const agentCaller =
    ctx?.caller === "tool" ||
    ctx?.caller === "mcp" ||
    ctx?.caller === "webmcp" ||
    ctx?.caller === "a2a";
  try {
    await withinDocumentCreation(
      id,
      async (tx) => {
        // Attempts with the same key and undo-content-import serialize here, so
        // one with different files finds the first one's fingerprint, and a
        // page is never added to an import Undo has moved to Trash.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.importId}, 0::bigint))`,
        );
        assertImportOpen(
          await tx
            .select({
              requestSha256: schema.documentImports.requestSha256,
              trashedAt: schema.documents.trashedAt,
            })
            .from(schema.documentImports)
            .leftJoin(
              schema.documents,
              eq(schema.documents.id, schema.documentImports.documentId),
            )
            .where(eq(schema.documentImports.importId, input.importId)),
          input.requestSha256,
        );
        const [created] = await tx
          .select({
            ownerEmail: schema.documents.ownerEmail,
            title: schema.documents.title,
            content: schema.documents.content,
            description: schema.documents.description,
            icon: schema.documents.icon,
            parentId: schema.documents.parentId,
            spaceId: schema.documents.spaceId,
            bodyRevision: schema.documents.bodyRevision,
          })
          .from(schema.documents)
          .where(eq(schema.documents.id, id))
          .limit(1);
        const now = new Date().toISOString();
        const state = { title: created.title, content: created.content };
        await recordDocumentHistoryTransition({
          db: tx,
          ownerEmail: created.ownerEmail,
          documentId: id,
          before: state,
          after: state,
          afterBodyRevision: created.bodyRevision,
          cause: {
            ctx,
            groupId: `import:${input.importId}:${id}`,
            groupKind: "operation",
            actorKind: agentCaller
              ? "agent"
              : ctx?.caller === "automation"
                ? "automation"
                : "human",
            skipBeforeCheckpoint: true,
            operation: IMPORT_CONTENT_OPERATION,
          },
          now,
        });
        await tx.insert(schema.documentImports).values({
          documentId: id,
          ownerEmail: created.ownerEmail,
          importId: input.importId,
          requestSha256: input.requestSha256,
          sourceName: source.name,
          sourceFormat: "markdown",
          sourceBytes: Buffer.byteLength(source.text, "utf8"),
          sourceSha256,
          originalBlob,
          importedTitle: created.title,
          importedStateSha256: importedStateFingerprint(created),
          reportJson: JSON.stringify(page.report),
          createdAt: now,
        });
      },
      async () =>
        createDocument.run(
          {
            id,
            title: page.title,
            content: page.content,
            preserveLeadingTitleHeading: true,
            ...(page.description ? { description: page.description } : {}),
            ...(page.icon ? { icon: page.icon } : {}),
            ...(input.destination.parentId
              ? { parentId: input.destination.parentId }
              : { spaceId: input.destination.spaceId }),
            reuseLabels: [],
          },
          ctx,
        ),
    );
    return { report: page.report, created: true };
  } catch (error) {
    const [recorded] = await db
      .select({
        requestSha256: schema.documentImports.requestSha256,
        originalBlob: schema.documentImports.originalBlob,
        reportJson: schema.documentImports.reportJson,
      })
      .from(schema.documentImports)
      .where(eq(schema.documentImports.documentId, id))
      .limit(1)
      .catch((lookupError: unknown) => {
        // Without the record there's no telling whether another attempt kept
        // this original, so it stays, and the first failure is reported.
        captureError(lookupError, {
          tags: { source: "content-import" },
          extra: { importId: input.importId, documentId: id },
        });
        throw error;
      });
    // This attempt's page committed and only a step after it failed. The page
    // is live and points at this attempt's uploads, so it counts as created.
    if (recorded?.originalBlob === originalBlob) {
      captureError(error, {
        tags: { source: "content-import" },
        extra: { importId: input.importId, documentId: id },
      });
      return { report: page.report, created: true };
    }
    await deletePrivateBlob(original).catch((cleanupError: unknown) => {
      console.error(
        `[content] Original import file ${original.id} for unsaved page ${id} was not deleted:`,
        cleanupError,
      );
    });
    // Another attempt with this key created the page first.
    if (!recorded || !isUniqueConstraintError(error)) throw error;
    if (recorded.requestSha256 !== input.requestSha256) idempotencyKeyReused();
    return {
      report: JSON.parse(recorded.reportJson) as ImportedPageReport,
      created: false,
    };
  }
}

/**
 * Fingerprint of what Undo protects: the title, the body as the editor stores
 * it, the description, the icon, and where the page lives. Opening an imported
 * page without editing it leaves the fingerprint unchanged.
 */
export function importedStateFingerprint(page: {
  title: string;
  content: string;
  description: string;
  icon: string | null;
  parentId: string | null;
  spaceId: string | null;
}): string {
  return sha256(
    JSON.stringify([
      page.title,
      docToNfm(nfmToDoc(page.content)),
      page.description,
      page.icon,
      page.parentId,
      page.spaceId,
    ]),
  );
}

/**
 * What a retry with the same key must repeat: the destination and every file
 * by name, plus each Markdown file's text. Image URLs are left out because a
 * retry uploads the images again.
 */
function importRequestFingerprint(
  destination: ImportContentResult["destination"],
  markdown: IntakeMarkdown[],
  images: Map<string, IntakeImage>,
): string {
  return sha256(
    JSON.stringify({
      parentId: destination.parentId,
      spaceId: destination.spaceId,
      markdown: [...markdown]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((file) => [file.path, sha256(file.text)]),
      // The url stands in for the image's bytes, so a retry sends the same
      // upload's url rather than uploading the image again.
      images: [...images.values()]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((image) => [image.path, image.url]),
    }),
  );
}

/**
 * Refuses a request its key can no longer serve: different files from the
 * key's first request, or pages from the import in Trash. Undo keeps the
 * import's records, so a retry would otherwise report pages sitting in Trash
 * as imported.
 */
function assertImportOpen(
  records: Array<{ requestSha256: string; trashedAt: string | null }>,
  requestSha256: string,
): void {
  if (records.some((record) => record.requestSha256 !== requestSha256)) {
    idempotencyKeyReused();
  }
  if (records.some((record) => record.trashedAt)) {
    fail(
      "Pages from this import are in Trash, so it can't continue. Restore them from Trash, or import again with a new idempotencyKey.",
      { errorCode: "IMPORT_PAGE_TRASHED", statusCode: 409 },
    );
  }
}

function idempotencyKeyReused(): never {
  fail(
    "This idempotencyKey was already used for a different import. Use a new key.",
    { errorCode: "IDEMPOTENCY_KEY_REUSED", statusCode: 409 },
  );
}

function pageResult(
  path: string,
  page: ImportedPage,
  id: string | null,
): ImportContentPageResult {
  return {
    id,
    urlPath: id ? `/page/${id}` : null,
    sourceName: path,
    title: page.title,
    titleSource: page.titleSource,
    status: page.report.status,
    notes: page.report.notes,
    coverage: page.report.coverage,
  };
}

function importResult(
  input: Omit<ImportContentResult, "counts" | "message">,
): ImportContentResult {
  const count = (status: ImportPageStatus) =>
    input.pages.filter((page) => page.status === status).length;
  const counts = {
    pages: input.pages.length,
    preserved: count("preserved"),
    converted: count("converted"),
    lost: count("lost"),
    skipped: input.skipped.length,
  };
  return { ...input, counts, message: resultMessage(input, counts) };
}

function resultMessage(
  input: Omit<ImportContentResult, "counts" | "message">,
  counts: ImportContentResult["counts"],
): string {
  if (counts.pages === 0) return nothingToImportMessage(input.skipped);
  const verb = input.dryRun ? "Would import" : "Imported";
  const parts = [
    `${verb} ${counts.pages} page${counts.pages === 1 ? "" : "s"}`,
  ];
  if (counts.lost > 0) {
    parts.push(
      `${counts.lost} with content that did not come across (see each page's lost notes)`,
    );
  }
  if (counts.skipped > 0) {
    parts.push(
      `${counts.skipped} file${counts.skipped === 1 ? "" : "s"} skipped`,
    );
  }
  if (input.dryRun && !input.storageReady) {
    parts.push(
      "file storage is not set up, so applying will fail until it is connected in Settings",
    );
  }
  return `${parts.join("; ")}.`;
}

function nothingToImportMessage(skipped: ImportSkippedFile[]): string {
  const unsupported = skipped.filter(
    (file) => file.reason === "unsupported-format",
  );
  if (unsupported.length > 0) {
    return `Nothing to import: ${unsupported.map((file) => file.name).join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported yet. Content imports Markdown (.md, .markdown, .mdx) files and the images they use.`;
  }
  return "Nothing to import: no readable Markdown files were given.";
}

function storageUnavailable(): never {
  fail(
    "File storage isn't set up for this workspace, so the import can't keep the original file or upload images. Connect storage in Settings → File uploads, then import again.",
    { errorCode: "IMPORT_STORAGE_UNAVAILABLE", statusCode: 503 },
  );
}

function importIdFor(actor: string, idempotencyKey?: string): string {
  return idempotencyKey
    ? `import-${sha256(`${actor}\u0000${idempotencyKey}`).slice(0, 32)}`
    : `import-${randomUUID()}`;
}

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Stable page id per import and file, so a retried import finds its pages. */
function importPageId(importId: string, path: string): string {
  const bytes = createHash("sha256")
    .update(`${importId}\u0000${path}`)
    .digest();
  let id = "";
  for (const byte of bytes.subarray(0, 12)) {
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return id;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
