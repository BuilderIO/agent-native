import { parseUploadedDocument } from "./document-parser.js";
import { normalizeContextItem } from "./normalize.js";
import {
  fetchRemoteArtifact,
  parsePrivateBlobHandle,
  readPrivateArtifact,
  sanitizeProvenanceUrl,
  sanitizeRemoteArtifact,
  serializePrivateBlobHandle,
  storePrivateArtifact,
} from "./private-artifacts.js";
import {
  asRecord,
  cursorOffset,
  positiveLimit,
  stringValue,
} from "./provider-response.js";
import type {
  ContextConnectorExecutionContext,
  ContextConnectorFetchRequest,
  ContextConnectorFetchResult,
  ContextConnectorInventoryItem,
  ContextConnectorInventoryPage,
  ContextConnectorInventoryRequest,
  ContextImportConnector,
} from "./types.js";

interface UploadEntry {
  id: string;
  title: string;
  fileName: string;
  storageKey?: string;
  blobHandle?: Record<string, unknown>;
  url?: string;
  mimeType?: string;
  extractedText?: string;
  sourceModifiedAt?: string;
  metadata?: Record<string, unknown>;
}

export class UploadContextConnector implements ContextImportConnector {
  readonly kind = "upload" as const;
  readonly label = "Uploaded files";
  readonly supportsIncremental = false;

  async inventory(
    request: ContextConnectorInventoryRequest,
    _context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage> {
    const entries = parseUploadEntries(request.config);
    const offset = cursorOffset(request.cursor);
    const limit = positiveLimit(request.limit, 100, 1_000);
    const slice = entries.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      items: slice.map((entry, index) => ({
        externalId: entry.id,
        kind: isSupportedImageUpload(entry.mimeType, entry.fileName)
          ? "uploaded-image"
          : "uploaded-document",
        title: entry.title,
        ...(entry.url
          ? { canonicalUrl: sanitizeProvenanceUrl(entry.url) }
          : {}),
        ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
        ...(entry.sourceModifiedAt
          ? { sourceModifiedAt: entry.sourceModifiedAt }
          : {}),
        metadata: {
          entryIndex: offset + index,
          ...(entry.storageKey ? { storageKey: entry.storageKey } : {}),
        },
      })),
      nextCursor: nextOffset < entries.length ? String(nextOffset) : null,
      complete: nextOffset >= entries.length,
      coverage: {
        inspected: slice.length,
        returned: slice.length,
        truncated: nextOffset < entries.length,
      },
    };
  }

  async fetch(
    request: ContextConnectorFetchRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult> {
    const entry = findUploadEntry(request.config, request.item);
    const loaded = context.loadUpload
      ? await context.loadUpload(request.item, request.config)
      : await loadAndParseUpload(entry, context);
    const loadedMetadata: Record<string, unknown> = loaded.metadata ?? {};
    const storageKey = stringValue(loadedMetadata.privateBlobRef);
    if (loadedMetadata.standaloneImage === true) {
      if (!storageKey) {
        throw new Error(
          `Uploaded image ${entry.id} must be persisted in private blob storage.`,
        );
      }
      const mimeType = stringValue(loaded.mimeType) ?? entry.mimeType;
      const contentHash = stringValue(loadedMetadata.contentHash);
      if (!mimeType || !contentHash) {
        throw new Error(
          `Uploaded image ${entry.id} is missing media metadata.`,
        );
      }
      const palette = Array.isArray(loadedMetadata.palette)
        ? loadedMetadata.palette.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const canonicalUrl = loaded.canonicalUrl
        ? sanitizeProvenanceUrl(loaded.canonicalUrl)
        : entry.url
          ? sanitizeProvenanceUrl(entry.url)
          : undefined;
      return {
        items: [
          normalizeContextItem({
            externalId: entry.id,
            kind: "uploaded-image",
            title: loaded.title ?? entry.title,
            content: "",
            canonicalUrl,
            mimeType,
            sourceModifiedAt: entry.sourceModifiedAt,
            sourceVersion: contentHash,
            rawSnapshotBlobRef: storageKey,
            thumbnailBlobRef: storageKey,
            parseStatus: "parsed",
            provenance: { provider: "upload", uploadId: entry.id },
            metadata: {
              ...entry.metadata,
              ...loadedMetadata,
              parser: "standalone-image",
            },
            media: [
              {
                kind: "image",
                mimeType,
                accessMode: "private",
                storageKey,
                ...(canonicalUrl ? { provenanceUrl: canonicalUrl } : {}),
                contentHash,
                ...(palette.length ? { palette } : {}),
                captionStatus: "pending",
                metadata: { fileName: entry.fileName },
              },
            ],
          }),
        ],
      };
    }
    const parsed = asParsedUpload(loaded, entry);
    const canonicalUrl = loaded.canonicalUrl
      ? sanitizeProvenanceUrl(loaded.canonicalUrl)
      : entry.url
        ? sanitizeProvenanceUrl(entry.url)
        : undefined;
    const originalHash = stringValue(loadedMetadata.contentHash);
    const normalized = await Promise.all(
      parsed.parts.map(async (part) => {
        const imageMedia = await Promise.all(
          (part.images ?? []).map(async (image) => {
            const safeMimeType = resolveSupportedImageMimeType(
              image.mimeType,
              image.name,
            );
            if (!safeMimeType) {
              throw new Error(
                `Embedded image ${image.name} uses an unsupported media type.`,
              );
            }
            const safeData = assertSafeImageBytes(image.data, safeMimeType);
            const stored = await storePrivateArtifact({
              data: safeData,
              filename: image.name,
              mimeType: safeMimeType,
              context,
              metadata: {
                kind: "creative-context-upload-image",
                externalId: entry.id,
                partIndex: part.index,
              },
            });
            return {
              kind: "image" as const,
              mimeType: safeMimeType,
              accessMode: "private" as const,
              storageKey: stored.reference,
              contentHash: stored.contentHash,
              palette: stored.palette,
              captionStatus: "pending" as const,
              metadata: { partIndex: part.index, fileName: image.name },
            };
          }),
        );
        return normalizeContextItem({
          externalId: `${entry.id}:${part.kind}-${part.index + 1}`,
          kind: `uploaded-${part.kind}`,
          title: `${parsed.title || loaded.title || entry.title} — ${part.title}`,
          content: part.text,
          canonicalUrl,
          mimeType: loaded.mimeType ?? entry.mimeType,
          sourceModifiedAt: entry.sourceModifiedAt,
          sourceVersion: originalHash,
          rawSnapshotBlobRef: storageKey,
          parseStatus: "parsed",
          provenance: {
            provider: "upload",
            uploadId: entry.id,
            partKind: part.kind,
            partIndex: part.index,
          },
          metadata: {
            ...entry.metadata,
            ...loadedMetadata,
            parser: parsed.parser,
            part: part.metadata,
            notes: part.notes,
            textRuns: part.textRuns,
          },
          media: [
            ...(entry.url || storageKey || entry.storageKey
              ? [
                  {
                    kind: "document" as const,
                    ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
                    accessMode:
                      storageKey || entry.storageKey
                        ? ("private" as const)
                        : ("public" as const),
                    ...(storageKey || entry.storageKey
                      ? { storageKey: storageKey ?? entry.storageKey }
                      : {}),
                    ...(canonicalUrl ? { provenanceUrl: canonicalUrl } : {}),
                    ...(originalHash ? { contentHash: originalHash } : {}),
                    captionStatus: "not-needed" as const,
                  },
                ]
              : []),
            ...imageMedia,
          ],
          edges: [{ relation: "part-of-upload", toExternalId: entry.id }],
        });
      }),
    );
    const parent = normalizeContextItem({
      externalId: entry.id,
      kind: request.item.kind,
      title: parsed.title || loaded.title || entry.title,
      content: normalized
        .map((item, index) => {
          const excerpt = item.content.slice(0, 2_000);
          return `Part ${index + 1}: ${item.title}${excerpt ? `\n${excerpt}` : ""}`;
        })
        .join("\n\n")
        .slice(0, 50_000),
      summary: `${normalized.length} indexed document part${normalized.length === 1 ? "" : "s"}.`,
      canonicalUrl,
      mimeType: loaded.mimeType ?? entry.mimeType,
      sourceModifiedAt: entry.sourceModifiedAt,
      sourceVersion: originalHash,
      rawSnapshotBlobRef: storageKey,
      parseStatus: "parsed",
      provenance: { provider: "upload", uploadId: entry.id },
      metadata: {
        ...entry.metadata,
        ...loadedMetadata,
        parser: parsed.parser,
        partCount: normalized.length,
        childExternalIds: normalized.map((item) => item.externalId),
      },
      media:
        canonicalUrl || storageKey || entry.storageKey
          ? [
              {
                kind: "document",
                ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
                accessMode:
                  storageKey || entry.storageKey ? "private" : "public",
                ...(storageKey || entry.storageKey
                  ? { storageKey: storageKey ?? entry.storageKey }
                  : { url: canonicalUrl }),
                ...(canonicalUrl ? { provenanceUrl: canonicalUrl } : {}),
                ...(originalHash ? { contentHash: originalHash } : {}),
                captionStatus: "not-needed",
              },
            ]
          : undefined,
      edges: normalized.map((item) => ({
        relation: "contains-upload-part",
        toExternalId: item.externalId,
      })),
    });
    return {
      items: [parent, ...normalized],
    };
  }
}

function parseUploadEntries(config: Record<string, unknown>): UploadEntry[] {
  if (!Array.isArray(config.items)) {
    throw new Error("Upload connector config.items must be an array.");
  }
  return config.items.map((value, index) => {
    const item = asRecord(value);
    const id = stringValue(item?.id) ?? `upload-${index + 1}`;
    if (stringValue(item?.data) || stringValue(item?.base64)) {
      throw new Error(
        `Upload ${id} contains inline file data; persist it in blob storage and pass storageKey or url.`,
      );
    }
    const storageKey = stringValue(item?.storageKey);
    const blobHandle = asRecord(item?.blobHandle) ?? undefined;
    const url = stringValue(item?.url);
    const extractedText = stringValue(item?.extractedText);
    if (!storageKey && !blobHandle && !url && !extractedText) {
      throw new Error(
        `Upload ${id} requires storageKey, url, or pre-extracted text.`,
      );
    }
    return {
      id,
      title:
        stringValue(item?.title) ??
        stringValue(item?.fileName) ??
        `Upload ${index + 1}`,
      fileName:
        stringValue(item?.fileName) ?? stringValue(item?.title) ?? `${id}.bin`,
      storageKey,
      blobHandle,
      url,
      mimeType: stringValue(item?.mimeType),
      extractedText,
      sourceModifiedAt: stringValue(item?.sourceModifiedAt),
      metadata: asRecord(item?.metadata) ?? undefined,
    };
  });
}

async function loadAndParseUpload(
  entry: UploadEntry,
  context: ContextConnectorExecutionContext,
) {
  const handle = parsePrivateBlobHandle(entry.blobHandle ?? entry.storageKey);
  let data: Uint8Array | null = null;
  let privateBlobRef = handle ? serializePrivateBlobHandle(handle) : undefined;
  let mimeType = entry.mimeType;
  let canonicalUrl = entry.url;
  if (handle) {
    data = await readPrivateArtifact(handle, context);
  } else if (entry.url) {
    const remote = await fetchRemoteArtifact(entry.url, context);
    data = remote.data;
    mimeType ??= remote.mimeType;
    canonicalUrl = remote.finalUrl;
  }
  if (data) {
    const imageMimeType = resolveSupportedImageMimeType(
      mimeType,
      entry.fileName,
    );
    if (imageMimeType) {
      const safeData = assertSafeImageBytes(data, imageMimeType);
      if (!handle || imageMimeType === "image/svg+xml") {
        const stored = await storePrivateArtifact({
          data: safeData,
          filename: entry.fileName,
          mimeType: imageMimeType,
          context,
          metadata: {
            kind: "creative-context-upload",
            externalId: entry.id,
          },
        });
        privateBlobRef = stored.reference;
      }
      const fingerprint = fingerprintMedia(safeData, imageMimeType);
      const palette = await extractDominantColors(safeData).catch(() => []);
      return {
        text: "",
        mimeType: imageMimeType,
        title: entry.title,
        canonicalUrl,
        metadata: {
          ...entry.metadata,
          standaloneImage: true,
          contentHash: fingerprint.sha256,
          palette,
          ...(privateBlobRef ? { privateBlobRef } : {}),
        },
      };
    }
    if (!handle) {
      const stored = await storePrivateArtifact({
        data,
        filename: entry.fileName,
        mimeType,
        context,
        metadata: { kind: "creative-context-upload", externalId: entry.id },
      });
      privateBlobRef = stored.reference;
    }
    const parsed = await parseUploadedDocument({
      data,
      fileName: entry.fileName,
      mimeType,
      signal: context.signal,
    });
    const fingerprint = fingerprintMedia(data, mimeType);
    return {
      text: parsed.text,
      parts: parsed.parts,
      parser: parsed.parser,
      documentTitle: parsed.title,
      mimeType,
      title: entry.title,
      canonicalUrl,
      metadata: {
        ...entry.metadata,
        parser: parsed.parser,
        fileType: parsed.fileType,
        parserMetadata: parsed.metadata,
        parserWarnings: parsed.warnings,
        contentHash: fingerprint.sha256,
        ...(privateBlobRef ? { privateBlobRef } : {}),
      },
    };
  }
  if (entry.extractedText) {
    return {
      text: entry.extractedText,
      mimeType,
      title: entry.title,
      canonicalUrl,
      metadata: { ...entry.metadata, parser: "pre-extracted-text" },
    };
  }
  throw new Error(`Upload ${entry.id} could not be loaded.`);
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function resolveSupportedImageMimeType(
  mimeType: string | undefined,
  fileName: string,
): string | null {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (
    normalized &&
    Object.values(IMAGE_MIME_BY_EXTENSION).includes(normalized)
  ) {
    return normalized;
  }
  const extension = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return extension ? (IMAGE_MIME_BY_EXTENSION[extension] ?? null) : null;
}

function isSupportedImageUpload(
  mimeType: string | undefined,
  fileName: string,
): boolean {
  return resolveSupportedImageMimeType(mimeType, fileName) !== null;
}

function assertSafeImageBytes(data: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === "image/svg+xml") {
    return sanitizeRemoteArtifact({ data, mimeType, filename: "upload.svg" });
  }
  const matches =
    mimeType === "image/png"
      ? data.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (byte, index) => data[index] === byte,
        )
      : mimeType === "image/jpeg"
        ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        : mimeType === "image/gif"
          ? new TextDecoder().decode(data.slice(0, 6)).match(/^GIF8[79]a$/)
          : mimeType === "image/webp"
            ? new TextDecoder().decode(data.slice(0, 4)) === "RIFF" &&
              new TextDecoder().decode(data.slice(8, 12)) === "WEBP"
            : false;
  if (!matches) {
    throw new Error(`Uploaded file does not contain a safe ${mimeType} image.`);
  }
  return data;
}

function asParsedUpload(
  loaded:
    | Awaited<ReturnType<typeof loadAndParseUpload>>
    | Awaited<
        ReturnType<NonNullable<ContextConnectorExecutionContext["loadUpload"]>>
      >,
  entry: UploadEntry,
): Pick<ParsedOfficeDocument, "parser" | "parts" | "title"> {
  const structured = loaded as Partial<ParsedOfficeDocument> & {
    documentTitle?: string;
  };
  if (Array.isArray(structured.parts) && structured.parts.length > 0) {
    return {
      parser: structured.parser ?? "plain-text",
      title: structured.documentTitle ?? structured.title ?? entry.title,
      parts: structured.parts,
    };
  }
  const part: OfficeDocumentPart = {
    kind: "document",
    index: 0,
    title: loaded.title ?? entry.title,
    text: loaded.text,
  };
  return {
    parser: "plain-text",
    title: loaded.title ?? entry.title,
    parts: [part],
  };
}

function findUploadEntry(
  config: Record<string, unknown>,
  inventoryItem: ContextConnectorInventoryItem,
): UploadEntry {
  const entries = parseUploadEntries(config);
  const index = Number(inventoryItem.metadata?.entryIndex);
  const byIndex = Number.isInteger(index) ? entries[index] : undefined;
  const entry =
    byIndex?.id === inventoryItem.externalId
      ? byIndex
      : entries.find((candidate) => candidate.id === inventoryItem.externalId);
  if (!entry) throw new Error(`Upload ${inventoryItem.externalId} not found.`);
  return entry;
}
import {
  extractDominantColors,
  fingerprintMedia,
  type OfficeDocumentPart,
  type ParsedOfficeDocument,
} from "@agent-native/core/ingestion";
