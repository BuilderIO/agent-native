import { createHash, randomUUID } from "node:crypto";

import {
  ActionContractError,
  type ActionRunContext,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
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
import {
  deletePrivateMedia,
  PrivateMediaStorageUnavailableError,
  PrivateMediaValidationError,
  putPrivateMedia,
} from "@agent-native/core/private-media";
import { captureError } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { resolveContentSpaceAccess } from "../../actions/_content-space-access.js";
import { resolveContentSpaceTarget } from "../../actions/_content-space-target.js";
import createDocument, {
  withinDocumentCreation,
} from "../../actions/create-document.js";
import type {
  ImportContentArgs,
  ImportContentDatabaseResult,
  ImportContentFileInput,
  ImportContentPageResult,
  ImportContentResult,
} from "../../shared/import/api.js";
import { expiringFileLabel } from "../../shared/import/expiring-links.js";
import {
  assetKey,
  dataUrlBytes,
  finalizePlannedPage,
  importAttachmentMediaType,
  importFileFormat,
  importFileKind,
  importImageMediaType,
  type ImportSkippedFile,
  isImportImageMediaType,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_IMAGE_BYTES,
  MAX_IMPORT_MARKDOWN_BYTES,
  MAX_IMPORT_PAGE_CHARACTERS,
  MAX_IMPORT_TOTAL_MARKDOWN_BYTES,
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
import { privateMediaPath } from "../../shared/private-media.js";
import { getDb, schema } from "../db/index.js";
import { requireDocumentRequestActor } from "./document-attribution.js";
import { recordDocumentHistoryTransition } from "./document-history.js";

interface IntakeMarkdown {
  path: string;
  name: string;
  text: string;
}

const EXPIRING_FILES_BUDGET = { ms: 60_000, bytes: 100 * 1024 * 1024 };

interface ExpiringFilesBudget {
  deadline: number;
  bytes: number;
}

interface IntakeAsset {
  path: string;
  name: string;
  kind: "image" | "attachment";
  url: string | null;
}

export async function runContentImport(
  args: ImportContentArgs,
  ctx: ActionRunContext | undefined,
): Promise<ImportContentResult> {
  const actor = requireDocumentRequestActor(ctx);
  const db = getDb();
  const destination = await resolveImportDestination(db, actor, args);
  const { markdown, assets, skipped } = intakeFiles(args.files);
  const markdownBytes = markdown.reduce(
    (total, file) => total + Buffer.byteLength(file.text, "utf8"),
    0,
  );
  if (markdownBytes > MAX_IMPORT_TOTAL_MARKDOWN_BYTES) {
    fail(
      `These files hold ${megabytes(markdownBytes)} MB of Markdown, more than the ${megabytes(MAX_IMPORT_TOTAL_MARKDOWN_BYTES)} MB one import takes. Import them in smaller groups, such as one top-level page and its subpages at a time.`,
      { errorCode: "IMPORT_TOO_LARGE", statusCode: 413 },
    );
  }

  const assetPaths = (kind: IntakeAsset["kind"]) =>
    new Set(
      [...assets.values()]
        .filter((asset) => asset.kind === kind)
        .map((asset) => asset.path),
    );
  const {
    pages: planned,
    tooLarge,
    notion,
  } = planMarkdownPages({
    markdown,
    imagePaths: assetPaths("image"),
    attachmentPaths: assetPaths("attachment"),
  });
  for (const path of tooLarge) {
    skipped.push({
      name: sourceFile(markdown, path).name,
      reason: "too-large",
      format: importFileFormat(path),
    });
  }

  const usedAssetPaths = new Set(
    planned.flatMap((page) =>
      page.uploads.flatMap((request) =>
        request.kind === "file" ? [request.path] : [],
      ),
    ),
  );
  for (const asset of assets.values()) {
    if (usedAssetPaths.has(asset.path)) continue;
    if (notion?.databaseFiles.has(asset.path)) continue;
    skipped.push({
      name: asset.name,
      reason: asset.kind === "image" ? "unused-image" : "unused-file",
      format: importFileFormat(asset.path),
    });
  }
  const usedAssets = [...usedAssetPaths].flatMap((path) => {
    const asset = assets.get(path);
    return asset ? [asset] : [];
  });
  const uploads = usedAssets.map((asset) => asset.name);
  const databases: ImportContentDatabaseResult[] = (
    notion?.databases ?? []
  ).map((database) => ({
    name: database.name,
    sourceName: assets.get(database.csvPath)?.name ?? database.csvPath,
    rows: database.rows.length,
    csvKept: usedAssetPaths.has(database.keptCsvPath),
  }));
  const needsFileStorage =
    usedAssets.some((asset) => asset.kind === "attachment") ||
    planned.some((page) => page.uploads.some(isSignedPdf));
  const storageReady =
    (await isPrivateBlobConfiguredForRequest()) &&
    (!needsFileStorage ||
      Boolean(await getActiveFileUploadProviderForRequest()));

  if (args.dryRun) {
    const importId = importIdFor(actor, args.idempotencyKey);
    const earlier = await earlierImports(db, actor, importId, markdown);
    return importResult({
      importId,
      dryRun: true,
      destination,
      storageReady,
      pages: planned.map((page) =>
        pageResult(page, page.preview, null, {
          alreadyImportedAt:
            earlier.get(sha256(sourceFile(markdown, page.path).text)) ?? null,
        }),
      ),
      skipped,
      databases,
      uploads,
    });
  }

  if (planned.length === 0) {
    fail(nothingToImportMessage(skipped, databases), {
      errorCode: "IMPORT_NOTHING_TO_IMPORT",
      statusCode: 400,
    });
  }
  if (!storageReady) storageUnavailable();
  for (const asset of usedAssets) {
    if (!asset.url) {
      fail(
        `Upload ${asset.name} and pass its url before applying the import.`,
        { errorCode: "IMPORT_IMAGE_NOT_UPLOADED", statusCode: 400 },
      );
    }
  }

  const importId = importIdFor(actor, args.idempotencyKey);
  const requestSha256 = importRequestFingerprint(destination, markdown, assets);
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

  const serverUploads = new Map<string, ServerUpload | null>();
  const usedUploads = new Set<string>();
  const expiringFiles: ExpiringFilesBudget = {
    deadline: Date.now() + EXPIRING_FILES_BUDGET.ms,
    bytes: EXPIRING_FILES_BUDGET.bytes,
  };
  const pages: ImportContentPageResult[] = [];
  let mediaOrgId: string | null | undefined;
  const importedPagesOrg = async () => {
    if (mediaOrgId === undefined) {
      mediaOrgId = await importedPagesOrgId(destination);
    }
    return mediaOrgId;
  };
  try {
    // Every new page is filled in and measured before any is created: image
    // urls and page links only exist now, and can make a page longer than its
    // preview, so a page that no longer fits stops the import before it starts.
    const stored = new Map<string, ImportedPage>();
    for (const page of planned) {
      if (previousById.has(pageIds.get(page.path)!)) continue;
      for (const request of page.uploads) {
        if (request.kind === "file") continue;
        const key = assetKey(request);
        if (serverUploads.has(key)) continue;
        const owner = { ownerEmail: actor, orgId: await importedPagesOrg() };
        serverUploads.set(
          key,
          request.kind === "data-url"
            ? await uploadDataUrl(request, {
                ...owner,
                sourceName: sourceFile(markdown, page.path).name,
              })
            : await uploadExpiringFile(request, owner, expiringFiles),
        );
      }
      const filled = finalizePlannedPage(page, {
        assetUrl: (request) =>
          request.kind === "file"
            ? (assets.get(request.path)?.url ?? null)
            : (serverUploads.get(assetKey(request))?.url ?? null),
        pageHref: (path) => {
          const target = pageIds.get(path);
          return target ? `/page/${target}` : null;
        },
      });
      if (filled.content.length > MAX_IMPORT_PAGE_CHARACTERS) {
        fail(
          `${sourceFile(markdown, page.path).name} is ${filled.content.length.toLocaleString("en-US")} characters once its images and links are filled in, more than the ${MAX_IMPORT_PAGE_CHARACTERS.toLocaleString("en-US")} a page can hold. Split it into smaller files, then import again.`,
          { errorCode: "IMPORT_PAGE_TOO_LARGE", statusCode: 413 },
        );
      }
      stored.set(page.path, filled);
    }

    for (const page of planned) {
      const id = pageIds.get(page.path)!;
      const earlier = previousById.get(id);
      if (earlier) {
        pages.push(
          pageResult(
            page,
            {
              ...page.preview,
              report: JSON.parse(earlier.reportJson) as ImportedPageReport,
            },
            id,
          ),
        );
        continue;
      }

      const filled = stored.get(page.path)!;
      const keepUploads = () => {
        for (const request of page.uploads) {
          if (request.kind !== "file") usedUploads.add(assetKey(request));
        }
      };
      const { report, created } = await createImportedPage({
        db,
        ctx,
        actor,
        id,
        importId,
        requestSha256,
        destination,
        parentId:
          (page.parentPath && pageIds.get(page.parentPath)) ||
          destination.parentId,
        sourceFormat: notion ? "notion-export" : "markdown",
        source: sourceFile(markdown, page.path),
        page: filled,
        keepUploads,
      });
      if (created) keepUploads();
      pages.push(pageResult(page, { ...filled, report }, id));
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
    await deleteUnusedUploads(serverUploads, usedUploads);
  }

  return importResult({
    importId,
    dryRun: false,
    destination,
    storageReady,
    pages,
    skipped,
    databases,
    uploads,
  });
}

async function earlierImports(
  db: ReturnType<typeof getDb>,
  actor: string,
  importId: string,
  markdown: IntakeMarkdown[],
): Promise<Map<string, string>> {
  const hashes = [...new Set(markdown.map((file) => sha256(file.text)))];
  if (hashes.length === 0) return new Map();
  const rows = await db
    .select({
      sourceSha256: schema.documentImports.sourceSha256,
      createdAt: schema.documentImports.createdAt,
    })
    .from(schema.documentImports)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.documentImports.documentId),
    )
    .where(
      and(
        inArray(schema.documentImports.sourceSha256, hashes),
        ne(schema.documentImports.importId, importId),
        isNull(schema.documents.trashedAt),
        sql`lower(${schema.documents.createdBy}) = ${actor}`,
      ),
    );
  const latest = new Map<string, string>();
  for (const row of rows) {
    const seen = latest.get(row.sourceSha256);
    if (!seen || row.createdAt > seen) {
      latest.set(row.sourceSha256, row.createdAt);
    }
  }
  return latest;
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
  const contract = isActionContractError(error);
  if (!contract) {
    captureError(error, {
      tags: { source: "content-import" },
      extra: { importId: input.importId },
    });
  }
  if (documentIdsComplete && documentIds.length === 0) {
    return contract
      ? error
      : new Error(
          "The server hit an unexpected error before any page was imported.",
        );
  }
  const landed = documentIdsComplete
    ? `Imported ${documentIds.length} of ${input.plannedPages} pages, then stopped`
    : `Confirmed ${documentIds.length} of ${input.plannedPages} pages, then stopped before the rest could be checked`;
  const reason = contract
    ? error.message
    : "The server hit an unexpected error.";
  // The same key carries the same image, so importing again with it can't
  // get past a bad one.
  const next =
    contract && error.errorCode === "IMPORT_IMAGE_INVALID"
      ? "Use undo-content-import to move the imported pages to Trash, then import the fixed files with a new idempotencyKey."
      : "Import again with the same idempotencyKey to finish, or undo-content-import to move the imported pages to Trash.";
  return new ActionContractError(`${landed}: ${reason} ${next}`, {
    errorCode: "IMPORT_INCOMPLETE",
    statusCode: contract ? error.statusCode : 500,
    details: {
      importId: input.importId,
      documentIds,
      documentIdsComplete,
      cause: contract ? error.errorCode : "unexpected",
    },
  });
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
  const assets = new Map<string, IntakeAsset>();
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
      // which file it means; every file with it is left out instead.
      const asset = assets.get(path);
      if (asset) {
        assets.delete(path);
        skipped.push({
          name: asset.name,
          reason: "duplicate-name",
          format: importFileFormat(asset.name),
        });
      }
      skipped.push({ name: file.name, reason: "duplicate-name", format });
      continue;
    }
    seen.add(path);

    const kind = importFileKind(path);
    if (kind === "unsupported") {
      skipped.push({ name: file.name, reason: "unsupported-format", format });
      continue;
    }
    if (kind === "image" || kind === "attachment") {
      assets.set(path, {
        path,
        name: file.name,
        kind,
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
  return { markdown, assets, skipped };
}

function sourceFile(markdown: IntakeMarkdown[], path: string): IntakeMarkdown {
  return markdown.find((file) => file.path === path)!;
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

type ServerUpload =
  | { url: string; mediaId: string }
  | { url: string; file: FileUploadResult };

interface UploadOwner {
  ownerEmail: string;
  orgId: string | null;
}

/**
 * The workspace the imported pages join, as create-document picks it, so
 * their embedded images are filed under the same one.
 */
async function importedPagesOrgId(
  destination: ImportContentResult["destination"],
): Promise<string | null> {
  if (destination.parentId) {
    const access = await assertAccess(
      "document",
      destination.parentId,
      "editor",
    );
    return (access.resource as { orgId?: string | null }).orgId ?? null;
  }
  const access = await resolveContentSpaceAccess(
    destination.spaceId,
    "contributor",
  );
  return access.space.orgId;
}

/**
 * Stores an embedded image privately. Nothing links it yet, so only the
 * importer can load it until create-document binds it to the page whose body
 * links it, and the page's readers can load it from then on.
 */
async function uploadDataUrl(
  request: Extract<ImportAssetRequest, { kind: "data-url" }>,
  input: UploadOwner & { sourceName: string },
): Promise<ServerUpload> {
  const data = dataUrlBytes(request.dataUrl);
  // The preview reports an embedded image with no payload, or one that won't
  // decode, as missing, so only a planning bug sends one here.
  if (!data) {
    throw new Error(`An embedded ${request.mediaType} image won't decode`);
  }
  const extension = request.mediaType.split("/")[1]?.split("+")[0] ?? "img";
  try {
    const media = await putPrivateMedia({
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
      data,
      mimeType: request.mediaType,
      filename: `imported-image.${extension}`,
    });
    return { mediaId: media.id, url: privateMediaPath(media.id) };
  } catch (error) {
    if (error instanceof PrivateMediaStorageUnavailableError) {
      storageUnavailable();
    }
    // The preview checks the type and size but not the bytes, which must be
    // the image the data URL says they are.
    if (error instanceof PrivateMediaValidationError) {
      fail(
        `An embedded image in ${input.sourceName} can't be stored: ${error.message} Replace or remove it, then import again.`,
        { errorCode: "IMPORT_IMAGE_INVALID", statusCode: error.statusCode },
      );
    }
    throw error;
  }
}

async function uploadExpiringFile(
  request: Extract<ImportAssetRequest, { kind: "remote" }>,
  owner: UploadOwner,
  budget: ExpiringFilesBudget,
): Promise<ServerUpload | null> {
  const filename = expiringFileLabel(request.url);
  const fetched = await fetchExpiringFile(request.url, filename, budget);
  if (!fetched) return null;
  const { data, mimeType } = fetched;
  try {
    if (mimeType === "application/pdf") {
      const file = await uploadFile({
        data,
        filename,
        mimeType,
        ownerEmail: owner.ownerEmail,
      });
      return file?.url ? { url: file.url, file } : null;
    }
    const media = await putPrivateMedia({ ...owner, data, mimeType, filename });
    return { mediaId: media.id, url: privateMediaPath(media.id) };
  } catch (error) {
    if (error instanceof PrivateMediaStorageUnavailableError) {
      storageUnavailable();
    }
    console.error(
      `[content] Imported file ${filename} could not be stored:`,
      error instanceof Error ? error.name : "unknown error",
    );
    return null;
  }
}

async function fetchExpiringFile(
  url: string,
  filename: string,
  budget: ExpiringFilesBudget,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0 || budget.bytes <= 0) return null;
  try {
    const response = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(Math.min(30_000, remaining)) },
      { httpsOnly: true, maxRedirects: 3 },
    );
    const declared =
      (response.headers.get("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    const mimeType = keptFileType(declared)
      ? declared
      : (importImageMediaType(filename) ??
        (importAttachmentMediaType(filename) === "application/pdf"
          ? "application/pdf"
          : null));
    const data =
      response.ok && mimeType
        ? await readAtMost(
            response,
            Math.min(
              mimeType === "application/pdf"
                ? MAX_IMPORT_ATTACHMENT_BYTES
                : MAX_IMPORT_IMAGE_BYTES,
              budget.bytes,
            ),
          )
        : null;
    if (!data || !mimeType) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    budget.bytes -= data.byteLength;
    return { data, mimeType };
  } catch (error) {
    console.error(
      `[content] Imported file ${filename} could not be fetched from its signed link:`,
      error instanceof Error ? error.name : "unknown error",
    );
    return null;
  }
}

function isSignedPdf(request: ImportAssetRequest): boolean {
  return (
    request.kind === "remote" &&
    importAttachmentMediaType(expiringFileLabel(request.url)) ===
      "application/pdf"
  );
}

function keptFileType(mimeType: string): boolean {
  return isImportImageMediaType(mimeType) || mimeType === "application/pdf";
}

async function readAtMost(
  response: Response,
  limit: number,
): Promise<Uint8Array | null> {
  if (Number(response.headers.get("content-length")) > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function deleteUnusedUploads(
  uploads: ReadonlyMap<string, ServerUpload | null>,
  used: ReadonlySet<string>,
): Promise<void> {
  for (const [key, upload] of uploads) {
    if (!upload || used.has(key)) continue;
    try {
      const deleted =
        "mediaId" in upload
          ? await deletePrivateMedia(upload.mediaId)
          : await deleteUploadedFile(upload.file.provider, {
              url: upload.file.url,
              ...(upload.file.id ? { id: upload.file.id } : {}),
            });
      if (!deleted) {
        console.error(
          `[content] Unused imported file ${upload.url} was not deleted: ${"mediaId" in upload ? "it was already gone" : "the provider kept it"}`,
        );
      }
    } catch (error) {
      console.error(
        `[content] Unused imported file ${upload.url} was not deleted:`,
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
  parentId: string | null;
  sourceFormat: "markdown" | "notion-export";
  source: IntakeMarkdown;
  page: ImportedPage;
  keepUploads: () => void;
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
  let recordedHere = false;
  let failure: unknown;
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
          sourceFormat: input.sourceFormat,
          sourceBytes: Buffer.byteLength(source.text, "utf8"),
          sourceSha256,
          originalBlob,
          importedTitle: created.title,
          importedStateSha256: importedStateFingerprint(created),
          reportJson: JSON.stringify(page.report),
          createdAt: now,
        });
        recordedHere = true;
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
            ...(input.parentId
              ? { parentId: input.parentId }
              : { spaceId: input.destination.spaceId }),
            reuseLabels: [],
          },
          ctx,
        ),
    );
    if (recordedHere) return { report: page.report, created: true };
  } catch (error) {
    failure = error;
  }
  // The page wasn't saved here, or create-document replayed one another
  // attempt with this key created first, which it does without an error.
  // Read the whole import, as the locked path does: page ids come from the
  // import id, so this page's record is among them.
  const records = await db
    .select({
      documentId: schema.documentImports.documentId,
      requestSha256: schema.documentImports.requestSha256,
      originalBlob: schema.documentImports.originalBlob,
      reportJson: schema.documentImports.reportJson,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documentImports)
    .leftJoin(
      schema.documents,
      eq(schema.documents.id, schema.documentImports.documentId),
    )
    .where(eq(schema.documentImports.importId, input.importId))
    .catch((lookupError: unknown) => {
      // Without the record there's no telling whether this attempt's page
      // was saved, or another attempt kept this original, so the original
      // and the page's images stay, and the first failure is reported.
      input.keepUploads();
      captureError(lookupError, {
        tags: { source: "content-import" },
        extra: { importId: input.importId, documentId: id },
      });
      throw failure ?? lookupError;
    });
  const recorded = records.find((record) => record.documentId === id);
  // This attempt's page committed and only a step after it failed. The page
  // is live and points at this attempt's uploads, so it counts as created.
  if (recorded?.originalBlob === originalBlob) {
    captureError(failure, {
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
  if (!recorded) {
    throw failure ?? new Error(`Page ${id} exists without its import record.`);
  }
  // Another attempt with this key created the page first, however this one
  // learned of it, and pages from the import may have gone to Trash since.
  assertImportOpen(records, input.requestSha256);
  return {
    report: JSON.parse(recorded.reportJson) as ImportedPageReport,
    created: false,
  };
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

function importRequestFingerprint(
  destination: ImportContentResult["destination"],
  markdown: IntakeMarkdown[],
  assets: Map<string, IntakeAsset>,
): string {
  return sha256(
    JSON.stringify({
      parentId: destination.parentId,
      spaceId: destination.spaceId,
      markdown: [...markdown]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((file) => [file.path, sha256(file.text)]),
      images: [...assets.values()]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((asset) => [asset.path, asset.url]),
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
  planned: PlannedImportPage,
  page: ImportedPage,
  id: string | null,
  options: { alreadyImportedAt?: string | null } = {},
): ImportContentPageResult {
  return {
    id,
    urlPath: id ? `/page/${id}` : null,
    sourceName: planned.path,
    parentSourceName: planned.parentPath,
    alreadyImportedAt: options.alreadyImportedAt ?? null,
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
  if (counts.pages === 0) {
    return nothingToImportMessage(input.skipped, input.databases);
  }
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
  if (input.databases.length > 0) {
    parts.push(
      `${input.databases.length} Notion database${input.databases.length === 1 ? "" : "s"} not imported yet`,
    );
  }
  if (input.dryRun && !input.storageReady) {
    parts.push(
      "file storage is not set up, so applying will fail until it is connected in Settings",
    );
  }
  return `${parts.join("; ")}.`;
}

function nothingToImportMessage(
  skipped: ImportSkippedFile[],
  databases: ImportContentDatabaseResult[],
): string {
  if (databases.length > 0) {
    return `Nothing to import: the export holds only ${databases.map((database) => database.name).join(", ")}, ${databases.length === 1 ? "a Notion database" : "Notion databases"}, which Content doesn't import yet.`;
  }
  const unsupported = skipped.filter(
    (file) => file.reason === "unsupported-format",
  );
  if (unsupported.length > 0) {
    return `Nothing to import: ${unsupported.map((file) => file.name).join(", ")} ${unsupported.length === 1 ? "is" : "are"} not supported yet. Content imports Markdown (.md, .markdown, .mdx) files with the images, PDFs and CSVs they use, including a Notion export.`;
  }
  return "Nothing to import: no readable Markdown files were given.";
}

function storageUnavailable(): never {
  fail(
    "File storage isn't set up for this workspace, so the import can't keep the original file or upload images. Connect storage in Settings → File uploads, then import again.",
    { errorCode: "IMPORT_STORAGE_UNAVAILABLE", statusCode: 503 },
  );
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
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
