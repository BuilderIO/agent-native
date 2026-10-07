import { createHash, randomUUID } from "node:crypto";

import { type ActionRunContext, fail } from "@agent-native/core/action";
import {
  getActiveFileUploadProviderForRequest,
  uploadFile,
} from "@agent-native/core/file-upload";
import {
  deletePrivateBlob,
  isPrivateBlobConfiguredForRequest,
  putPrivateBlob,
} from "@agent-native/core/private-blob";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";

import { resolveContentSpaceTarget } from "../../actions/_content-space-target.js";
import { isUniqueConstraintError } from "../../actions/_database-row-mutation.js";
import createDocument from "../../actions/create-document.js";
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
  const pageIds = new Map(
    planned.map((page) => [page.path, importPageId(importId, page.path)]),
  );
  const previous = await db
    .select({
      documentId: schema.documentImports.documentId,
      sourceSha256: schema.documentImports.sourceSha256,
    })
    .from(schema.documentImports)
    .where(eq(schema.documentImports.importId, importId));
  const previousById = new Map(previous.map((row) => [row.documentId, row]));

  const dataUrlUploads = new Map<string, string>();
  const pages: ImportContentPageResult[] = [];
  for (const page of planned) {
    const source = markdown.find((file) => file.path === page.path)!;
    const sourceSha256 = sha256(source.text);
    const id = pageIds.get(page.path)!;
    const earlier = previousById.get(id);
    if (earlier && earlier.sourceSha256 !== sourceSha256) {
      fail(
        "This idempotencyKey was already used for a different import. Use a new key.",
        { errorCode: "IDEMPOTENCY_KEY_REUSED", statusCode: 409 },
      );
    }

    for (const request of page.uploads) {
      if (request.kind !== "data-url") continue;
      const key = assetKey(request);
      if (!dataUrlUploads.has(key)) {
        dataUrlUploads.set(key, await uploadDataUrl(request, actor));
      }
    }
    const stored = finalizePlannedPage(page, {
      assetUrl: (request) =>
        request.kind === "file"
          ? (images.get(request.path)?.url ?? null)
          : (dataUrlUploads.get(assetKey(request)) ?? null),
      pageHref: (path) => {
        const target = pageIds.get(path);
        return target ? `/page/${target}` : null;
      },
    });

    if (!earlier) {
      await createImportedPage({
        db,
        ctx,
        actor,
        id,
        importId,
        destination,
        source,
        sourceSha256,
        page: stored,
      });
    }
    pages.push(pageResult(page.path, stored, id));
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
): Promise<string> {
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
  return uploaded.url;
}

async function createImportedPage(input: {
  db: ReturnType<typeof getDb>;
  ctx: ActionRunContext | undefined;
  actor: string;
  id: string;
  importId: string;
  destination: ImportContentResult["destination"];
  source: IntakeMarkdown;
  sourceSha256: string;
  page: ImportedPage;
}) {
  const { db, ctx, actor, id, page, source } = input;
  const original = await putPrivateBlob({
    data: Buffer.from(source.text, "utf8"),
    filename: source.path.split("/").pop(),
    mimeType: "text/markdown",
    ownerEmail: actor,
    key: `content-imports/${input.importId}/${id}/${input.sourceSha256}.md`,
    metadata: {
      appId: "content",
      resourceType: "document-import",
      resourceId: id,
      importId: input.importId,
    },
  });
  if (!original) storageUnavailable();

  try {
    await createDocument.run(
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
    );
  } catch (error) {
    // A retry that raced an earlier attempt finds the page already created.
    if (!isUniqueConstraintError(error)) {
      await deletePrivateBlob(original).catch((cleanupError: unknown) => {
        console.error(
          `[content] Original import file ${original.id} for unsaved page ${id} was not deleted:`,
          cleanupError,
        );
      });
      throw error;
    }
  }

  const [created] = await db
    .select({
      ownerEmail: schema.documents.ownerEmail,
      createdBy: schema.documents.createdBy,
      bodyRevision: schema.documents.bodyRevision,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!created || created.createdBy?.toLowerCase() !== actor) {
    throw new Error(`Imported page ${id} was not created by this import`);
  }

  const now = new Date().toISOString();
  const state = { title: page.title, content: page.content };
  const agentCaller =
    ctx?.caller === "tool" ||
    ctx?.caller === "mcp" ||
    ctx?.caller === "webmcp" ||
    ctx?.caller === "a2a";
  await recordDocumentHistoryTransition({
    db,
    ownerEmail: created.ownerEmail,
    documentId: id,
    before: state,
    after: state,
    afterBodyRevision: created.bodyRevision ?? undefined,
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

  await db
    .insert(schema.documentImports)
    .values({
      documentId: id,
      ownerEmail: created.ownerEmail,
      importId: input.importId,
      sourceName: source.name,
      sourceFormat: "markdown",
      sourceBytes: Buffer.byteLength(source.text, "utf8"),
      sourceSha256: input.sourceSha256,
      originalBlob: JSON.stringify(original),
      importedTitle: page.title,
      importedContentSha256: importedBodyFingerprint(page.content),
      frontmatterJson:
        page.frontmatter.unmapped || page.frontmatter.unreadable
          ? JSON.stringify(page.frontmatter)
          : null,
      reportJson: JSON.stringify(page.report),
      createdAt: now,
    })
    .onConflictDoNothing();
}

/**
 * Fingerprint of a body as the editor stores it, so opening an imported page
 * without editing it does not count as an edit.
 */
export function importedBodyFingerprint(content: string): string {
  return sha256(docToNfm(nfmToDoc(content)));
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
